/**
 * japanese-diary-review — deterministic bookkeeping for the Japanese diary
 * review (書けろ) workflow.
 *
 * The skill (skills/japanese-diary-review/SKILL.md) provides the teaching
 * judgment; these tools provide the mechanics:
 *
 *   diary_digest — one-call context: entries + review state, ACTIVE mistake
 *                  patterns with exact counts and live-computed statuses,
 *                  recent scores, expression bank, learner profile. Stays
 *                  flat-sized as history grows (fixed patterns are hidden).
 *   diary_commit — structured review in, everything else out: renders the
 *                  feedback section (Obsidian callouts, ✗/✓, no emoji),
 *                  appends it below a `---` divider without ever touching the
 *                  original composition, updates mistake-log / progress /
 *                  expression-bank, and recomputes pattern statuses exactly
 *                  (seen once → recurring → fixed after 3 consecutive clean
 *                  reviewed entries, by entry date — backfill-safe).
 *   diary_init   — scaffold profile.md + the three trackers for a new diary
 *                  folder (the skill interviews the learner first).
 *
 * Output is Obsidian-flavored markdown (wikilinks, callouts). Past review
 * sections and history rows are never rewritten.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MISTAKE_LOG = "mistake-log.md";
const PROGRESS_FILE = "progress.md";
const EXPRESSION_BANK = "expression-bank.md";
const PROFILE_FILE = "profile.md";

const WRONG = "✗";
const RIGHT = "✓";

const FIX_THRESHOLD = 3; // consecutive clean reviewed entries → fixed

const EMOJI_FREE_NOTE =
	"Output contains no emojis: wrong/right are marked with plain ✗/✓ text glyphs and statuses are words.";

type Status = "seen once" | "recurring" | "fixed";

const SEVERITIES = ["grammar", "vocabulary", "naturalness", "style"] as const;
type Severity = (typeof SEVERITIES)[number];

const TIER_META: Record<Severity, { callout: string; title: string }> = {
	grammar: { callout: "bug", title: "Grammar errors" },
	vocabulary: { callout: "warning", title: "Misleading vocabulary & phrasing" },
	naturalness: { callout: "info", title: "Naturalness & minor fixes" },
	style: { callout: "tip", title: "Style notes" },
};

const DEFAULT_CATEGORY = "Grammar";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function ordinal(n: number): string {
	const s = ["th", "st", "nd", "rd"];
	const v = n % 100;
	return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function sanitizeCell(text: string): string {
	return text.replace(/\|/g, "／");
}

function firstLine(text: string): string {
	return text.split("\n").find((l) => l.trim().length > 0) ?? "";
}

function truncate(text: string, max: number): string {
	return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function readLines(cwd: string, file: string): string[] {
	return fs.readFileSync(path.join(cwd, file), "utf-8").split("\n");
}

function requireTrackers(cwd: string): void {
	const missing = [MISTAKE_LOG, PROGRESS_FILE, EXPRESSION_BANK].filter(
		(f) => !fs.existsSync(path.join(cwd, f)),
	);
	if (missing.length > 0) {
		throw new Error(
			`Missing tracker file(s): ${missing.join(", ")}. This does not look like an initialized diary folder — run diary_init first (the skill interviews the learner, then scaffolds profile.md and the trackers).`,
		);
	}
}

// ---------------------------------------------------------------------------
// Status semantics (the single source of truth for "fixed")
// ---------------------------------------------------------------------------

function computeStatus(count: number, lastDate: string, reviewedDates: string[]): Status {
	const clean = reviewedDates.filter((d) => d > lastDate).length;
	if (clean >= FIX_THRESHOLD) return "fixed";
	return count >= 2 ? "recurring" : "seen once";
}

// ---------------------------------------------------------------------------
// Entry scanning
// ---------------------------------------------------------------------------

interface EntryInfo {
	date: string;
	file: string;
	reviewed: boolean;
}

function scanEntries(cwd: string): EntryInfo[] {
	return fs
		.readdirSync(cwd)
		.filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
		.sort()
		.map((n) => {
			const content = fs.readFileSync(path.join(cwd, n), "utf-8");
			return {
				date: n.slice(0, 10),
				file: n,
				reviewed: /^## Feedback/m.test(content),
			};
		});
}

// ---------------------------------------------------------------------------
// mistake-log.md parsing / rewriting
// ---------------------------------------------------------------------------

const META_RE =
	/^-\s*Count:\s*(\d+)\s*·\s*First:\s*\[\[([^\]]+)\]\]\s*·\s*Last:\s*\[\[([^\]]+)\]\]\s*·\s*Status:\s*(.*)$/;

interface PatternSec {
	category: string;
	heading: string;
	startIdx: number;
	endIdx: number; // exclusive
	metaIdx: number; // -1 if absent
	count: number;
	first: string;
	last: string;
	status: Status; // as stored (may lag; always recompute live)
	note: string | null; // clean-recovery annotation from the status line
}

interface MistakeLogData {
	lines: string[];
	patterns: PatternSec[];
	categories: string[];
	categoryInsert: Map<string, number>;
}

function parseStatusToken(raw: string, heading: string): Status {
	const t = raw.trim();
	if (t === "seen once" || t === "recurring" || t === "fixed") return t;
	throw new Error(
		`${MISTAKE_LOG} "### ${heading}": unrecognized status "${t}" (expected: seen once / recurring / fixed)`,
	);
}

function parseMistakeLog(cwd: string): MistakeLogData {
	const lines = readLines(cwd, MISTAKE_LOG);
	const patterns: PatternSec[] = [];
	const categories: string[] = [];
	const catHeadingIdx = new Map<string, number>();
	const catLastPatternEnd = new Map<string, number>();
	let curCat: string | null = null;
	let cur: PatternSec | null = null;

	const closePattern = (endIdx: number) => {
		if (cur) {
			cur.endIdx = endIdx;
			patterns.push(cur);
			catLastPatternEnd.set(cur.category, endIdx);
			cur = null;
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^###\s+/.test(line)) {
			closePattern(i);
			cur = {
				category: curCat ?? DEFAULT_CATEGORY,
				heading: line.replace(/^###\s+/, "").trim(),
				startIdx: i,
				endIdx: i,
				metaIdx: -1,
				count: 0,
				first: "",
				last: "",
				status: "seen once",
				note: null,
			};
			continue;
		}
		if (/^##\s+/.test(line)) {
			closePattern(i);
			curCat = line.replace(/^##\s+/, "").trim();
			if (curCat) {
				if (!categories.includes(curCat)) categories.push(curCat);
				catHeadingIdx.set(curCat, i);
			}
			continue;
		}
		if (cur) {
			const m = META_RE.exec(line);
			if (m) {
				cur.metaIdx = i;
				cur.count = parseInt(m[1], 10);
				cur.first = m[2];
				cur.last = m[3];
				cur.status = parseStatusToken(m[4], cur.heading);
			} else if (/^- Used correctly in /.test(line)) {
				cur.note = line.replace(/^- /, "").trim();
			}
		}
	}
	closePattern(lines.length);

	for (const p of patterns) {
		if (p.metaIdx < 0) {
			throw new Error(
				`${MISTAKE_LOG}: section "### ${p.heading}" has no "- Count: … · First: … · Last: … · Status: …" metadata line — fix or remove it before committing a review.`,
			);
		}
	}

	const categoryInsert = new Map<string, number>();
	for (const c of categories) {
		categoryInsert.set(c, catLastPatternEnd.get(c) ?? catHeadingIdx.get(c)! + 1);
	}

	return { lines, patterns, categories, categoryInsert };
}

// ---------------------------------------------------------------------------
// progress.md parsing
// ---------------------------------------------------------------------------

const PROGRESS_ROW_RE = /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|/;

interface ProgressRow {
	date: string;
	idx: number;
	raw: string;
}

interface ProgressData {
	lines: string[];
	rows: ProgressRow[];
}

function parseProgress(cwd: string): ProgressData {
	const lines = readLines(cwd, PROGRESS_FILE);
	const rows: ProgressRow[] = [];
	lines.forEach((line, i) => {
		const m = PROGRESS_ROW_RE.exec(line);
		if (m) rows.push({ date: m[1], idx: i, raw: line });
	});
	return { lines, rows };
}

function progressInsertIndex(prog: ProgressData): number {
	if (prog.rows.length > 0) return prog.rows[prog.rows.length - 1].idx + 1;
	// No rows yet: insert right after the table separator (|---|---|...)
	for (let i = 0; i < prog.lines.length; i++) {
		if (/^\|[-\s|]+\|$/.test(prog.lines[i])) return i + 1;
	}
	return prog.lines.length;
}

// ---------------------------------------------------------------------------
// expression-bank.md parsing
// ---------------------------------------------------------------------------

interface ExprSec {
	heading: string;
	category: string | null;
	startIdx: number;
	endIdx: number;
}

interface BankData {
	lines: string[];
	sections: ExprSec[];
	categories: string[];
	categoryInsert: Map<string, number | null>; // null → category not present in file
}

function parseBank(cwd: string): BankData {
	const lines = readLines(cwd, EXPRESSION_BANK);
	const sections: ExprSec[] = [];
	const categories: string[] = [];
	const catHeadingIdx = new Map<string, number>();
	const catLastSectionEnd = new Map<string, number>();
	let curCat: string | null = null;
	let cur: ExprSec | null = null;

	const closeSection = (endIdx: number) => {
		if (cur) {
			cur.endIdx = endIdx;
			sections.push(cur);
			catLastSectionEnd.set(cur.category ?? "", endIdx);
			cur = null;
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^###\s+/.test(line)) {
			closeSection(i);
			cur = {
				heading: line.replace(/^###\s+/, "").trim(),
				category: curCat,
				startIdx: i,
				endIdx: i,
			};
			continue;
		}
		if (/^##\s+/.test(line)) {
			closeSection(i);
			curCat = line.replace(/^##\s+/, "").trim();
			if (curCat && !categories.includes(curCat)) {
				categories.push(curCat);
				catHeadingIdx.set(curCat, i);
			}
		}
	}
	closeSection(lines.length);

	const categoryInsert = new Map<string, number | null>();
	for (const c of categories) {
		categoryInsert.set(c, catLastSectionEnd.get(c) ?? catHeadingIdx.get(c)! + 1);
	}

	return { lines, sections, categories, categoryInsert };
}

// ---------------------------------------------------------------------------
// Splice helper: insert a block of lines at idx with blank-line hygiene
// ---------------------------------------------------------------------------

function spliceSection(lines: string[], insertAt: number, block: string[]): void {
	const prev = insertAt > 0 ? lines[insertAt - 1] : "";
	const next = lines[insertAt] ?? "";
	let b = [...block];
	if (prev.trim() !== "" && !/^##\s/.test(prev)) b = ["", ...b];
	if (/^##\s/.test(next) && b[b.length - 1].trim() !== "") b = [...b, ""];
	lines.splice(insertAt, 0, ...b);
}

interface SpliceOp {
	idx: number;
	block: string[];
	/** "section" gets blank-line hygiene; "inline" is spliced verbatim */
	kind: "section" | "inline";
}

