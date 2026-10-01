# Phase 7 — Skills and Habits

**Status: Complete and verified**

Delivered 2026-10-01. See `docs/project/DECISIONS.md` ADR-051 through ADR-055 and
`docs/sessions/2026-10-01-session-06.md` for what was actually built and verified.

Scope taken from `Hari_OS_V1_PRD.docx` sections 6.5 and 6.6. This document does not expand
it.

## Purpose

Give every urge a replacement action rather than only a prohibition, and track neutral daily
habits without turning private behavior into a scoreboard.

## Scope

### Skills (PRD 6.5)

- **A user-defined list of replacement activities** for the up to 10 skills chosen for the
  next 30 days. The PRD's examples: read a book, vibe code a platform, understand a problem
  statement, research for studies, 10 pushups.
- **One tap on an urge shows the full list.** The user then picks. The application never
  auto-picks.
- **Logging what was done and for how long.** Duration is optional per the PRD. PRD
  entities `skill` (name, active) and `skill_log` (skill, timestamp, minutes).
- **A per-skill tally.** A neutral streak is allowed here.

### Habits (PRD 6.6)

- **Cooking, dishes, and laundry**, each with a streak and a progress bar. Laundry has a
  target of twice per week. PRD entity `habit_log` (date, type of cooking / dishes /
  laundry, done, photo_url).
- **Laundry photo proof.** The PRD states the application does not accept a text claim
  alone. A placeholder was allowed in V1 and **was not taken**: the real upload path shipped in
  Phase 7, so the Photo Diary in V1 is the timeline of laundry photos (ADR-051).
- **Manual screen-time entry.** The PRD marks automatic screen-time integration as later
  work, so no platform API is involved.
- **Private logs** for doom-scrolling incidents and masturbation: a yes/no plus an optional
  note. PRD entity `private_log` (date, type, note).

## Dependencies

- Phase 1 complete: schema and a working data path.
- Phase 2 for sentence-based logging such as "did laundry".
- Phase 8 was assumed to own the real laundry photo upload. It does not: Phase 7 shipped
  it, and Phase 8 has no upload work left to do.
- Dashboard (5) consumes the laundry and dishes status, and hosts the scrolling-urge entry
  point that opens the skill list.

## Boundaries

- **Private logs are never shown as a streak, score, or progress bar.** No exception. The PRD
  prohibits this directly, and the reason is to avoid a shame spiral — this is a product
  requirement about the user's wellbeing, not a display preference.
- **The system never silently auto-selects a skill** (PRD section 4).
- The skill list is never hidden, truncated, or reordered into a recommendation the user did
  not ask for.
- **No screen-time platform API, no device permission prompt.** Manual entry only.
- No push notifications. In-app reminders only; the PRD is explicit.
- No streaks, scores, or leaderboards for anything other than the neutral habits the PRD
  names.

## Expected deliverables

- Skills and habits feature slices under `src/features/skills/` and `src/features/habits/`.
- Schema for `skill`, `skill_log`, and `private_log`, plus the habit log.
- A skill list view and a habit view, both tolerating empty data.
- The scrolling-urge entry point opening the full skill list.

## Verification

- Baseline suite passes.
- The urge entry point is shown to reveal the **complete** skill list, and the user selects
  one. A test must confirm nothing is selected automatically.
- A logged skill entry with a duration produces the expected per-skill tally.
- Cooking, dishes, and laundry each demonstrate a streak and a progress bar.
- **A private log entry is created and shown in a review that contains no streak, no score,
  and no progress bar for that entry.** This is a direct PRD requirement and needs a
  demonstrated check, not an assumption.
- Laundry cannot be marked complete on a text claim alone; the PRD-sanctioned placeholder
  behaviour is shown.
- Pages render with no data and do not crash.
- `npm run db:check` passes with the expected tables.

## What was delivered

**Schema.** One migration, `002_screen_time`, rebuilding `habit_log` to accept a fourth type and a
validated `minutes` column. `skill`, `skill_log`, and `private_log` were already in the schema and
needed nothing.

**Features.** `src/features/skills/` and `src/features/habits/`, with `private-log.ts` and
`photos.ts` as separate modules for the two rules that needed their own boundary.

**Commands.** `skill.create`, `skill.log`, `habit.record`, and `private.log` — 14 kinds in total,
each carrying only stated facts. No command can claim a photo exists, and no private command can
carry a count.

**Pages.** `/skills` and `/habits`, two new navigation items, and the Dashboard's urge entry point
now opening the real list.

**Photos.** `POST /api/photos`, `GET /api/photos/<id>/<filename>`, magic-byte validated,
server-named, size-limited, stored under `data/uploads/`, and never referenced by path.

## Verification actually performed

- `skills:test` — 150 assertions, 0 failures: the full list, the ten-skill cap, duplicates, tallies,
  streaks, the weekly target, screen time, private entries, the photo path, the routes, and the
  Dashboard's reach.
- `domain:test` — 258 assertions, 0 failures, including 45 new pure-rule assertions for this phase.
- `skills:accept` — 62 HTTP checks against a production build on a disposable database: both pages
  on a never-used database, the complete list through the Dashboard's entry point, a photo uploaded
  and served back, `did laundry` refused and then accepted, and the private section asserted free of
  streaks, scores, bars, percentages, and counts.
- `architecture:probe` — 58 probes, up from 47.
- Baseline: `format:check`, `typecheck`, `lint`, `build`, `db:check`, and all 12 test suites pass.
  `dashboard:accept`, `routine:accept`, and `responsive:check` pass with their Phase 7 expectations
  updated.

## Two defects found and fixed here

- **`habitStreak` did not end a streak.** It walked back from the most recent day recorded as *done*,
  so a day the user explicitly recorded as not done had no effect — the exact opposite of the rule
  its own comment described, and of the PRD's distinction between "not recorded" and "not done". It
  now walks from today, skipping only today itself.
- **A "no" answer grew the private log.** It re-inserted the entry with a null note instead of
  removing it, so correcting a mistake left a row behind. `PrivateLogRepository.removeForDay` now
  exists and a correction is a deletion.
