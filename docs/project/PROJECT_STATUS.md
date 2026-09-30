# Project Status

- **Last updated:** 2026-09-30 (micro-phase 0.7)
- **Repository:** https://github.com/haricodes2970/Hari_OS
- **Branch:** `main`

## Current Phase

**Phase 0 — Engineering / Bootstrap Foundation**

No Hari OS product features have been built. Phase 0 makes the repository safe and organized
enough that future agents can work without damaging the architecture.

## Current Micro-Phase

**0.7 — Persistent agent/project context: COMPLETE AND VERIFIED**

Next micro-phase: **0.8 — Project documentation system.**

## Completed Micro-Phases

| Micro-phase | Commit | Status | Verified |
| --- | --- | --- | --- |
| 0.1 — Inspect repository and establish baseline | `845b83f` | Complete | Yes |
| 0.2 — Initialize/normalize Next.js foundation | `964bc29` | Complete | Yes |
| 0.3 — Development tooling | `5db3686` | Complete | Yes |
| 0.4 — Application architecture | `19206ce` | Complete | Yes |
| 0.5 — Local SQLite foundation | `caa5ca3` | Complete | Yes |
| 0.6 — Environment and local data safety | `6cbf337` | Complete | Yes |
| 0.7 — Persistent agent/project context | `25db46f` | Complete | Yes |

## Active Work

None.

## Blockers

None.

## Current State

- Next.js 16.3.7 (App Router, Turbopack) + React 19.2.8 + TypeScript 5, npm 10.9.8.
- ESLint 9 flat config from `eslint-config-next`, plus a `hari-os/boundaries` rule that
  keeps `src/domain/` and `src/components/` free of database, storage, and command
  imports. Prettier 3.9.9.
- Architecture established and documented in `docs/project/ARCHITECTURE.md`:
  `app/`, `components/`, `features/`, `domain/`, `commands/`, `lib/db/`, `lib/storage/`,
  `lib/validation/`.
- SQLite foundation in place via `src/lib/db/connection.ts`, using `better-sqlite3@13`.
  The database creates itself at `data/hari-os.db` on first access, with WAL journaling
  and foreign keys enabled. Verified by `npm run db:check`.
- **The database schema is empty by design.** Zero application tables. All PRD entities
  are deferred to later schema work, and `db:check` fails if any of them appears.
- `connection.ts` imports `server-only`, so a Client Component importing it fails the
  build. Verified with a probe route.
- Only `src/app/` and `src/lib/db/` contain code. `components/`, `features/`, `domain/`,
  `commands/`, `lib/storage/`, and `lib/validation/` still hold boundary READMEs only.
- No parser, no LLM dependency, no OpenRouter, no feature pages, no authentication, no
  uploads.
- `AGENTS.md` at the repository root holds the persistent engineering rules for coding
  agents: project identity, canonical sources of truth, stack, architecture boundaries,
  database rules, data and secret safety, the LLM boundary, product principles, Git and
  micro-phase workflow, verification expectations, scope control, and documentation
  discipline. It deliberately carries no live status.
- Environment handling is explicit: a tracked `.env.example` documents the single variable
  the code reads, `HARI_OS_DB_PATH`. No `.env` file is committed. Every secret and
  local-data ignore rule has been proven against real files, including WAL sidecars and a
  database created outside `data/`.
- Localhost only, no deployment.


## Tooling

| Script | Command |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | `prettier --write .` |
| `npm run format:check` | `prettier --check .` |
| `npm run db:check` | Verify the SQLite foundation |

## Verification Status for 0.7

| Check | Command | Result |
| --- | --- | --- |
| Install | `npm install` | Pass — 0 vulnerabilities |
| Formatting | `npm run format:check` | Pass |
| TypeScript | `npm run typecheck` | Pass — 0 errors |
| Lint | `npm run lint` | Pass — 0 errors, 0 warnings |
| Production build | `npm run build` | Pass |
| SQLite foundation | `npm run db:check` | Pass — no feature tables |
| Cited commit messages exist | compared against `git log` | Pass — 2 errors found and corrected |
| Cited ADRs exist | compared against `DECISIONS.md` | Pass — ADR-001, 012, 014 all real |
| Cited paths exist | compared against the filesystem | Pass — only `docs/phases/` and `src/types/` absent, both labelled as absent |
| No forbidden tech in code | grep across `src/` and config | Pass — no Supabase, ORM, Tailwind, PWA package, auth, or deployment |
| Secrets/data staged | `git status` and diff scan | Pass — none |

AGENTS.md was validated against the PRD, ARCHITECTURE.md, DECISIONS.md, and the actual
repository rather than written from memory. Two factual errors were caught and fixed: a
commit message attributed to the wrong type, and an example quoting a future commit that
does not exist yet.

## Latest Commit

`25db46f` — `chore(0.7): establish persistent agent context`

## Next Action

Micro-phase **0.8 — Project documentation system.** Create the phase documents under
`docs/phases/`, complete the project tracking set, and record the results of Phase 0 in a
session report. This closes Phase 0.

## Known Issues

- `npm install` prints `npm warn deprecated eslint@9.39.5`. This comes from
  `eslint-config-next@16.3.7`'s own dependency range, not from a package chosen here. It is
  upstream and is not an introduced warning. No configuration was weakened to suppress it.
  Re-evaluate when Next ships a config on a supported ESLint major.