function applySplices(lines: string[], ops: SpliceOp[]): void {
	ops
		.slice()
		.sort((a, b) => b.idx - a.idx)
		.forEach((op) => {
			if (op.kind === "section") spliceSection(lines, op.idx, op.block);
			else lines.splice(op.idx, 0, ...op.block);
		});
}

/** Serialize lines with exactly one trailing newline. */
function joinLines(lines: string[]): string {
	return lines.join("\n").replace(/[\n ]+$/, "") + "\n";
}

/** Index of the last content line (trailing blanks excluded). */
function contentEnd(lines: string[]): number {
	let end = lines.length;
	while (end > 0 && lines[end - 1].trim() === "") end--;
	return end;
}

// ---------------------------------------------------------------------------
// diary_digest
// ---------------------------------------------------------------------------

function buildDigest(cwd: string): string {
	const trackersOk = [MISTAKE_LOG, PROGRESS_FILE, EXPRESSION_BANK].every((f) =>
		fs.existsSync(path.join(cwd, f)),
	);
	if (!trackersOk) {
		return [
			`Diary folder: ${cwd}`,
			"",
			"No tracker files found (mistake-log.md / progress.md / expression-bank.md).",
			"If this is a new diary folder: interview the learner first (level and background,",
			"registers they write in, goals, explanation language) using ask_user_question,",
			"then call diary_init to scaffold profile.md and the trackers.",
		].join("\n");
	}

	const log = parseMistakeLog(cwd);
	const prog = parseProgress(cwd);
	const bank = parseBank(cwd);
	const reviewed = prog.rows.map((r) => r.date);
	const entries = scanEntries(cwd);
	const unreviewed = entries.filter((e) => !e.reviewed);
	const reviewedEntries = entries.filter((e) => e.reviewed).map((e) => e.date);

	const L: string[] = [`Diary folder: ${cwd}`, ""];

	// Entries
	L.push(
		`Entries: ${entries.length} total · reviewed: ${reviewedEntries.length ? reviewedEntries.join(", ") : "none"} · unreviewed: ${unreviewed.length ? unreviewed.map((e) => e.date).join(", ") : "none"}`,
	);
	if (unreviewed.length === 1) {
		L.push(`Only unreviewed entry: ${unreviewed[0].date}`);
	} else if (unreviewed.length > 1) {
		L.push(
			`Multiple unreviewed entries (${unreviewed.map((e) => e.date).join(", ")}) — if the user hasn't already chosen, ask whether to review all (earliest → latest) or a specific one.`,
		);
	} else {
		L.push("All entries reviewed — nothing to do (a re-review needs an explicit request).");
	}
	L.push("");

	// Active patterns (live-computed statuses; fixed hidden)
	const live = log.patterns.map((p) => ({
		p,
		status: computeStatus(p.count, p.last, reviewed),
	}));
	const active = live.filter((x) => x.status !== "fixed");
	const fixedCount = live.length - active.length;
	L.push(
		`Active mistake patterns — ${active.length} active, ${fixedCount} fixed (hidden). Reference these headings EXACTLY in diary_commit:`,
	);
	if (active.length === 0) {
		L.push("(none — no recurring patterns)");
	}
	let lastCat: string | null = null;
	for (const { p, status } of active) {
		if (p.category !== lastCat) {
			L.push("", p.category + ":");
			lastCat = p.category;
		}
		let line = `- ${p.heading} — ${status} · ${p.count} total · first ${p.first} · last ${p.last}`;
		if (p.note) line += ` (note: ${truncate(p.note, 80)})`;
		L.push(line);
	}
	L.push("");

	// Recent scores
	L.push("Recent scores (newest first):");
	for (const row of prog.rows.slice(-3).reverse()) {
		const cells = row.raw.split("|").map((c) => c.trim());
		// cells: ['', date, entry, corr, nat, flow, overall, next, '']
		const next = cells[7] ?? "";
		L.push(
			`- ${row.date} · corr ${cells[3]} · nat ${cells[4]} · flow ${cells[5]} · overall ${cells[6]}${next ? ` · next: ${truncate(next, 90)}` : ""}`,
		);
	}
	if (prog.rows.length === 0) L.push("(no reviews yet)");
	L.push("");

	// Expression bank
	L.push(`Expression bank — ${bank.sections.length} entries:`);
	for (const s of bank.sections) {
		const body = bank.lines
			.slice(s.startIdx + 1, s.endIdx)
			.filter((l) => l.trim() && !/^First seen:/.test(l.trim()))
			.join(" ");
		const cat = s.category ? ` [${s.category}]` : "";
		L.push(`- ${s.heading}${cat} — ${truncate(body, 90)}`);
	}
	L.push("");

	// Profile
	const profilePath = path.join(cwd, PROFILE_FILE);
	if (fs.existsSync(profilePath)) {
		L.push("Profile:", ...fs.readFileSync(profilePath, "utf-8").split("\n").map((l) => (l.trim() ? l : "")));
	} else {
		L.push("Profile: (no profile.md — learner background unknown; consider diary_init)");
	}

	return L.join("\n");
}

