# Project status

**Authority for phase, micro-phase, and next action.** `ROADMAP.md` is the plan; this file is
the state. Where they disagree, this file is correct.

- **Current phase:** 9 — Hardening. **Complete.** Phases 1–8 are delivered; Phase 9 hardened the
  paths between them, added the cross-module regression suite, and made the application
  locally installable and startable with one click on `http://localhost:6377`.
- **Latest commit:** `237d464` — `test(9): follow each fact through every layer it must cross`
- **Working tree:** see `git status`. Local user data under `data/` is untracked by design.
- **Blockers:** none.

## Phase 9 — Hardening: complete

`docs/phases/PHASE_09_HARDENING.md` and `docs/sessions/2026-10-01-session-09.md` have the full
record. Eleven defects were found by reading each module against the claim it was supposed to
satisfy; all eleven are fixed and each has a regression test.

Three are worth naming here:

- **Private diary text was being serialised.** The Habits read model carried a `note` field no page
  renders, and the command endpoint returned it in every habit response. `HabitCommandView` now has
  no field a note could occupy, and lint refuses a new reader of private or diary text (ADR-061).
- **A locked database produced a raw SQLite error** rather than telling the user nothing was saved.
  Now a 5s busy timeout and a human message that states what happened.
- **`9e90b4d` did not typecheck from a clean checkout.** It committed three callers of
  `outcomeRedirect` without the function. Fixed in `9467ac8`, confirmed by reverting the file and
  watching `tsc` fail.

One scope correction, made before any code: the phase document asked for offline operation, which
conflicts with ADR-059. ADR-059 wins — offline is not product scope — and what was verified instead
is that no code path reaches the network for anything it did not choose to.

**1,879 assertions across fifteen suites, 0 failures.** The new `regression:test` suite is what was
missing: fourteen suites each test one layer against the one below, and none asked whether a change
made by one module is visible, and correct, in a module with no other way of knowing it happened.

### Local installation and one-click launch

Hari OS is now an installed local application rather than something you start from a terminal.
`npm run setup:hari` installs, builds for production, creates the first-run rows, and installs the
launcher once; after that, clicking **Hari OS** in the applications menu starts the production
server, waits for it to answer, and opens the browser.

It runs at **http://localhost:6377**, bound to `127.0.0.1` and not to `0.0.0.0`. That binding is
the point rather than a detail: `next start` binds every interface by default, and with no
authentication — which the PRD defers — the network binding is the only access control this V1 has.
One launcher owns the address, never kills a process it did not start, and writes its log and pid
file outside the repository. Recorded as ADR-062.

## Phase 8 — Photo and Diary: complete

`docs/phases/PHASE_08_PHOTO_DIARY.md` and the two 2026-10-01 session reports (07 and 08) have the
detail.

**What exists now.** A `/diary` page: every laundry photo newest first, with the user's own words
beside each one, editable and clearable in place. The Habits upload takes an optional note in the
same submission as the picture, so the thought and the photo are one moment. The application
installs: a generated manifest, five generated icons, a service worker that makes the application
installable and intercepts nothing, and a camera input on the upload form.

**No package was needed, and the phase document was wrong about that.** It said a PWA package was
"likely required." The requirement is a manifest, icons, and a registered worker, all of which the
platform provides, and the camera is an attribute on an input that already exists. The dependency was
declined, and the worker deliberately caches nothing: a cached diary is a diary that can be wrong
(ADR-059).

**What the client component exposed.** Writing the first client component in this project showed that
`src/app` refused `@/lib/db/connection` but not the `@/lib/db` directory, and refused the command
executor nowhere. Both are now refused, with the command endpoint named as the one exception
(ADR-060).

**The question the phase document referred upward, answered.** A diary entry *is* the photo. One
migration, `003_diary_note`, adds `habit_log.photo_note`; no table was created, because two tables
holding one picture's location are two answers to "which image is this" (ADR-056).

**No command was added, and that was a decision.** Notes are prose, and the parser is a model: a
sentence cannot name which photo the user meant, and "never a summary, never anything you added
yourself" is a weaker guarantee than not routing the words through an interpreter at all (ADR-057).

**The boundaries that mattered.** The diary has one reader, and `TodayEntry` gives the Dashboard
nothing to leak. A note requires a real photo. An entry's id stays with its entry, so a stale page
cannot write a note onto another day's picture (ADR-058).

**What this phase did not do.** It did not add an offline mode, an install prompt inside the
application, or a cache. Those are recorded decisions in ADR-059 rather than gaps, so a later phase
does not read the absence as work left undone.

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
| 8 — Photo + Diary | **Complete** | `961b4f4` | Diary notes and the `/diary` timeline, then installability with no new dependency and no cache (ADR-056–060) |
| 9 — Hardening | **Complete** | `237d464` | Eleven defects found and fixed across the module boundaries, the private read boundary enforced in lint (ADR-061), and a cross-module regression suite |

## Next action

Phases 1 through 9 are complete. There is no phase 10 in `ROADMAP.md`, and Phase 9 was the last
item on it. What exists now is a complete, verified V1 running on localhost.

The next step is the user's. The open items below each name a decision only they can make, and the
one that blocks the most is the **PRD-versus-roadmap scope divergence**, which is unresolved.

Two things Phase 9 explicitly did not do, and did not claim: a fresh clone was not installed,
built, and run from scratch in a clean directory, and the application has still never been
installed on a real device or made a live OpenRouter call. Both are noted in the session report
rather than left implied.

## Open items carried forward

- **Expense correction and refund.** Deferred by decision in Phase 4: `expense` has
  `CHECK (amount >= 0)` and no `source_text`, so a reversal has nowhere to live.
- **Batch expense entry.** The PRD contradicts itself; Phase 2's one-sentence-one-command ADR
  stands.
- **The baseline database fingerprint discrepancy** recorded in 1.5 remains unexplained.
- **Installing the application on a real device was never exercised.** A headless machine cannot
  raise `beforeinstallprompt`, and a camera cannot be opened in one. What is verified is everything
  observable from outside a browser — manifest served and parsed, every icon resolving, the worker
  served from the root, registering and activating with the origin's scope, and the `capture`
  attribute on the form. The last mile is a phone test the user has not yet done (ADR-059).
- **A diary entry for anything other than laundry.** `habit_log.photo_url` is still the only column
  that can hold a picture, so the V1 diary remains the timeline of laundry photos (ADR-056).
- **PRD-versus-roadmap scope divergence** in `ROADMAP.md` is unresolved and is the user's call.
- **No live OpenRouter call has ever been made.** Every sentence path is proven against a local
  stub and an injected transport; no `OPENROUTER_API_KEY` has been available in any phase.
