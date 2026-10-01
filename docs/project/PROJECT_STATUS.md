# Project status

**Authority for phase, micro-phase, and next action.** `ROADMAP.md` is the plan; this file is
the state. Where they disagree, this file is correct.

- **Current phase:** 7 — Skills and Habits. **Complete and verified.**
- **Latest commit:** `16d51d2` — `feat(7): complete skills, habits, private log, and photo diary`
- **Working tree:** see `git status`. Local user data under `data/` is untracked by design.
- **Blockers:** none.

## Phase 7 — Skills and Habits: complete

Delivered as one unit. `docs/phases/PHASE_07_SKILLS_HABITS.md` and
`docs/sessions/2026-10-01-session-06.md` have the detail.

**What exists now.** The replacement-skill list, which the Dashboard's urge entry point opens in
full and in stored order, with nothing chosen. Cooking, dishes, and laundry with neutral streaks,
one progress bar for the PRD's twice-a-week laundry target, and screen time entered by hand. A
private log of two behaviours that can produce no number. A real photo path: laundry completion
requires an uploaded picture, and the Photo Diary is the timeline of those pictures.

**One migration.** `002_screen_time` rebuilds `habit_log` for the fourth type and a validated
`minutes` column. `skill`, `skill_log`, and `private_log` already existed.

**The boundaries that mattered.** The private log has one reader and no field anywhere could hold
a count (ADR-052). The laundry photo is verified by reading the row, never by believing the
sentence (ADR-053). `habit_log` has a single reader, and ADR-050's precondition has now come true
(ADR-054). Photos are stored as application URLs with the row id, and a feature slice — not a
route — owns the disk (ADR-051, ADR-055).

**Verification.** 12 test suites, 1584 assertions, 0 failures — including 45 new pure domain
assertions and a new 150-assertion `skills:test`. 58 architecture probes, up from 47. Three HTTP
acceptance runs (`dashboard:accept` 58, `routine:accept` 61, `skills:accept` 62), and the 29-check
responsive run at 320, 390, and 1440px. `format:check`, `typecheck`, `lint`, `build`, and `db:check`
pass with 0 errors and 0 warnings. The development database is byte-identical after every suite.

**Two defects were found and fixed here.** `habitStreak` never ended a streak when a day was
recorded as not done, because it walked back from the last *done* day rather than from today — the
opposite of its own documented rule and of the PRD's "not recorded" versus "not done" distinction. And
a "no" answer in the private log re-inserted the entry instead of removing it, so a correction grew
the table.

## Phase 6 — Routine and Sleep: complete

Delivered as one unit. `docs/phases/PHASE_06_ROUTINE_SLEEP.md` and
`docs/sessions/2026-10-01-session-05.md` have the detail.

**What exists now.** The night check-in writes tomorrow's top three tasks and the phone
confirmation as one transaction. Bedtime, sleep time, and wake time are logged by hand. Naps have
start, end, a computed length, and the PRD's two soft warnings — shown once, blocking nothing. A
neutral streak counts consecutive days with a wake time inside 06:15–07:30. `/routine` is the new
page; the Dashboard gained a **Last night** card and says whether tomorrow already has a plan.

**No schema was written.** `plan_task`, `sleep_log`, and `nap_log` have been in the schema since
micro-phase 1.1. Phase 6 added repositories and rules over them, and no DDL.

**The boundaries that mattered.** The check-in is an *operation*, not a command, because it is four
rows that must land together (ADR-049) — so `POST /api/routine` has a closed enum of one operation
with the same origin guard and token-based outcome as the other write routes. Five new command
kinds (`task.create`, `task.set_done`, `sleep.record`, `nap.start`, `nap.end`) carry everything
else, each one stated fact with `day` as the word the user said and never a computed date.
`plan_task` has a single reader: ADR-047's ad-hoc display read was retired once Routine owned the
table, and the Dashboard now composes `readRoutine` (ADR-050).

**Verification.** 11 test suites, 1380 assertions, 0 failures. 47 architecture probes, up from 39
— the new ones cover `src/features/routine/**`. A 61-check HTTP acceptance run against a
production build on a disposable database, a 57-check Dashboard acceptance run, and a 29-check
responsive run at 320, 390, and 1440px all pass. `format:check`, `typecheck`, `lint`, `build`, and
`db:check` pass with 0 errors and 0 warnings. The development database is byte-identical (SHA-256
`5e95474b50cedb4d1f88854d77a664382faae2d9946b481f02cbe460e21ab841`) with no WAL/SHM sidecars.