// ---------------------------------------------------------------------------
// diary_commit — types
// ---------------------------------------------------------------------------

interface CommitItem {
	wrong: string;
	right: string;
	note: string;
	pattern?: string;
}

interface CommitTier {
	severity: Severity;
	items?: CommitItem[];
	notes?: string[];
}

interface CommitUpgrade {
	expression: string;
	note: string;
	category?: string;
}

interface CommitPattern {
	heading: string;
	category?: string;
	example?: string;
	extraOccurrences?: number;
}

interface CommitCleanRecovery {
	pattern: string;
	note: string;
}

interface CommitScores {
	correctness: number;
	naturalness: number;
	flow: number;
	overall: number;
	comments?: {
		correctness?: string;
		naturalness?: string;
		flow?: string;
		overall?: string;
	};
}

interface CommitInput {
	entry: string;
	tiers: CommitTier[];
	upgrades: CommitUpgrade[];
	corrected: string;
	scores: CommitScores;
	summary?: string;
	nextFocus: string;
	patterns?: CommitPattern[];
	cleanRecoveries?: CommitCleanRecovery[];
	reReview?: boolean;
}

// ---------------------------------------------------------------------------
// diary_commit — rendering
// ---------------------------------------------------------------------------

function renderFeedback(
	input: CommitInput,
	patternInfo: Map<string, { total: number; status: Status; existed: boolean }>,
): string {
	const L: string[] = [];
	L.push(`## Feedback (${input.entry})`, "");

	for (const sev of SEVERITIES) {
		const tier = (input.tiers ?? []).find((t) => t.severity === sev);
		if (!tier) continue;
		const items = tier.items ?? [];
		const notes = tier.notes ?? [];
		if (sev === "style" ? notes.length === 0 : items.length === 0) continue;
		const meta = TIER_META[sev];
		L.push(`> [!${meta.callout}] ${meta.title}`);
		if (sev === "style") {
			for (const n of notes) L.push(`> - ${n}`);
		} else {
			items.forEach((item, i) => {
				if (i > 0) L.push(">");
				L.push(`> ${i + 1}. ${WRONG} ${item.wrong} → ${RIGHT} ${item.right}`);
				for (const line of (item.note ?? "").split("\n")) {
					if (line.trim()) L.push(`>    ${line}`);
				}
				if (item.pattern) {
					const info = patternInfo.get(item.pattern);
					if (info && info.existed && info.total >= 2) {
						L.push(
							`>    (${ordinal(info.total)} time · ${info.status} — [[mistake-log#${item.pattern}]])`,
						);
					}
				}
			});
		}
		L.push("");
	}

	if ((input.upgrades ?? []).length > 0) {
		L.push("> [!success] Expression upgrades");
		input.upgrades.forEach((u, i) => {
			if (i > 0) L.push(">");
			L.push(`> ${i + 1}. ${u.expression} — ${firstLine(u.note)}`);
			for (const line of u.note.split("\n").slice(1)) {
				if (line.trim()) L.push(`>    ${line}`);
			}
		});
		L.push("");
	}

	L.push(`## Corrected version (${input.entry})`, "");
	for (const line of input.corrected.split("\n")) {
		L.push(line.trim() ? `> ${line}` : ">");
	}
	L.push("");

	const s = input.scores;
	const c = s.comments ?? {};
	L.push(
		`## Score (${input.entry})`,
		"",
		"| Category | Score | Comments |",
		"|---|---|---|",
		`| Correctness | ${s.correctness}/100 | ${sanitizeCell(c.correctness ?? "")} |`,
		`| Naturalness | ${s.naturalness}/100 | ${sanitizeCell(c.naturalness ?? "")} |`,
		`| Flow | ${s.flow}/100 | ${sanitizeCell(c.flow ?? "")} |`,
		`| **Overall** | **${s.overall}/100** | ${sanitizeCell(c.overall ?? input.summary ?? "")} |`,
		"",
		"Logged to: [[mistake-log]] · [[progress]] · [[expression-bank]]",
	);

	return L.join("\n");
}

