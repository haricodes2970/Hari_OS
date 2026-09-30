# Project Status

- **Last updated:** 2026-09-30 (micro-phase 1.2)
- **Repository:** https://github.com/haricodes2970/Hari_OS
- **Branch:** `main`

## Current Phase

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Foundation infrastructure | **Complete** |
| 1 | Application foundation | **Active** |

**Phase 0 is complete.** All eight micro-phases are done and verified.

**Phase 1 is active.** Micro-phase 1.1 established the V1 SQLite schema; micro-phase 1.2
established the pure domain rules. No feature code exists yet, and nothing connects the domain
rules to storage.

## Current Micro-Phase

**1.2 — Domain model and deterministic operations: COMPLETE AND VERIFIED**

Next micro-phase: **1.3 — persistence for the domain rules.** Its scope must be planned
before work begins; it is not invented here. The natural candidate is the first end-to-end
slice: repositories in `src/lib/db/`, a feature module, and a route, so that a spend or a
stock change actually reaches SQLite through a domain rule. Phase 1's overall scope is in
`docs/phases/PHASE_01_FOUNDATION.md`.

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
| 0.8 — Project documentation system | `73ed2b3` | Complete | Yes |
| 1.1 — Data schema foundation | `87e9dad` | Complete | Yes |
| 1.2 — Domain model and deterministic operations | `6782446` | Complete | Yes |

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
- **V1 schema implemented in micro-phase 1.1.** Eleven PRD tables plus `schema_migrations`,
  created by an ordered migration in `src/lib/db/migrations.ts`. `npm run db:check` verifies
  tables, columns, constraints, and the absence of unexpected tables.
  `npm run db:test` runs 53 isolated tests on temporary databases.
  **No seed data exists and no domain result reaches the schema yet.**
- `connection.ts` imports `server-only`, so a Client Component importing it fails the
  build. Verified with a probe route.
- Only `src/app/` and `src/lib/db/` contain code. `components/`, `features/`, `domain/`,
  `commands/`, `lib/storage/`, and `lib/validation/` still hold boundary READMEs only.
- **Pure domain rules in place** from micro-phase 1.2, in `src/domain/`: money, quantity,
  inventory, and accounts, all returning `Result` and all tested in memory with
  `npm run domain:test` (170 assertions). Purity is enforced by the `hari-os/domain-purity`
  lint rule. **No repositories, services, or query modules connect them to SQLite yet.**
- No parser, no LLM dependency, no OpenRouter, no feature pages, no authentication, no
  uploads, no test framework beyond the two database scripts.
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
| `npm run db:check` | Apply migrations and verify the V1 schema |
| `npm run db:test` | Isolated schema and constraint tests on temporary databases |
| `npm run domain:test` | Domain rule tests, in memory, with no database |

## Verification Status for 1.2

| Check | Command | Result |
| --- | --- | --- |
| Install | `npm install` | Pass — 0 vulnerabilities |
| Formatting | `npm run format:check` | Pass |
| TypeScript | `npm run typecheck` | Pass — 0 errors |
| Lint | `npm run lint` | Pass — 0 errors, 0 warnings |
| Production build | `npm run build` | Pass |
| Schema intact | `npm run db:check` | Pass — unchanged, 11 V1 tables |
| Schema tests | `npm run db:test` | Pass — 53 passed, 0 failed |
| **Domain tests** | `npm run domain:test` | **Pass — 170 passed, 0 failed** |
| Real database untouched | `md5sum` before/after | Pass — identical, 0 application rows |
| No new tables | table count | Pass — still 12 |
| Domain needs no SQLite | `better-sqlite3` removed from `node_modules` | Pass — 170 tests still pass |
| Domain purity rule fires | probe file | Pass — 7 violations caught, then probe deleted |
| Determinism audit | `grep` + replay tests | Pass — no clock, no random, no fs, no mutation |
| New dependencies | `package.json` diff | Pass — none added |
| Secrets or data staged | `git status` | Pass — none |

The `better-sqlite3` check is the real proof of the boundary: the domain suite was run with
the driver removed from `node_modules` and passed unchanged, so it cannot be reaching the
database by any path.

## Verification Status for 1.1

Retained for history. All checks passed; see `docs/sessions/2026-09-30-session-02.md`.

## Phase 0 Deliverables

- Next.js 16.3.7 + TypeScript application that builds, serves, and renders
- ESLint 9 with an architecture boundary rule that fails the build on violations
- Prettier 3.9.9, `format` and `format:check` scripts
- Directory architecture with `hari-os/boundaries` enforced, not merely documented
- SQLite foundation: `data/hari-os.db`, created on demand, verified by `npm run db:check`
- `server-only` guard proven to fail a build on client import
- `.env.example` plus a proven ignore boundary for every secret and local-data path
- `AGENTS.md` carrying persistent engineering rules
- `docs/` navigation, roadmap, and phase documents for Phases 1–9
- `docs/sessions/2026-09-29-session-01.md` and `docs/sessions/2026-09-30-session-01.md`

**Deliberately not built in Phase 0:** any product feature, any feature schema, the command
parser, OpenRouter, authentication, deployment, PWA packaging, uploads, and test
infrastructure.

## Latest Commit

`73ed2b3` — `docs(0.8): establish project documentation system`

## Next Action

**1.3 is not yet defined in detail.** The natural candidate is the first feature slice end to
end — a route, a feature, a domain rule, and `src/lib/db/` — starting with Kitchen or
Expenses. The Phase 1 scope in `docs/phases/PHASE_01_FOUNDATION.md` expects a real data round
trip and negative cases.

One open item is carried forward: the **PRD-versus-roadmap scope divergence** recorded in
`docs/project/ROADMAP.md` is unresolved. The PRD frames V1 as a 2–3 hour prototype; the
roadmap spreads the same surface across nine phases. The user decides which governs.

## Known Issues

- `npm install` prints `npm warn deprecated eslint@9.39.5`. This comes from
  `eslint-config-next@16.3.7`'s own dependency range, not from a package chosen here. It is
  upstream and is not an introduced warning. No configuration was weakened to suppress it.
  Re-evaluate when Next ships a config on a supported ESLint major.