**Two defects were found and fixed here, one of them from an earlier phase.** A Phase 4 test
depended on the wall clock and began failing on its own at 12:00 UTC. Adding a fourth navigation
link overflowed every page at 320px, which `body { overflow-x: hidden }` had been hiding.

## Phase 5 — Dashboard: complete

Delivered as one unit. `docs/phases/PHASE_05_DASHBOARD.md` and
`docs/sessions/2026-10-01-session-04.md` have the detail.

**What exists now.** The Dashboard is a read-only command center assembled from real state: the
shared natural-language input, today's top three tasks with a first action that is only ever the
user's own first undone task, low stock from Kitchen, and today's spend taken from the same rows
the daily bill uses.

**The read boundary.** `src/features/dashboard/view.ts` is the only thing the page reads. It
composes the Kitchen, Expenses, and Routine read sides and one focused repository read
(`habit_log`), and it contains no comparison, no sum, and no clock (ADR-047, extended by ADR-050).

**What is deliberately not implemented.** Skills, Habits, and Photo Diary are Phases 7–8. Their
cards state that they are unavailable. No skill, habit, photo, or log is fabricated, and
`habit_log` is read but never written by anything in `src/`.

## Phase history

| Phase | Status | Commit | Notes |
| --- | --- | --- | --- |
| 0 — Foundation infrastructure | Complete | — | Repository baseline, tooling, SQLite foundation, data safety |
| 1 — Application foundation | Complete | — | Schema, domain, command contract, execution, persistence, first slice (1.1–1.6) |
| 2 — Command engine | Complete | — | Parser, validator, executor pipeline, OpenRouter boundary, shared input |
| 3 — Kitchen | Complete | `da9a89c` | Inventory, thresholds, history, correction/reversal, Dashboard integration |
| 4 — Expenses | Complete | `71ac329` | Accounts, natural-language expense entry, daily bill, Dashboard integration |
| 5 — Dashboard | **Complete** | `a87210c` | Read model, real low stock and spend, truthful deferred cards, boundary probes |
| 6 — Routine + Sleep | **Complete** | `015aa38` | Night check-in, sleep log, naps with soft warnings, neutral streak, `/routine`, Dashboard integration |
| 7 — Skills + Habits | **Complete** | `16d51d2` | Full replacement list, neutral streaks, laundry photo proof, screen time, private log, Photo Diary |
| 8 — Photo + Diary | Not started | — | The photo path Phase 8 was assumed to own shipped in Phase 7 (ADR-051); what remains is scope the roadmap and PRD disagree on |
| 9 — Hardening | Not started | — | |

## Next action

Phase 8, Photo + Diary, when the user asks for it — and its scope needs a decision before any code
is written. The photo path Phase 8 was assumed to own shipped in Phase 7 (ADR-051), so the
outstanding question is what a diary entry *is* when it is not a laundry proof: `habit_log.photo_url`
is the only column that can hold a picture, so anything else needs a column or a table, and no
phase document has been given one.

Phase 7 was **not** continued beyond its own scope in this run.

## Open items carried forward

- **Expense correction and refund.** Deferred by decision in Phase 4: `expense` has
  `CHECK (amount >= 0)` and no `source_text`, so a reversal has nowhere to live.
- **Batch expense entry.** The PRD contradicts itself; Phase 2's one-sentence-one-command ADR
  stands.
- **The baseline database fingerprint discrepancy** recorded in 1.5 remains unexplained.
- **Phase 8's scope.** The PRD's Photo Diary is partly delivered by Phase 7 as a timeline of
  laundry photos. A diary entry for anything else has nowhere to be stored, and inventing a table
  would be a schema change no phase document asked for.
- **PRD-versus-roadmap scope divergence** in `ROADMAP.md` is unresolved and is the user's call.
- **No live OpenRouter call has ever been made.** Every sentence path is proven against a local
  stub and an injected transport; no `OPENROUTER_API_KEY` has been available in any phase.