// ---------------------------------------------------------------------------
// diary_commit — main
// ---------------------------------------------------------------------------

function commitReview(cwd: string, input: CommitInput): { text: string; details: unknown } {
	requireTrackers(cwd);

	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entry)) {
		throw new Error(`entry must be a YYYY-MM-DD date string, got "${input.entry}"`);
	}
	const entryPath = path.join(cwd, `${input.entry}.md`);
	if (!fs.existsSync(entryPath)) {
		throw new Error(`No entry file "${input.entry}.md" in ${cwd}`);
	}
	const entryContent = fs.readFileSync(entryPath, "utf-8");
	const alreadyReviewed = /^## Feedback/m.test(entryContent);
	if (alreadyReviewed && !input.reReview) {
		throw new Error(
			`${input.entry}.md already has a feedback section. Pass reReview: true to append another review (never done unless the user explicitly asks).`,
		);
	}
	for (const field of ["correctness", "naturalness", "flow", "overall"] as const) {
		const v = input.scores[field];
		if (typeof v !== "number" || v < 0 || v > 100) {
			throw new Error(`scores.${field} must be a number 0–100, got ${v}`);
		}
	}

	// --- Parse trackers -----------------------------------------------------
	const log = parseMistakeLog(cwd);
	const prog = parseProgress(cwd);
	const bank = parseBank(cwd);
	const reviewed = prog.rows.map((r) => r.date);
	if (reviewed.includes(input.entry) && !input.reReview) {
		throw new Error(
			`progress.md already has a row for ${input.entry} but the entry looks unreviewed — inconsistent state. Pass reReview: true if this is an intentional re-review.`,
		);
	}

	// --- Validate pattern references ----------------------------------------
	const known = new Set(log.patterns.map((p) => p.heading));
	const declared = new Map<string, CommitPattern>();
	for (const p of input.patterns ?? []) {
		if (!declared.has(p.heading)) declared.set(p.heading, p);
	}
	const allItems: CommitItem[] = [];
	for (const t of input.tiers ?? []) {
		if (t.severity === "style") continue;
		for (const item of t.items ?? []) {
			allItems.push(item);
			if (item.pattern && !known.has(item.pattern) && !declared.has(item.pattern)) {
				throw new Error(
					`Unknown pattern "${item.pattern}". Either reference a known heading exactly, or declare it in patterns[] (with category + example) so it gets logged.\nKnown headings: ${[...known].join(" | ")}`,
				);
			}
		}
	}
	for (const [heading, p] of declared) {
		if (!known.has(heading)) {
			if (!p.example) {
				throw new Error(
					`New pattern "${heading}" needs a one-line example (✗ → ✓ form) so the log stays self-explanatory.`,
				);
			}
			const cat = p.category ?? DEFAULT_CATEGORY;
			if (!log.categories.includes(cat)) {
				throw new Error(
					`Pattern "${heading}" category "${cat}" is not a ## heading in ${MISTAKE_LOG}. Valid: ${log.categories.join(" | ")}`,
				);
			}
		}
	}
	for (const cr of input.cleanRecoveries ?? []) {
		if (!known.has(cr.pattern) && !declared.has(cr.pattern)) {
			throw new Error(
				`cleanRecoveries references unknown pattern "${cr.pattern}". Known headings: ${[...known].join(" | ")}`,
			);
		}
	}

	// --- Count occurrences ---------------------------------------------------
	// Tier items with `pattern` count as one occurrence each; patterns[].extraOccurrences
	// adds more (for repeats inside one entry that are not separate items).
	const occurrences = new Map<string, number>();
	for (const item of allItems) {
		if (!item.pattern) continue;
		occurrences.set(item.pattern, (occurrences.get(item.pattern) ?? 0) + 1);
	}
	for (const [heading, p] of declared) {
		const extra = p.extraOccurrences ?? 0;
		if (extra > 0) occurrences.set(heading, (occurrences.get(heading) ?? 0) + extra);
	}
	// A declared new pattern with no occurrences anywhere still happened once.
	for (const [heading, p] of declared) {
		if (!known.has(heading) && !occurrences.has(heading)) occurrences.set(heading, 1);
	}

	// --- Compute new pattern state -------------------------------------------
	const newReviewed = [...new Set([...reviewed, input.entry])].sort();
	const stateBefore = new Map(log.patterns.map((p) => [p.heading, p]));
	const stateAfter = new Map<string, { count: number; first: string; last: string }>();
	for (const p of log.patterns) stateAfter.set(p.heading, { count: p.count, first: p.first, last: p.last });
	for (const [heading, occ] of occurrences) {
		const prev = stateAfter.get(heading);
		if (prev) {
			prev.count += occ;
			prev.last = prev.last > input.entry ? prev.last : input.entry;
		} else {
			stateAfter.set(heading, { count: occ, first: input.entry, last: input.entry });
		}
	}

	const patternInfo = new Map<string, { total: number; status: Status; existed: boolean }>();
	const statusChanges: string[] = [];
	for (const [heading, after] of stateAfter) {
		const before = stateBefore.get(heading);
		const status = computeStatus(after.count, after.last, newReviewed);
		patternInfo.set(heading, { total: after.count, status, existed: !!before });
		if (before) {
			const beforeStatus = computeStatus(before.count, before.last, reviewed);
			if (beforeStatus !== status) {
				statusChanges.push(`${heading}: ${beforeStatus} → ${status}`);
			}
		}
	}

	// --- Render feedback (validation complete; from here on, writes only) ----
	const rendered = renderFeedback(input, patternInfo);

	// --- mistake-log rewrite -------------------------------------------------
	const logLines = [...log.lines];
	const metaByIdx = new Map<number, string>(); // replacements
	const logSplices: SpliceOp[] = [];

	for (const p of log.patterns) {
		const after = stateAfter.get(p.heading)!;
		const status = patternInfo.get(p.heading)!.status;
		metaByIdx.set(p.metaIdx, `- Count: ${after.count} · First: [[${after.first}]] · Last: [[${after.last}]] · Status: ${status}`);
	}
	for (const cr of input.cleanRecoveries ?? []) {
		const p = stateBefore.get(cr.pattern);
		const target = log.patterns.find((x) => x.heading === cr.pattern);
		if (!target) continue; // new pattern — note not applicable
		const noteLine = `- Used correctly in [[${input.entry}]]: ${cr.note}`;
		const body = logLines.slice(target.startIdx + 1, target.endIdx).join("\n");
		const marker = `Used correctly in [[${input.entry}]]`;
		if (!body.includes(marker) && !body.includes(noteLine)) {
			logSplices.push({ idx: target.metaIdx, block: [noteLine], kind: "inline" });
		}
		void p;
	}
	for (const [heading, p] of declared) {
		if (known.has(heading)) continue;
		const after = stateAfter.get(heading)!;
		const status = patternInfo.get(heading)!.status;
		const cat = p.category ?? DEFAULT_CATEGORY;
		const insertAt = log.categoryInsert.get(cat);
		const block = [
			`### ${heading}`,
			`- ${p.example}`,
			`- Count: ${after.count} · First: [[${after.first}]] · Last: [[${after.last}]] · Status: ${status}`,
		];
		if (insertAt !== undefined) {
			logSplices.push({ idx: insertAt, block, kind: "section" });
		} else {
			logSplices.push({
				idx: contentEnd(logLines),
				block: [`## ${cat}`, "", ...block],
				kind: "section",
			});
		}
	}
	// Replacements first (no index shifts), then splices (computed on the
	// original layout, applied bottom-up).
	for (const [idx, line] of metaByIdx) logLines[idx] = line;
	applySplices(logLines, logSplices);

	// --- progress rewrite ----------------------------------------------------
	const progLines = [...prog.lines];
	const rowLine = `| ${input.entry} | [[${input.entry}]] | ${input.scores.correctness} | ${input.scores.naturalness} | ${input.scores.flow} | **${input.scores.overall}** | ${sanitizeCell(input.nextFocus)} |`;
	const existingRow = prog.rows.find((r) => r.date === input.entry);
	let progressAction: string;
	if (existingRow) {
		progLines[existingRow.idx] = rowLine;
		progressAction = `row for ${input.entry} replaced`;
	} else {
		const after = prog.rows.find((r) => r.date > input.entry);
		const insertAt = after ? after.idx : progressInsertIndex(prog);
		progLines.splice(insertAt, 0, rowLine);
		progressAction = `row for ${input.entry} added (${prog.rows.length + 1} total, sorted by date)`;
	}

	// --- expression-bank rewrite ----------------------------------------------
	const bankLines = [...bank.lines];
	const bankSplices: SpliceOp[] = [];
	const addedExprs: string[] = [];
	const skippedExprs: string[] = [];
	const existingExprHeadings = new Set(bank.sections.map((s) => s.heading));
	for (const u of input.upgrades ?? []) {
		if (existingExprHeadings.has(u.expression)) {
			skippedExprs.push(u.expression);
			continue;
		}
		existingExprHeadings.add(u.expression);
		const noteLines = u.note.split("\n").filter((l) => l.trim());
		const block = [`### ${u.expression}`, ...noteLines, `First seen: [[${input.entry}]]`];
		const cat = u.category;
		if (cat && bank.categoryInsert.has(cat)) {
			const insertAt = bank.categoryInsert.get(cat);
			if (insertAt !== null && insertAt !== undefined) {
				bankSplices.push({ idx: insertAt, block, kind: "section" });
			} else {
				bankSplices.push({ idx: contentEnd(bankLines), block: [`## ${cat}`, "", ...block], kind: "section" });
			}
		} else if (cat) {
			bankSplices.push({ idx: contentEnd(bankLines), block: [`## ${cat}`, "", ...block], kind: "section" });
		} else {
			// No category: append at the end of the file's content.
			bankSplices.push({ idx: contentEnd(bankLines), block, kind: "section" });
		}
		addedExprs.push(u.expression);
	}
	applySplices(bankLines, bankSplices);

	// --- Write everything ------------------------------------------------------
	let out = entryContent;
	if (!out.endsWith("\n")) out += "\n";
	out += "\n---\n\n" + rendered + "\n";
	fs.writeFileSync(entryPath, out, "utf-8");
	fs.writeFileSync(path.join(cwd, MISTAKE_LOG), joinLines(logLines), "utf-8");
	fs.writeFileSync(path.join(cwd, PROGRESS_FILE), joinLines(progLines), "utf-8");
	fs.writeFileSync(path.join(cwd, EXPRESSION_BANK), joinLines(bankLines), "utf-8");

	// --- Summary -----------------------------------------------------------------
	const S: string[] = [`Committed review for ${input.entry}.`];
	S.push(`- Feedback appended to ${input.entry}.md below a \`---\` divider (original text untouched). ${EMOJI_FREE_NOTE}`);
	const touched: string[] = [];
	for (const [heading, occ] of occurrences) {
		const before = stateBefore.get(heading);
		const info = patternInfo.get(heading)!;
		if (before) {
			touched.push(`  - ${heading}: ${info.status} · ${info.total} total (was ${before.count})`);
		} else {
			touched.push(`  - ${heading}: new · ${info.status}`);
		}
		void occ;
	}
	if (touched.length > 0) S.push(`- Mistake log — ${touched.length} pattern(s) updated:`, ...touched);
	if (statusChanges.length > 0) {
		S.push(`- Status flips (recomputed from review history):`, ...statusChanges.map((c) => `  - ${c}`));
	}
	S.push(`- Progress: ${progressAction}.`);
	if (addedExprs.length > 0) S.push(`- Expression bank: added ${addedExprs.join(", ")}.`);
	if (skippedExprs.length > 0) S.push(`- Expression bank: skipped as duplicate — ${skippedExprs.join(", ")}.`);
	S.push(`- Next focus: ${input.nextFocus}`);

	return {
		text: S.join("\n"),
		details: {
			entry: input.entry,
			statusChanges,
			addedExpressions: addedExprs,
			skippedExpressions: skippedExprs,
		},
	};
}

