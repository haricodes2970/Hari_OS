# Roadmap

Phase-level plan for Hari OS. Ten phases, no dates and no estimates.

**Phase status is authoritative in `PROJECT_STATUS.md`.** This file is the plan, not the
live state. If the two ever disagree, `PROJECT_STATUS.md` is correct.

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Foundation infrastructure | Complete |
| 1 | Application foundation | Planned |
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
application skeleton. See [`phases/PHASE_01_FOUNDATION.md`](../phases/PHASE_01_FOUNDATION.md).

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

## Known divergence from the PRD

`Hari_OS_V1_PRD.docx` section 8 scopes a "V1 prototype, 2 to 3 hours of vibe coding" with
broad coverage across all categories, and lists features such as a "what can I cook" view as
later stretch work. This roadmap is more granular and spreads the same product surface
across nine phases.

**This is unresolved and is raised rather than decided here.** It is a real tension: a
2–3 hour prototype and a nine-phase build are different products of the same requirements.
The user decides whether the phased plan supersedes the PRD's prototype framing. Until it
is settled, treat the PRD as the product authority on *what* and this roadmap as the plan
for *how it gets built in reviewable increments*.
