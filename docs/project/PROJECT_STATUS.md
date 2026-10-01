# Project status

**Authority for phase, micro-phase, and next action.** `ROADMAP.md` is the plan; this file is
the state. Where they disagree, this file is correct.

- **Current phase:** 6 — Routine and Sleep. **Complete and verified.**
- **Latest commit:** `015aa38` — `feat(6): complete routine and sleep`
- **Working tree:** see `git status`. Local user data under `data/` is untracked by design.
- **Blockers:** none. The threshold-of-zero discrepancy Phase 5 recorded was resolved in Phase 6
  (ADR-048): the code's behaviour was kept and `ARCHITECTURE.md` section 15 was corrected, because
  `quantity <= threshold` means a zero threshold flags an item only at zero, which is not the bug
  the old wording described.

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
| 7 — Skills + Habits | **Not started** | — | `skill` and `habit_log` are read; nothing writes them |
| 8 — Photo + Diary | Not started | — | |
| 9 — Hardening | Not started | — | |

## Next action

Phase 7, Skills + Habits, when the user asks for it. `docs/phases/PHASE_07_SKILLS_HABITS.md` is
the plan. What Phase 6 leaves behind: `habit_log` rows are read by the Dashboard and nothing writes
them, and the Dashboard's skills card is still a truthful unavailable state with `SKILLS_AVAILABLE
= false`. The user picks from the full skill list — nothing is auto-selected — and the PRD's
prohibition on shame-based streaks applies to private behaviours.

Phase 7 was **not** started in this run.

## Open items carried forward

- **Expense correction and refund.** Deferred by decision in Phase 4: `expense` has
  `CHECK (amount >= 0)` and no `source_text`, so a reversal has nowhere to live.
- **Batch expense entry.** The PRD contradicts itself; Phase 2's one-sentence-one-command ADR
  stands.
- **The baseline database fingerprint discrepancy** recorded in 1.5 remains unexplained.
- **PRD-versus-roadmap scope divergence** in `ROADMAP.md` is unresolved and is the user's call.
- **No live OpenRouter call has ever been made.** Every sentence path is proven against a local
  stub and an injected transport; no `OPENROUTER_API_KEY` has been available in any phase.