// ---------------------------------------------------------------------------
// diary_init — templates
// ---------------------------------------------------------------------------

function trackerTemplates(): Record<string, string> {
	return {
		[MISTAKE_LOG]: [
			"---",
			"tags:",
			"  - language",
			"  - 日本語",
			"  - meta",
			"---",
			"",
			"# Mistake Pattern Log",
			"",
			"Auto-maintained by the `japanese-diary-review` skill. One `###` section per error pattern,",
			"grouped by category. Repeat offenders get flagged explicitly in future reviews.",
			"",
			"**Status:** seen once → recurring (2+ entries) → fixed (absent from 3 consecutive reviewed entries)",
			"",
			"## Grammar",
			"",
			"## Vocabulary & Collocations",
			"",
			"## Orthography",
			"",
		].join("\n"),
		[PROGRESS_FILE]: [
			"---",
			"tags:",
			"  - language",
			"  - 日本語",
			"  - meta",
			"---",
			"",
			"# Score History",
			"",
			"One row per reviewed entry, maintained by the `japanese-diary-review` skill. Scores are honest —",
			"the goal is a real trend line, not encouragement.",
			"",
			"| Date | Entry | Correctness | Naturalness | Flow | Overall | Next focus |",
			"|---|---|---|---|---|---|---|",
			"",
		].join("\n"),
		[EXPRESSION_BANK]: [
			"---",
			"tags:",
			"  - language",
			"  - 日本語",
			"  - meta",
			"---",
			"",
			"# Expression Bank",
			"",
			'"Not wrong, but a native would say…" upgrades, collected from reviews. Each links back to the',
			"entry where it appeared. Consciously reuse these in future entries — that's how they stick.",
			"",
		].join("\n"),
	};
}

