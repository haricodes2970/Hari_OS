# Roadmap

Phase-level plan for Hari OS. Ten phases, no dates and no estimates.

**Phase status is authoritative in `PROJECT_STATUS.md`.** This file is the plan, not the
live state. If the two ever disagree, `PROJECT_STATUS.md` is correct.

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Foundation infrastructure | Complete |
| 1 | Application foundation | Active (1.1–1.4 complete) |
| 2 | Command engine | Planned |
| 3 | Kitchen | Planned |
| 4 | Expenses | Planned |
| 5 | Dashboard | Planned |
| 6 | Routine + Sleep | Planned |
| 7 | Skills + Habits | Planned |
| 8 | Photo + Diary | Planned |
| 9 | Hardening | Planned |

## Phase summaries

**Phase 0 — Foundation infrastructure (complete).** Engineering bootstrap: repository
baseline, Next.js foundation, tooling, architecture boundaries, SQLite foundation, and
local data safety. No product features. Detail in
[`REPOSITORY_BASELINE.md`](REPOSITORY_BASELINE.md) and the session reports.

**Phase 1 — Application foundation.** The transition from infrastructure into a usable
application skeleton: schema, deterministic domain rules, the command contract, and the
execution pipeline. Active; 1.1–1.4 complete. See
[`phases/PHASE_01_FOUNDATION.md`](../phases/PHASE_01_FOUNDATION.md).

**Phase 2 — Command engine.** Natural-language input parsed into a validated, structured
intent, with deterministic execution. See
[`phases/PHASE_02_COMMAND_ENGINE.md`](../phases/PHASE_02_COMMAND_ENGINE.md).

**Phases 3–8 — Product areas.** Kitchen, Expenses, Dashboard, Routine + Sleep, Skills +
Habits, Photo + Diary, one per document under [`phases/`](../phases/).

**Phase 9 — Hardening.** Reliability, correction paths, empty states, and test coverage
appropriate to what was actually built. See
[`phases/PHASE_09_HARDENING.md`](../phases/PHASE_09_HARDENING.md).

## Sequencing note

The plan is not a strict order. Phase 1 must come first, and Phase 2 is required before
natural-language entry is usable across modules. Phases 3–7 are largely independent slices
that can proceed in any order once the foundation and command engine exist, though
Dashboard (5) aggregates state from Kitchen, Expenses, Routine, and Habits, so it is most
useful last among them.

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

