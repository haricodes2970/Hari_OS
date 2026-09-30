# Phase 5 — Dashboard

**Status: Planned**

Scope taken from `Hari_OS_V1_PRD.docx` section 6.1. This document does not expand it.

## Purpose

The home screen. Make the current day's real state visible in one place, so the day does
not start with a blank mind, and give the scrolling urge a single obvious way out.

## Scope

- **Today's top 3 tasks.** PRD entity `plan_task` (date, title, done), written the night
  before and visible in the morning.
- **A suggested first action for the morning.** The PRD's example is the morning music
  session. It is a suggestion, not an instruction.
- **Low-stock flags** surfaced from Kitchen.
- **Laundry and dishes status**, read from Habits.
- **Today's spend**, read from Expenses.
- **An "I feel like scrolling" entry point** that opens the full skill list. PRD section 6.5:
  one tap shows the complete list and **the user picks**.

## Dependencies

- Phase 1 complete: schema and a working data path.
- Kitchen (3), Expenses (4), Routine (6), and Habits (7) for the aggregated figures. The
  dashboard is most useful once those exist, so it is naturally last among them.
- Skills (7) for the replacement list behind the scrolling entry point.

## Boundaries

- **The assistant must never secretly choose a skill or a task.** The full skill list is
  always shown and the user chooses (PRD section 4, assistant-not-decision-maker).
- No gamification, no confetti, no points. The PRD is explicit: function over looks for V1.
- No push notifications. In-app only, per PRD section 6.6.
- No shame-oriented presentation. Private behaviors never appear as a streak, score, or
  progress bar anywhere, including here.
- No weather, calendar sync, or third-party widget.

## Expected deliverables

- Dashboard feature slice under `src/features/dashboard/`.
- Read-side queries for the aggregated figures, each owned by the feature that owns the
  data rather than reimplemented here.
- A dashboard page composing today's state.

## Verification

- Baseline suite passes.
- The dashboard renders correctly with **no** data anywhere, and does not crash. This is
  the primary acceptance condition for an aggregating view.
- Each figure shown is demonstrated to come from the owning feature's data.
- The scrolling entry point is shown to reveal the full skill list, with the user selecting
  one. A test must confirm nothing is auto-selected.
- Task and habit states shown on the dashboard match the source records.

## Status

**Planned.** No dashboard code, no dashboard page, and no aggregation logic exist today.