interface InitInput {
	level: string;
	registers: string;
	goals: string;
	explanationLanguage?: string;
	upgradeTarget?: string;
	force?: boolean;
}

function initFolder(cwd: string, input: InitInput): { text: string; details: unknown } {
	fs.mkdirSync(cwd, { recursive: true });
	const created: string[] = [];
	const skipped: string[] = [];

	const profile = [
		"---",
		"tags: [language, 日本語, meta]",
		"---",
		"",
		"# Learner profile",
		"",
		`- Level: ${input.level}`,
		`- Registers: ${input.registers}`,
		`- Explanation language: ${input.explanationLanguage ?? "English"}`,
		`- Upgrade target: ${input.upgradeTarget ?? "N3–N2 stretch expressions"}`,
		`- Goals: ${input.goals}`,
		"",
		"Maintained by the learner; reviews read it for context and never rewrite it.",
		"",
	].join("\n");

	const files: Record<string, string> = { [PROFILE_FILE]: profile, ...trackerTemplates() };
	for (const [name, content] of Object.entries(files)) {
		const p = path.join(cwd, name);
		if (fs.existsSync(p) && !input.force) {
			skipped.push(name);
			continue;
		}
		fs.writeFileSync(p, content, "utf-8");
		created.push(name);
	}

	const S = [`Initialized diary folder: ${cwd}`];
	if (created.length) S.push(`- created: ${created.join(", ")}`);
	if (skipped.length) S.push(`- skipped (already exist): ${skipped.join(", ")} — use force: true to overwrite`);
	S.push("- Next: the learner adds YYYY-MM-DD.md entries; reviews start with diary_digest.");
	return { text: S.join("\n"), details: { created, skipped } };
}

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

