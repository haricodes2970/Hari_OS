# Project status

**Authority for phase, micro-phase, and next action.** `ROADMAP.md` is the plan; this file is
the state. Where they disagree, this file is correct.

- **Current phase:** 5 — Dashboard. **Complete and verified.**
- **Latest commit:** `a87210c` — `feat(5): complete dashboard`
- **Working tree:** see `git status`. Local user data under `data/` is untracked by design.
- **Blockers:** none. One documented discrepancy is open and is the user's call: `ARCHITECTURE.md`
  section 15 says a low-stock threshold of zero is refused; the code accepts it and flags the
  item only while its quantity is zero. Neither has been silently changed.

## Phase 5 — Dashboard: complete

Delivered as one unit. `docs/phases/PHASE_05_DASHBOARD.md` and
`docs/sessions/2026-10-01-session-04.md` have the detail.

**What exists now.** The Dashboard is a read-only command center assembled from real state: the
shared natural-language input, today's top three tasks with a first action that is only ever the
user's own first undone task, low stock from Kitchen, and today's spend taken from the same rows
the daily bill uses.

**The read boundary.** `src/features/dashboard/view.ts` is the only thing the page reads. It
composes the Kitchen and Expenses read sides and two focused repository reads (`plan_task`,
`habit_log`), and it contains no comparison, no sum, and no clock. `readDashboardSummary` moved
out of `src/features/shared/queries.ts` so there is one definition of what the Dashboard shows
(ADR-047).

**What is deliberately not implemented.** Routine, Sleep, Skills, Habits, and Photo Diary are
Phases 6–8. Their cards state that they are unavailable. No task, skill, habit, photo, or log is
fabricated, and `plan_task` and `habit_log` are read but never written by anything in `src/`.

**Verification.** 10 test suites, 1253 assertions, 0 failures, up from 9 and 1177. 39 architecture
probes, up from 27 — the new ones cover the Dashboard and `src/app` boundary scopes. A 57-check
HTTP acceptance run and a 29-check headless-browser responsive run at 320, 390, and 1440px both
pass. `format:check`, `typecheck`, `lint`, `build`, and `db:check` pass with 0 errors and 0
warnings. The development database is byte-identical (SHA-256
`5e95474b50cedb4d1f88854d77a664382faae2d9946b481f02cbe460e21ab841`) with no WAL/SHM sidecars.

## Phase history

| Phase | Status | Commit | Notes |
| --- | --- | --- | --- |
| 0 — Foundation infrastructure | Complete | — | Repository baseline, tooling, SQLite foundation, data safety |
| 1 — Application foundation | Complete | — | Schema, domain, command contract, execution, persistence, first slice (1.1–1.6) |
| 2 — Command engine | Complete | — | Parser, validator, executor pipeline, OpenRouter boundary, shared input |
| 3 — Kitchen | Complete | `da9a89c` | Inventory, thresholds, history, correction/reversal, Dashboard integration |
| 4 — Expenses | Complete | `71ac329` | Accounts, natural-language expense entry, daily bill, Dashboard integration |
| 5 — Dashboard | **Complete** | `a87210c` | Read model, real low stock and spend, truthful deferred cards, boundary probes |
| 6 — Routine + Sleep | **Not started** | — | `plan_task` is read by the Dashboard; nothing writes it |
| 7 — Skills + Habits | **Not started** | — | `skill` and `habit_log` are read; nothing writes them |
| 8 — Photo + Diary | Not started | — | |
| 9 — Hardening | Not started | — | |

## Next action

Phase 6, Routine + Sleep, when the user asks for it. Its first task is defined by what Phase 5
left behind: `plan_task` rows exist in the schema and are already displayed, and nothing creates
them. Routine's entry point should write them through the existing command path rather than
around it, and the Dashboard's task card and first-action line should keep working unchanged.

Phase 6 was **not** started in this run.

## Open items carried forward

- **The threshold-of-zero discrepancy** described at the top of this file. Recorded, not fixed.
- **Expense correction and refund.** Deferred by decision in Phase 4: `expense` has
  `CHECK (amount >= 0)` and no `source_text`, so a reversal has nowhere to live.
- **Batch expense entry.** The PRD contradicts itself; Phase 2's one-sentence-one-command ADR
  stands.
- **The baseline database fingerprint discrepancy** recorded in 1.5 remains unexplained.
- **PRD-versus-roadmap scope divergence** in `ROADMAP.md` is unresolved and is the user's call.
- **No live OpenRouter call has ever been made.** Every sentence path is proven against a local
  stub and an injected transport; no `OPENROUTER_API_KEY` has been available in any phase.
