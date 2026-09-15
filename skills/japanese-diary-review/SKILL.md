---
name: japanese-diary-review
description: Reviews, corrects, and grades a Japanese diary entry (YYYY-MM-DD.md) in the current folder (書けろ workflow) — the latest unreviewed one by default, or a specific/backdated entry when named. Appends tiered feedback (Obsidian callouts, ✗/✓), a corrected version, and an honest score out of 100; mistake-log/progress/expression-bank are maintained deterministically by the diary_digest / diary_commit / diary_init tools. Use when the user asks to review, correct, grade, or give feedback on their Japanese writing practice entry.
---

# Japanese Diary Review (書けろ)

Reviews the learner's free-form Japanese writing. You provide the judgment — triage, calibration, voice preservation. All bookkeeping (formatting, tracker updates, counts, statuses) is done deterministically by the `diary_*` tools from this package. If those tools are not available, stop and tell the user the package is misinstalled (skill without extension).

## Workflow

1. Call `diary_digest`: entries + review state, active mistake patterns (with counts), recent scores, expression bank, and the learner profile. This is all the history you need — never re-read the tracker files yourself.
2. Pick the target: an entry the user named, else the latest unreviewed (digest says which). If none, stop and say so. `read` the entry fully.
3. Analyze every sentence; triage (below); pick 2–3 upgrades; decide scores against the calibration.
4. Call `diary_commit` with the structured review. It renders the feedback, appends it to the entry, updates all trackers, and reports status changes.
5. Reply in 2–3 sentences: overall verdict, the score, the single most valuable focus. Point to the entry file — never paste the full feedback into chat.

**First run in a folder without trackers:** interview the learner with `ask_user_question` (level/background, registers they write in, current goals, explanation language), then call `diary_init`.

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

## Backfills and re-reviews

Reviewing an older entry after newer ones is supported — `diary_commit` keeps progress sorted by entry date and recomputes statuses by entry date, not review order. Re-reviews require `reReview: true` and append; they never rewrite previous feedback.