const ItemSchema = Type.Object({
	wrong: Type.String({ description: "The Japanese as written (verbatim from the entry)" }),
	right: Type.String({ description: "The corrected Japanese" }),
	note: Type.String({
		description: "1–2 lines explaining why, in the profile's explanation language",
	}),
	pattern: Type.Optional(
		Type.String({
			description:
				"Exact mistake-log heading this belongs to (see diary_digest). Counts as one occurrence of that pattern.",
		}),
	),
});

const TierSchema = Type.Object({
	severity: Type.Union([
		Type.Literal("grammar"),
		Type.Literal("vocabulary"),
		Type.Literal("naturalness"),
		Type.Literal("style"),
	]),
	items: Type.Optional(Type.Array(ItemSchema)),
	notes: Type.Optional(
		Type.Array(Type.String({ description: "Freeform style observations (style tier only)" })),
	),
});

const CommitSchema = Type.Object({
	entry: Type.String({ description: "Entry date YYYY-MM-DD (file stem of the reviewed entry)" }),
	tiers: Type.Array(TierSchema, { description: "Ordered most → least important; empty tiers are omitted" }),
	upgrades: Type.Array(
		Type.Object({
			expression: Type.String({ description: "Japanese expression (used verbatim as the bank heading)" }),
			note: Type.String({ description: "One-line usage note with a ✓ example sentence" }),
			category: Type.Optional(
				Type.String({ description: "Bank ## category to file under (created if missing)" }),
			),
		}),
		{ description: "2–3 native-level upgrades that are NOT mistakes" },
	),
	corrected: Type.String({
		description: "Full corrected rewrite: every grammar/vocabulary/naturalness fix applied, upgrades optional; preserves tone, register, paragraph order, rhythm",
	}),
	scores: Type.Object({
		correctness: Type.Number(),
		naturalness: Type.Number(),
		flow: Type.Number(),
		overall: Type.Number(),
		comments: Type.Optional(
			Type.Object({
				correctness: Type.Optional(Type.String()),
				naturalness: Type.Optional(Type.String()),
				flow: Type.Optional(Type.String()),
				overall: Type.Optional(Type.String()),
			}),
		),
	}),
	summary: Type.Optional(Type.String({ description: "One-line overall comment" })),
	nextFocus: Type.String({
		description: "Single most valuable thing to work on next (link a [[mistake-log#heading]] when it maps)",
	}),
	patterns: Type.Optional(
		Type.Array(
			Type.Object({
				heading: Type.String({ description: "Exact heading; must match an existing one for existing patterns" }),
				category: Type.Optional(
					Type.String({ description: "mistake-log ## category (required for new patterns)" }),
				),
				example: Type.Optional(
					Type.String({ description: "One-line ✗ → ✓ example (required for new patterns)" }),
				),
				extraOccurrences: Type.Optional(
					Type.Number({
						description:
							"Occurrences beyond those counted via tier items' pattern refs — e.g. the same slip twice in one entry covered by a single item",
					}),
				),
			}),
		),
		{ description: "Pattern metadata: declare new patterns here; existing ones only for extra occurrences" },
	),
	cleanRecoveries: Type.Optional(
		Type.Array(
			Type.Object({
				pattern: Type.String({ description: "Exact mistake-log heading" }),
				note: Type.String({ description: "How it was used correctly (the phrase from the entry)" }),
			}),
		),
		{ description: "Patterns the learner used correctly this time" },
	),
	reReview: Type.Optional(
		Type.Boolean({ description: "Allow appending when the entry already has feedback (also replaces its progress row)" }),
	),
});

