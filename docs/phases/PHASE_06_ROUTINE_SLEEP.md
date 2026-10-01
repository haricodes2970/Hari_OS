# Phase 6 — Routine and Sleep

**Status: Complete and verified.**

Scope taken from `Hari_OS_V1_PRD.docx` section 6.2. This document does not expand it.

## Purpose

Close the day deliberately and open the next one with a plan. Poor sleep is one of the
three problems Hari OS exists to address, and one of the five V1 priorities is improved
sleep consistency.

## Scope

- **Night check-in**: write tomorrow's top 3 tasks, and confirm the phone is charging
  outside the bedroom. PRD entity `sleep_log` carries `phone_outside` as a boolean.
- **Morning view** opening on those 3 tasks, so the day never starts blank, with the
  suggested first action (the PRD's example is the morning music session).
- **Manual logging** of bedtime, sleep time, and wake time. Manual entry is V1 by the PRD's
  own statement. Wake time is currently stable around 6:15–7:30 AM and is treated as the
  anchor.
- **Nap tracking**: start and end. PRD entity `nap_log` (date, start, end).
- **Soft warnings**, not blocks: a warning when a nap exceeds 30 minutes, and a warning when
  a nap starts after 3 PM. The PRD is explicit that these are soft.
- **A sleep consistency streak.** This is a neutral habit, so a streak is permitted
(PRD section 4).

## Dependencies

- Phase 1 complete: schema and a working data path.
- Dashboard (5) to surface tomorrow's tasks and today's routine state, though the routine
  and sleep pages stand alone.

## Boundaries

- **The streak must remain neutral.** It tracks routine for a sleep-related habit. It must
  not become a score, a grade, a punishment, or a progress bar tied to self-worth. The PRD's
  prohibition on shame-oriented streaks applies to private behaviors and the spirit of the
  rule applies here: this is a neutral habit tracker, not a wellbeing score.
- **No device or wearable integration.** Manual entry only in V1.
- **No smart alarm, sleep-stage detection, or audio recording.** Not in the PRD.
- No push notifications. In-app reminders only.
- Soft warnings must not block or shame. They inform; the user decides.

## Expected deliverables

- Routine and sleep feature slice under `src/features/routine/`.
- Schema for `plan_task`, `sleep_log`, and `nap_log`.
- Nap duration computed in `src/domain`, not in the UI.
- A night check-in view and a morning view.

## What was built

### No schema was written

`plan_task`, `sleep_log`, and `nap_log` have existed in `db/schema.sql` since micro-phase 1.1,
and `npm run db:check` asserts all three and their columns. Phase 6 added repositories, rules,
and pages over them and **no DDL** — the first feature slice that needed nothing from
`migrations/`. No migration, no version bump.

### The domain, first

| File | What it owns |
| --- | --- |
| `src/domain/calendar.ts` | `YYYY-MM-DD` parsing, UTC day arithmetic (`nextDate`, `previousDate`, `daysBetween`), round-trip rejection of impossible dates like `2026-02-30` |
| `src/domain/routine.ts` | `PlanTask`, `createTask`, `setTaskDone`, `selectTopTasks`, `firstIncompleteTask`, `resolveDayReference`, `nightCheckInTitles` |
| `src/domain/sleep.ts` | strict `HH:MM` parsing, `overnightMinutes`, `nightMinutes`, `asleepMinutes`, `napMinutes`, `formatDuration`, `summariseNap`, `wakeConsistencyStreak` |

Pure functions, no I/O, no clock. `TOP_TASK_LIMIT` is `3` and there is no priority column
anywhere: the order tasks are written in **is** the order they matter in, and `selectTopTasks`
takes the first three rows while the read model keeps the true count.

### Repositories

`TaskRepository`, `SleepRepository`, and `NapRepository` were added to the existing
`Repositories` object, and `transaction()` was exposed so a multi-row write is one unit. Task
lists are ordered by ascending `id`. A sleep write updates exactly one time column, so
recording a bedtime cannot disturb a wake time recorded earlier.

### The night check-in is an operation, not a command

ADR-049. It is four rows and it is useless if half of it lands, so it is one transaction in
`src/features/routine/write.ts`, dispatched from `POST /api/routine` — a closed enum of one
operation, the same origin guard as the other write routes, the same token-based outcome. The
titles are validated by the same `createTask` the command path uses. Replacing a check-in clears
tomorrow's **undone** tasks and leaves completed ones alone.

Five new command kinds carry the rest: `task.create`, `task.set_done`, `sleep.record`,
`nap.start`, `nap.end`. Each is one stated fact, and each carries `day` as the word the user
said — never a computed date.

### The pages

- `/routine` — today's tasks with a next action, tomorrow's plan, tonight's night with its
  lengths, naps with the PRD's warnings, and the check-in form.
- `/` — a **Last night** card, the consistency count, and whether tomorrow already has a plan.
  It composes `readRoutine` rather than reading `plan_task` itself (ADR-050).

### What it deliberately does not do

No score, no grade, no punishment, no progress bar, no percentage. No invented tasks: an empty
day says so. No invented times: a night with no wake time has no length to report. A missing
entry is "not recorded", never a failure. Nap warnings are the PRD's two, shown once, produced
by the domain and rendered verbatim, and they block nothing.

## Verification

| Check | Result |
| --- | --- |
| Baseline: `format:check`, `typecheck`, `lint`, `build`, `db:check` | Pass — 0 errors, 0 warnings |
| Eleven test suites | Pass — **1380 assertions, 0 failed** (1327 in the ten behavioural suites, 53 in `db:test`) |
| `routine:test` (new) | Pass — 113 checks: atomicity, refusals, the read model, nap warnings, the streak, the HTTP route |
| `routine:accept` (new, real HTTP, production build, disposable database) | Pass — 61 checks |
| `dashboard:accept` | Pass — 57 checks |
| `responsive:check` | Pass — 29 checks, after the nav was made to wrap |
| `architecture:probe` | Pass — 47 checks, including the new `src/features/routine/**` scope |
| A night check-in stores its tasks and the phone confirmation; the morning view shows exactly those tasks | Pass |
| Bedtime, sleep time, wake time, and nap start/end round-trip through a restart | Pass — every write is read back through a fresh repository in the same suite |
| Both soft warnings firing **and** not firing (over 30 min, after 15:00, and the exact boundaries) | Pass |
| Warnings shown as warnings, never a block or failure state | Pass — the warned-about nap is asserted still stored, with its end time |
| Streak updating, with no score or shaming language rendered | Pass — asserted in the acceptance run against rendered HTML, including no `<progress>` element and no percentage |
| Both pages render with no entries at all | Pass |
| `npm run db:check` | Pass — all 11 V1 tables, no unexpected tables |

### Two real defects this phase found

**The expenses tie-break test depended on the wall clock.** `scripts/expenses-test.mjs` pinned a
hard-coded `2026-10-01T12:00:00.000Z` for its "same-millisecond entries" case and asserted those
rows came back first. That was true only while the clock was before noon that day; at 12:00 UTC
the three command-recorded rows became newer and the suite began failing on its own. The
timestamp is now derived from the clock. This was a pre-existing bug in a Phase 4 test, found
because the suite was run across a boundary.

**A fourth navigation link broke every page at 320px.** Adding Routine to the nav made the four
links wider than a 320px viewport. `body { overflow-x: hidden }` hid the symptom in a browser
while `responsive:check` reported every element on the page as overflowing. `.nav` now wraps.
The check itself was also asserting a link *count* of three, which is the assertion a navigator
stops updating the moment a page is added; it now asserts the names.

## Status

**Complete.** The routine and sleep slices exist, the pages exist, both soft warnings fire and do
not fire on the boundaries, the streak is neutral, and everything above was run. Phase 7 —
Skills and Habits — was not started.