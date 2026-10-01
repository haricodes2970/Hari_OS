# Roadmap

Phase-level plan for Hari OS. Ten phases, no dates and no estimates.

**Phase status is authoritative in `PROJECT_STATUS.md`.** This file is the plan, not the
live state. If the two ever disagree, `PROJECT_STATUS.md` is correct.

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Foundation infrastructure | Complete |
| 1 | Application foundation | **Complete** (1.1–1.6) |
| 2 | Command engine | **Complete** |
| 3 | Kitchen | **Complete** |
| 4 | Expenses | **Complete** |
| 5 | Dashboard | **Complete** |
| 6 | Routine + Sleep | **Complete** |
| 7 | Skills + Habits | **Complete** |
| 8 | Photo + Diary | **Partial** — diary delivered, PWA not |
| 9 | Hardening | Planned |

## Phase summaries

**Phase 0 — Foundation infrastructure (complete).** Engineering bootstrap: repository
baseline, Next.js foundation, tooling, architecture boundaries, SQLite foundation, and
local data safety. No product features. Detail in
[`REPOSITORY_BASELINE.md`](REPOSITORY_BASELINE.md) and the session reports.

**Phase 1 — Application foundation (complete).** The transition from infrastructure into a
usable application skeleton: schema, deterministic domain rules, the command contract, the
execution pipeline, persistence, the server boundary, and the first usable vertical slice
(Dashboard, Kitchen, Expenses). Complete; 1.1–1.6. See
[`phases/PHASE_01_FOUNDATION.md`](../phases/PHASE_01_FOUNDATION.md).

Phases 4 (Expenses) and 5 (Dashboard) were also planned on top of Phase 1's initial working
slice of those areas. Both are now complete: Expenses in Phase 4, and the Dashboard in Phase 5,
which completed the screen from real Kitchen and Expenses state and left Routine, Sleep, Skills,
Habits, and Photo Diary to their own phases.

**Phase 2 — Command engine (complete).** Natural-language input parsed into a validated,
structured intent, with deterministic execution and no arithmetic performed by a model. See
[`phases/PHASE_02_COMMAND_ENGINE.md`](../phases/PHASE_02_COMMAND_ENGINE.md).

**Phase 3 — Kitchen (complete).** Inventory items with quantities and units, an event log for
every change, low-stock thresholds surfaced on the Dashboard, and a correction path that
reverses rather than deletes. See
[`phases/PHASE_03_KITCHEN.md`](../phases/PHASE_03_KITCHEN.md).

**Phase 4 — Expenses (complete).** The PRD's daily bill: a day's total with a breakdown by item
and by payment method, as deterministic shareable text. Accounts resolve exactly, a refused
expense provably mutates nothing, and a negative balance stays a valid state. See
[`phases/PHASE_04_EXPENSES.md`](../phases/PHASE_04_EXPENSES.md).

Expense correction/refund and batch entry were both assessed and **deferred** by explicit
decision; the phase document records why.

**Phase 5 — Dashboard (complete).** The daily command center: the shared natural-language input,
today's top tasks, a first action that is only ever the user's own first undone task, real
low-stock from Kitchen, and today's spend taken from the same rows the daily bill uses. Cards
whose modules do not exist yet say so rather than showing an empty list. See
[`phases/PHASE_05_DASHBOARD.md`](../phases/PHASE_05_DASHBOARD.md).

**Phases 6–8 — Product areas.** Routine + Sleep, Skills + Habits, Photo + Diary, one per document
under [`phases/`](../phases/). Phase 5 deliberately did not start any of them, and it left the
Dashboard's task, skill, and habit cards pointed at real, empty tables so those phases plug into
a screen that already works. Phase 6 is complete: `plan_task` is written by the night check-in and
by five new command kinds, `sleep_log` and `nap_log` are written by hand, and the Dashboard gained
its sleep card by composing the Routine read model rather than reading the tables itself.

Phase 7 is complete: the full replacement-skill list, neutral streaks, the PRD's one progress bar
for laundry, manually entered screen time, a private log that can produce no number, and a real
photo path — laundry completion requires an uploaded picture, and the picture timeline is the Photo
Diary.

Phase 8 is **partial**. The photograph half shipped in Phase 7. What was added here is the other
half of the PRD's sentence: `/diary` is the timeline of those photos with the user's own notes
beside each one, editable and clearable in place, and `habit_log.photo_note` is where those words
live (ADR-056). The phase document's PWA deliverables — installability, camera or file-picker
access through the installed app, a manifest, a service worker, icons — are **not** done and still
need a package choice recorded as an ADR.

**Phase 9 — Hardening.** Reliability, correction paths, empty states, and test coverage
appropriate to what was actually built. See
[`phases/PHASE_09_HARDENING.md`](../phases/PHASE_09_HARDENING.md).

## Sequencing note

The plan is not a strict order. Phase 1 must come first, and Phase 2 is required before
natural-language entry is usable across modules. Phases 3–7 are largely independent slices
that can proceed in any order once the foundation and command engine exist, though
Dashboard (5) aggregates state from Kitchen and Expenses — both now complete — and deliberately
does not wait for Routine and Habits, reporting them as unavailable rather than as empty. That is
recorded in ADR-047.

## Scope: the Tonight prototype and the full target

The PRD itself draws this distinction, in section 8:

> **Tonight (V1 prototype, 2 to 3 hours of vibe coding)**: rough, black-and-white, working
> across categories, not perfect.
>
> **Later (full PRD target, not required tonight)**: push notifications, auto-categorised
> expenses, screen-time API integration, polished visuals and gamification, the "what can I
> cook" view, multi-user support.

So the two are **the same product at different depths**, not two different products. The
"Tonight" list is a deliberately smaller first delivery slice — working pages, real data, the
shared chat input, nothing polished — drawn from the full target. The "Later" list is
additional work on top of that same target, not a replacement for it.

Three consequences, recorded so this file cannot be misread later:

1. **This roadmap is the implementation path toward the full PRD target.** The PRD remains
   the authority on *what* the product does; this file is the plan for *how it gets built in
   reviewable increments*.
2. **The prototype scope does not invalidate the full target.** Delivering the Tonight slice
   does not discharge the Later list, and nothing in this roadmap exists to replace it. The
   Later items land in the later phases — much of Phase 9, and work beyond this roadmap.
3. **No phase is dropped for being unnecessary tonight.** Kitchen, Expenses, Dashboard,
   Routine + Sleep, Skills + Habits, and Photo + Diary are all required by the Tonight
   acceptance criteria in PRD section 9, and they all stay in the plan.

Foundation work is separate from both. Phases 0 and 1 are engineering infrastructure —
tooling, boundaries, schema, deterministic domain rules, the command contract, and the
execution pipeline. None of it is prototype scope, and none of it would be visible in a
tonight demo, but the prototype depends on all of it. It is not counted as prototype progress.

**Still open, and a product decision rather than a documentation one:** whether to compress
this sequence if a rough end-to-end demo is wanted sooner. That is the user's call, not this
file's. The plan below stands until it is changed deliberately.

