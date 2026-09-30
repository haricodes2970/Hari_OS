# Phase 7 — Skills and Habits

**Status: Planned**

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
  alone. A placeholder is allowed in V1; the real upload is Phase 8.
- **Manual screen-time entry.** The PRD marks automatic screen-time integration as later
  work, so no platform API is involved.
- **Private logs** for doom-scrolling incidents and masturbation: a yes/no plus an optional
  note. PRD entity `private_log` (date, type, note).

## Dependencies

- Phase 1 complete: schema and a working data path.
- Phase 2 for sentence-based logging such as "did laundry".
- Phase 8 for real laundry photo upload. Phase 7 can ship with the PRD-sanctioned
  placeholder.
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

## Status

**Planned.** No skills or habits code, no related schema, and no pages exist today.
