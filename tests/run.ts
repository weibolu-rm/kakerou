/**
 * Test suite for the japanese-diary-review extension tools.
 * Runs the tools' execute() directly against copies of fixtures/synthetic.
 *
 *   node tests/run.ts                   # run all tests
 *   UPDATE_GOLDEN=1 node tests/run.ts   # regenerate the golden render
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import ext from "../extensions/japanese-diary-review.ts";

// --- tiny harness -----------------------------------------------------------

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string): void {
	if (cond) {
		passed++;
		console.log(`  ok  ${name}`);
	} else {
		failed++;
		console.log(`FAIL  ${name}${extra ? " — " + extra : ""}`);
	}
}

const tools: Record<string, any> = {};
ext({ registerTool: (d: any) => (tools[d.name] = d) } as any);

async function call(dir: string, tool: string, params: any): Promise<any> {
	return await tools[tool].execute("test", params, undefined, undefined, { cwd: dir });
}

function fixtureDir(): string {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jdr-test-"));
	fs.cpSync(path.join(import.meta.dirname, "../fixtures/synthetic"), tmp, { recursive: true });
	return tmp;
}

function read(dir: string, file: string): string {
	return fs.readFileSync(path.join(dir, file), "utf-8");
}

// --- test inputs --------------------------------------------------------------

const COMMIT_0202 = {
	entry: "2026-02-02",
	tiers: [
		{
			severity: "grammar",
			items: [
				{
					wrong: "単なるの気の迷いか",
					right: "単なる気の迷いなのか",
					note: "単なる is a な-adjective: it attaches directly to the noun — no の.",
					pattern: "な-adjective + noun attachment",
				},
				{
					wrong: "本当の興味か",
					right: "本当の興味なのか",
					note: "A nominal embedded question needs なのか, not bare か.",
					pattern: "Embedded questions: なのか",
				},
				{
					wrong: "頑張ろうと思います",
					right: "頑張ります",
					note: "Plain volitional inside a polite diary — the closing line slipped registers.",
					pattern: "Register mixing (ですます vs plain form)",
				},
			],
		},
		{
			severity: "vocabulary",
			items: [
				{
					wrong: "やがて疲れました",
					right: "だんだん疲れてきました",
					note: "やがて marks an eventual outcome in narration, not current fatigue.",
					pattern: "Dictionary first-sense trap",
				},
			],
		},
		{
			severity: "naturalness",
			items: [
				{
					wrong: "３時間",
					right: "3時間",
					note: "Half-width digits in horizontal text.",
					pattern: "Notation consistency",
				},
			],
		},
		{
			severity: "style",
			notes: [
				"What works: the arc (study → fatigue → absorption → honest doubt) is real diary voice, and 探しながら is now correct — that pattern stays fixed.",
				"それとも … か、… か gives the closing line a nice introspective beat; keep that instinct.",
			],
		},
	],
	upgrades: [
		{
			expression: "燃え尽きる（もえつきる）",
			note: "The native verb for burning out: ✓ CSへの情熱が燃え尽きてしまった.",
			category: "Struggle & growth",
		},
		{
			expression: "だんだん〜てくる",
			note: "Gradual change toward now: ✓ だんだん疲れてきた.",
			category: "Discourse markers",
		},
		{
			expression: "のめり込む",
			note: "Already in the bank — reuse it consciously.",
			category: "Interest & absorption",
		},
	],
	corrected:
		"今日は友達と電話で3時間も話しました。最近、仕事を探しながら、日本語の勉強を続けています。正直、だんだん疲れてきました。でも、新しい文法の本にのめり込んでいます。それが単なる気の迷いなのか、それとも本当の興味なのか、今は分かりません。明日も頑張ります。",
	scores: {
		correctness: 70,
		naturalness: 68,
		flow: 72,
		overall: 70,
		comments: {
			correctness: "Meaning intact; 5 slips, 3 of them repeats.",
			flow: "Strong arc and closing beat.",
		},
	},
	summary: "Best composite yet — kill the register slip at the close and this breaks 75.",
	nextFocus:
		"Hold ですます to the last line — [[mistake-log#Register mixing (ですます vs plain form)]] (5th occurrence)",
	patterns: [
		{
			heading: "Embedded questions: なのか",
			category: "Grammar",
			example: "✗ 本当の興味か → ✓ 本当の興味なのか — nominal embedded questions take なのか",
		},
	],
	cleanRecoveries: [
		{ pattern: "ながら takes the ます-stem", note: "探しながら used correctly" },
	],
};

const EMOJIS = ["❌", "✅", "🌱", "🔥", "🔴", "🟠", "🟡", "🟢", "⭐"];

// --- tests -----------------------------------------------------------------------

async function main(): Promise<void> {
	// 1. digest guidance on an empty folder
	{
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jdr-empty-"));
		const res = await call(dir, "diary_digest", {});
		check("digest on empty folder suggests init", res.content[0].text.includes("diary_init"));
	}

	// 2. diary_init scaffolds, and skips existing without force
	{
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jdr-init-"));
		const res = await call(dir, "diary_init", {
			level: "~1 year self-study",
			registers: "polite ですます",
			goals: "longer entries",
		});
		check("init creates profile", fs.existsSync(path.join(dir, "profile.md")));
		check("init creates trackers", fs.existsSync(path.join(dir, "mistake-log.md")));
		check("init reports created", res.content[0].text.includes("created"));
		const res2 = await call(dir, "diary_init", { level: "x", registers: "y", goals: "z" });
		check("init skips existing without force", res2.content[0].text.includes("skipped"));
		const digest = await call(dir, "diary_digest", {});
		check("digest works after init", digest.content[0].text.includes("no reviews yet"));
	}

	// 3. digest on synthetic fixture
	{
		const dir = fixtureDir();
		const res = await call(dir, "diary_digest", {});
		const text = res.content[0].text;
		check("digest names latest unreviewed target", text.includes("Next target (latest unreviewed): 2026-02-02"));
		check(
			"digest shows register mixing recurring 4",
			text.includes("Register mixing (ですます vs plain form) — recurring · 4 total"),
		);
		check(
			"digest hides fixed pattern (ながら)",
			!text.includes("ながら takes the ます-stem —") && text.includes("1 fixed (hidden)"),
		);
		check("digest shows 興味 seen once with note", text.includes("Collocation: 興味 — seen once · 1 total"));
		check("digest shows clean recovery note", text.includes("Used correctly in [[2026-01-20]]"));
		check("digest shows recent scores", text.includes("overall **66**"));
		check("digest shows expressions", text.includes("のめり込む [Interest & absorption]"));
		check("digest shows profile", text.includes("polite 私/ですます form"));
	}

	// 4. happy-path commit
	{
		const dir = fixtureDir();
		const original = read(dir, "2026-02-02.md");
		const res = await call(dir, "diary_commit", COMMIT_0202);
		check("commit succeeds", !res.isError, res.content[0].text);
		const after = read(dir, "2026-02-02.md");
		check("original text untouched (byte prefix)", after.startsWith(original));
		check("feedback section appended", after.includes("## Feedback (2026-02-02)"));
		check("grammar callout rendered", after.includes("> [!bug] Grammar errors"));
		check(
			"wrong/right glyphs rendered",
			after.includes("✗ 単なるの気の迷いか → ✓ 単なる気の迷いなのか"),
		);
		check(
			"repeat annotation with count",
			after.includes("(3rd time · recurring — [[mistake-log#な-adjective + noun attachment]])"),
		);
		check("style callout rendered", after.includes("> [!tip] Style notes"));
		check("upgrades callout rendered", after.includes("> [!success] Expression upgrades"));
		check("corrected version blockquoted", after.includes("## Corrected version (2026-02-02)"));
		check("score table rendered", after.includes("| **Overall** | **70/100** |"));
		check("logged-to footer", after.includes("Logged to: [[mistake-log]] · [[progress]] · [[expression-bank]]"));
		const appended = after.slice(original.length);
		check(
			"no emojis in appended feedback",
			!EMOJIS.some((e) => appended.includes(e)),
		);

		// 5. tracker state after commit
		const log = read(dir, "mistake-log.md");
		check(
			"register mixing count updated",
			log.includes("Count: 5 · First: [[2026-01-05]] · Last: [[2026-02-02]] · Status: recurring"),
		);
		check(
			"new pattern logged",
			log.includes("### Embedded questions: なのか") && log.includes("✗ 本当の興味か → ✓ 本当の興味なのか"),
		);
		check(
			"興味 flipped to fixed",
			log.includes("Count: 1 · First: [[2026-01-12]] · Last: [[2026-01-12]] · Status: fixed"),
		);
		check(
			"clean recovery line added to pattern body",
			log.includes("- Used correctly in [[2026-02-02]]: 探しながら used correctly"),
		);
		const prog = read(dir, "progress.md");
		const dates = [...prog.matchAll(/^\| (\d{4}-\d{2}-\d{2}) \|/gm)].map((m) => m[1]);
		check("progress has 5 sorted rows", JSON.stringify(dates) === JSON.stringify(["2026-01-05", "2026-01-12", "2026-01-20", "2026-01-25", "2026-02-02"]), JSON.stringify(dates));
		check("progress row carries next focus", prog.includes("Hold ですます to the last line"));
		const bank = read(dir, "expression-bank.md");
		check("expression added", bank.includes("### 燃え尽きる（もえつきる）") && bank.includes("First seen: [[2026-02-02]]"));
		check("duplicate expression not repeated", bank.match(/### のめり込む/g)?.length === 1);
		check("summary reports status flip", res.content[0].text.includes("Collocation: 興味: seen once → fixed"));

		// golden render
		const marker = "\n---\n\n";
		const section = after.slice(after.indexOf(marker) + marker.length);
		const goldenPath = path.join(import.meta.dirname, "golden/feedback-2026-02-02.md");
		if (process.env.UPDATE_GOLDEN) {
			fs.writeFileSync(goldenPath, section);
			console.log("  (golden file updated)");
		} else {
			const golden = fs.readFileSync(goldenPath, "utf-8");
			check("golden feedback render matches", golden === section, "run UPDATE_GOLDEN=1 to inspect");
		}
	}

	// 6. digest after commit: fixed stays hidden, new pattern active
	{
		const dir = fixtureDir();
		await call(dir, "diary_commit", COMMIT_0202);
		const res = await call(dir, "diary_digest", {});
		const text = res.content[0].text;
		check("digest after commit hides 興味", !text.includes("Collocation: 興味 —"));
		check("digest after commit shows new pattern", text.includes("Embedded questions: なのか — seen once · 1 total"));
		check("all entries reviewed now", text.includes("All entries reviewed"));
	}

	// 7. re-review refused without flag
	{
		const dir = fixtureDir();
		await call(dir, "diary_commit", COMMIT_0202);
		const res = await call(dir, "diary_commit", COMMIT_0202);
		check("re-review refused", res.isError && res.content[0].text.includes("already has a feedback section"));
	}

	// 8. unknown pattern reference rejected
	{
		const dir = fixtureDir();
		const bad = JSON.parse(JSON.stringify(COMMIT_0202));
		bad.tiers[0].items[0].pattern = "Bogus heading";
		const res = await call(dir, "diary_commit", bad);
		check(
			"unknown pattern rejected with known list",
			res.isError && res.content[0].text.includes('Unknown pattern "Bogus heading"') && res.content[0].text.includes("Known headings:"),
		);
		check("nothing written on failure", read(dir, "2026-02-02.md") === read(path.join(import.meta.dirname, "../fixtures/synthetic"), "2026-02-02.md"));
	}

	// 9. backfill: review an older entry after a newer one
	{
		const dir = fixtureDir();
		await call(dir, "diary_commit", COMMIT_0202);
		fs.writeFileSync(
			path.join(dir, "2026-01-15.md"),
			"今日は寒かったです。家で本を読みました。単純の話でした。夜は早く寝ました。\n",
		);
		const res = await call(dir, "diary_commit", {
			entry: "2026-01-15",
			tiers: [
				{
					severity: "grammar",
					items: [
						{
							wrong: "単純の話",
							right: "単純な話",
							note: "な-adjectives attach な.",
							pattern: "な-adjective + noun attachment",
						},
					],
				},
			],
			upgrades: [],
			corrected: "今日は寒かったです。家で本を読みました。単純な話でした。夜は早く寝ました。",
			scores: { correctness: 62, naturalness: 60, flow: 65, overall: 62 },
			nextFocus: "な-adjective attachment (3rd)",
		});
		check("backfill commit succeeds", !res.isError, res.content[0].text);
		const prog = read(dir, "progress.md");
		const dates = [...prog.matchAll(/^\| (\d{4}-\d{2}-\d{2}) \|/gm)].map((m) => m[1]);
		check(
			"backfill row inserted in date order",
			JSON.stringify(dates) ===
				JSON.stringify(["2026-01-05", "2026-01-12", "2026-01-15", "2026-01-20", "2026-01-25", "2026-02-02"]),
			JSON.stringify(dates),
		);
		check("backfill feedback appended to its entry", read(dir, "2026-01-15.md").includes("## Feedback (2026-01-15)"));
	}

	// 10. malformed tracker line → loud error, nothing written
	{
		const dir = fixtureDir();
		const logPath = path.join(dir, "mistake-log.md");
		const log = read(dir, "mistake-log.md").replace(
			"- Count: 4 · First: [[2026-01-05]] · Last: [[2026-01-25]] · Status: recurring",
			"- Count: lots",
		);
		fs.writeFileSync(logPath, log);
		const res = await call(dir, "diary_commit", COMMIT_0202);
		check(
			"malformed tracker errors loudly",
			res.isError && res.content[0].text.includes("Register mixing"),
		);
	}

	console.log(`\n${passed} passed, ${failed} failed`);
	if (failed > 0) process.exit(1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