const InitSchema = Type.Object({
	level: Type.String({ description: "Learner level/background, one line" }),
	registers: Type.String({ description: "Register(s) the learner writes in" }),
	goals: Type.String({ description: "Current goals/challenges, one line" }),
	explanationLanguage: Type.Optional(Type.String({ description: "Default: English" })),
	upgradeTarget: Type.Optional(Type.String({ description: "Default: N3–N2 stretch expressions" })),
	force: Type.Optional(Type.Boolean({ description: "Overwrite existing files" })),
});

export default function japaneseDiaryReview(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "diary_digest",
		label: "Diary digest",
		description:
			"Diary-review context in one call (run in the diary folder): entries and review state, ACTIVE mistake patterns with exact counts and statuses (fixed ones hidden), recent scores, expression bank, learner profile. Call this before analyzing an entry; reference pattern headings exactly when committing.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			try {
				const text = buildDigest(ctx.cwd);
				return { content: [{ type: "text", text }], details: {} };
			} catch (e) {
				return {
					content: [{ type: "text", text: `diary_digest failed: ${(e as Error).message}` }],
					details: {},
					isError: true,
				};
			}
		},
	});

	pi.registerTool({
		name: "diary_commit",
		label: "Diary commit",
		description:
			"Commit a finished diary review (run in the diary folder): renders the feedback section (Obsidian callouts, ✗/✓, no emoji), appends it to the entry below a --- divider without touching the original text, and updates mistake-log/progress/expression-bank with exact counts and statuses. Validate-then-write: nothing is written if anything is invalid.",
		parameters: CommitSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const result = commitReview(ctx.cwd, params as CommitInput);
				return { content: [{ type: "text", text: result.text }], details: result.details };
			} catch (e) {
				return {
					content: [{ type: "text", text: `diary_commit failed: ${(e as Error).message}` }],
					details: {},
					isError: true,
				};
			}
		},
	});

	pi.registerTool({
		name: "diary_init",
		label: "Diary init",
		description:
			"Scaffold a new diary folder (current directory): profile.md plus mistake-log/progress/expression-bank from templates. Interview the learner first (level, registers, goals, explanation language).",
		parameters: InitSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const result = initFolder(ctx.cwd, params as InitInput);
				return { content: [{ type: "text", text: result.text }], details: result.details };
			} catch (e) {
				return {
					content: [{ type: "text", text: `diary_init failed: ${(e as Error).message}` }],
					details: {},
					isError: true,
				};
			}
		},
	});
}
