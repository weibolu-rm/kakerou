# japanese-diary-review (書けろ)

A [pi](https://github.com/badlogic/pi-mono) package that reviews Japanese diary
entries: tiered feedback, a corrected version, and honest scores appended to
each entry — with deterministic mistake-log / score-history / expression-bank
maintenance.

## How it works

- **Skill** (`skills/japanese-diary-review`): the teaching judgment — triage,
  scoring calibration, voice preservation.
- **Extension** (`extensions/japanese-diary-review.ts`): the mechanics —
  - `diary_digest`: flat-sized context (active patterns with exact counts and
    statuses, recent scores, expression bank, learner profile) regardless of
    how much history exists — fixed patterns are hidden.
  - `diary_commit`: structured review in → rendered feedback out, tracker
    updates with exact counts and computed statuses. Validate-then-write;
    the original composition is never touched.
  - `diary_init`: scaffolds `profile.md` + trackers for a new diary folder.

Output is emoji-free Obsidian-flavored markdown: callouts + `✗ → ✓` markers,
`[[wikilinks]]` between entries and trackers. Pattern statuses
(`seen once` → `recurring` → `fixed`) are computed from review history, never
guessed — and old emoji-era tracker files are parsed and normalized on write.

## Requirements

- [pi](https://github.com/badlogic/pi-mono)
- Obsidian recommended (wikilinks and callouts render natively; degrades to
  plain markdown elsewhere)

## Install

    pi install git:github.com/<you>/japanese-diary-review

Try it without installing:

    cd your-diary-folder && pi -e /path/to/japanese-diary-review

## Use

Your diary folder holds `YYYY-MM-DD.md` entries. Run pi in that folder.

- First time: say "review my diary" — the agent interviews you once
  (`diary_init`) and sets up `profile.md` + the three trackers.
- Then: "review my entry" (latest unreviewed), or "review 2026-09-16".
- Backfills (reviewing an older entry after newer ones) and explicit
  re-reviews are supported.

## Development

    npm install
    node tests/run.ts                   # synthetic-fixture test suite
    UPDATE_GOLDEN=1 node tests/run.ts   # regenerate the golden render

`scripts/check-local.sh` copies a real vault into gitignored
`fixtures/local/` and runs a digest on the copy — see
`scripts/make-local-fixtures.sh` (override the source with `DIARY_VAULT_DIR`).
Real diary content is never committed.
