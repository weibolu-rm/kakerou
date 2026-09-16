---
name: japanese-diary-review
description: Reviews, corrects, and grades a Japanese diary entry (YYYY-MM-DD.md) in the current folder (書けろ workflow) — the latest unreviewed one by default, or a specific/backdated entry when named. Appends tiered feedback (Obsidian callouts, ✗/✓), a corrected version, and an honest score out of 100; mistake-log/progress/expression-bank are maintained deterministically by the diary_digest / diary_commit / diary_amend / diary_init tools. Use when the user asks to review, correct, grade, or give feedback on their Japanese writing practice entry.
---

# Japanese Diary Review (書けろ)

Reviews the learner's free-form Japanese writing. You provide the judgment — triage, calibration, voice preservation. All bookkeeping (formatting, tracker updates, counts, statuses) is done deterministically by the `diary_*` tools from this package. If those tools are not available, stop and tell the user the package is misinstalled (skill without extension).

## Workflow

1. Call `diary_digest`: entries + review state, active mistake patterns (with counts), recent scores, expression bank, and the learner profile. This is all the history you need — never re-read the tracker files yourself.
2. Pick the target:
   - An entry the user named → that one.
   - Exactly one unreviewed → it.
   - Several unreviewed and the user hasn't already chosen → ask with `ask_user_question`: "Found N unreviewed entries (list the dates). Review them all, or a specific one?" Options: all in order (earliest → latest) · latest only · a specific date.
   - None → stop and say so.
3. `read` the target entry fully. In a batch, process entries one at a time, strictly earliest → latest.
4. Analyze every sentence; triage (below); pick 2–3 upgrades; decide scores against the calibration. Call `diary_commit` for the entry, then move to the next.
5. Reply in 2–3 sentences per review: overall verdict, the score, the single most valuable focus — point to the entry file, never paste the full feedback into chat. For a batch: one line per entry as you go, then a single wrap-up (score trajectory, patterns that escalated across the batch, the next focus).
6. Close the session with `ask_user_question` — "Anything else, or done for now?" — options: **Done** · **Revise a review** · (last) **Ask a language question** (student-style specifics; nothing gets written). The learner can always pick Other and type freely. Repeat this ask after every follow-up (revision, question) until they pick Done.

**Batch rule:** never re-read trackers or re-digest between entries — each commit's summary carries the state forward (new counts, status flips). The date-sorted tracker math is correct in any order; earliest → latest keeps the narrative and the "Nth time" annotations chronological.

**First run in a folder without trackers:** interview the learner with `ask_user_question` (level/background, registers they write in, current goals, explanation language), then call `diary_init`. Afterwards continue with normal target selection — a clean folder of dated entries flows straight into the batch question above.

## Commit contract

- Tier items get a `pattern` field referencing an **exact** heading from the digest — repeats are then annotated with counts automatically. New patterns are declared in `patterns[]` with category + one-line example.
- Occurrences: each item with `pattern` counts as one; use `patterns[].extraOccurrences` only when the same slip appears more than once under one item.
- `cleanRecoveries[]` records patterns the learner finally used correctly — mention them as wins.

## Non-negotiables

1. **Never modify the original composition.** Enforced by `diary_commit` (append-only below a `---` divider) — never edit the entry yourself.
2. **Match and keep the author's voice.** Fix errors without sanitizing style or swapping registers (see profile). Inconsistent register within one entry is flagged as a style note; the rewrite normalizes to the entry's dominant register.
3. **Explanations in the profile's language** (default English); only the Japanese itself stays Japanese.
4. **Scores are honest.** Do not inflate.
5. **Patterns are the whole point:** surface repeats, pick `nextFocus` from the highest-priority recurring pattern, and encourage conscious reuse of expression-bank entries.

## Triage (most → least important)

1. **grammar** — ungrammatical or nonstandard: impossible conjugations, bad particle combos, wrong attachments (な-adjectives, 〜型の), redundant compounds
2. **vocabulary** — word choices that mislead or force re-reading (dictionary first-sense traps, register-mismatched terms)
3. **naturalness** — unnatural but understood: collocation misses, stiff connectors, orthography (half-width digits, kana auxiliaries)
4. **style** — register and stylistic observations. Also name what works: diary-style fragments, conversational connectors, and ambitious vocabulary are strengths, not flaws.

## Scoring calibration (consistent across entries)

- **Correctness**: 90+ near error-free · 80s minor slips · 70s several clear errors, meaning intact · 60s frequent errors, reader stumbles · ≤50 errors obscure meaning
- **Naturalness**: density of on-target native collocations vs off-target vocabulary
- **Flow**: paragraphing, topic shifts, connectives, presence of a voice
- **Overall**: roughly the average of the three, adjusted by judgment

## Correcting a review

Reviews misread things — intent, register, what the learner was reaching for. When the learner disputes a mistake or wants the revision/scores adjusted (directly or via the session-close ask):

1. If the review isn't in this session's context, `read` the entry's newest feedback section first.
2. Rebuild `previous` **exactly as committed** — same items, upgrades, corrected text, scores. Do not paraphrase or "improve" it; `diary_amend` verifies it against the file and refuses on any mismatch.
3. Build `amended` with the change: drop the misread item (and its `patterns[]` declaration if the pattern was new to that review), adjust `corrected`, and re-judge scores honestly — removing a real error raises Correctness; a cosmetic tweak doesn't. `nextFocus` and `cleanRecoveries` may change accordingly.
4. Call `diary_amend` with `{ entry, previous, amended }`. It replaces the entry's newest feedback block and recomputes every tracker — counts shrink, patterns can disappear, the progress row is rescored, bank entries are added/removed.
5. Confirm in one line: what changed, the new overall.

Language questions ("is X also natural?", "why なのか here?") are answered in chat only — nothing is written. If an answer surfaces an expression worth banking or a real fix to the committed review, fold it into a `diary_amend`.

## Backfills and re-reviews

Reviewing an older entry after newer ones is supported — `diary_commit` keeps progress sorted by entry date and recomputes statuses by entry date, not review order. Re-reviews require `reReview: true` and append; they never rewrite previous feedback.
