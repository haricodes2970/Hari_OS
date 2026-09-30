# Phase 6 — Routine and Sleep

**Status: Planned**

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

## Verification

- Baseline suite passes.
- A night check-in stores 3 tasks and the phone confirmation, and the morning view shows
  exactly those tasks.
- Bedtime, sleep time, wake time, and nap start/end round-trip through a restart.
- **Both soft warnings are demonstrated firing and not firing** — over 30 minutes, and after
  3 PM — and are shown as warnings, never as a block or a failure state.
- The sleep streak is demonstrated updating on a neutral habit, with a check that no score
  or shaming language is rendered.
- The pages render with no entries at all and do not crash.
- `npm run db:check` passes with the expected tables.

## Status

**Planned.** No routine or sleep code, no related schema, and no pages exist today.
