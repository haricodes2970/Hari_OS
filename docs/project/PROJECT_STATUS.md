# Project Status

- **Last updated:** 2026-09-30 (micro-phase 1.5)
- **Repository:** https://github.com/haricodes2970/Hari_OS
- **Branch:** `main`

## Current Phase

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Foundation infrastructure | **Complete** |
| 1 | Application foundation | **Active** |

**Phase 0 is complete.** All eight micro-phases are done and verified.

**Phase 1 is active.** Micro-phases 1.1 through 1.5 are complete: schema, pure domain rules,
the validated command contract, the execution pipeline, and the first vertical slice. A user
can now record stock changes and expenses through the UI, and see the result persisted.

## Current Micro-Phase

**1.5 — First real vertical slice: COMPLETE AND VERIFIED**

Next micro-phase: **1.6 — foundation verification pass. NOT STARTED.** Its scope must be
planned before work begins; it is not invented here. Phase 1's overall scope is in
`docs/phases/PHASE_01_FOUNDATION.md`.

A command now travels the full path — Dashboard, Kitchen, or Expenses, `POST /api/commands`,
validation, execution, domain, SQLite, then back to a page that shows the stored result.

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
| 1.3 — Validation and structured command contract | `5578457` | Complete | Yes |
| 1.4 — Command execution foundation | `0d94aad` | Complete | Yes |
| 1.5 — First real vertical slice | `6f95885` | Complete | Yes |

## Active Work

None. Micro-phase 1.5 is complete and verified; 1.6 is not started.

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
- **Every layer now contains code.** `lib/storage/` holds its boundary README only.
- **Pure domain rules in place** from micro-phase 1.2, in `src/domain/`: money, quantity,
  inventory, and accounts, all returning `Result` and all tested in memory with
  `npm run domain:test` (170 assertions). Purity is enforced by the `hari-os/domain-purity`
  lint rule. **No repositories, services, or query modules connect them to SQLite yet.**
- **Validated command contract in place** from micro-phase 1.3. `src/commands/contract.ts`
  declares four command kinds carrying facts only, and `parseCommand` in
  `src/lib/validation` turns an untrusted object into a command or a list of specific issues.
  93 tests, no database dependency, no parser and no LLM.
- **Execution pipeline in place** from micro-phase 1.4. `src/lib/db/repositories.ts` is the
  only module that reads or writes application tables, and `src/commands/executor.ts`
  sequences a validated command: resolve names to rows, apply the domain operation, persist
  the result atomically. 76 integration tests against real SQLite.
  **No route, feature, or UI invokes it yet, so no production path can execute a command.**
- **First vertical slice in place from micro-phase 1.5.** Dashboard (`/`), Kitchen
  (`/kitchen`), and Expenses (`/expenses`) read persisted state and render it. The shared
  `CommandForm` is a Server Component posting to `POST /api/commands` — the single command
  entry point (ADR-036). There is no client JavaScript in the form and no hydration boundary;
  the endpoint answers `303 See Other` with an outcome token that `OutcomeBanner` renders, so
  the form works identically with and without JavaScript (ADR-037).
- **`npm run db:setup`** creates the first-run rows the commands need: three accounts at a
  zero opening balance, and three example stock items. It is idempotent, and nothing in `src/`
  creates rows (ADR-039). `getDb()` migrates on open, so a new database renders empty states
  instead of erroring (ADR-038).
- **`npm run app:test`** runs 68 tests covering form translation, return-path safety, the
  end-to-end slice, failure containment, outcome reporting, and display reads, against real
  SQLite on a disposable database.
- No parser, no LLM dependency, no OpenRouter, no pages beyond the three above, no
  authentication, no uploads, no test framework beyond the five scripts.
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
| `npm run contract:test` | Command contract and validation tests, in memory |
| `npm run exec:test` | Command execution against real SQLite in temporary databases |

## Verification Status for 1.4

| Check | Command | Result |
| --- | --- | --- |
| Formatting | `npm run format:check` | Pass |
| TypeScript | `npm run typecheck` | Pass — 0 errors |
| Lint | `npm run lint` | Pass — 0 errors, 0 warnings |
| Production build | `npm run build` | Pass |
| Schema intact | `npm run db:check` | Pass — unchanged, 11 V1 tables |
| Schema tests | `npm run db:test` | Pass — 53 passed, 0 failed |
| Domain tests | `npm run domain:test` | Pass — 170 passed, 0 failed |
| Contract tests | `npm run contract:test` | Pass — 93 passed, 0 failed |
| **Execution tests** | `npm run exec:test` | **Pass — 76 passed, 0 failed** |
| Development database untouched | `md5sum` before/after | Pass — identical |
| Domain is SQLite-free | grep audit | Pass |
| Validation is persistence-free | grep audit | Pass |
| No SQL outside `src/lib/db` | grep audit | Pass |
| Command layer cannot persist | probe file | Pass — `connection`, `migrations`, `schema`, `better-sqlite3` all blocked |
| Command layer may use repositories | lint on executor | Pass — permitted deliberately |
| No LLM, network, route, or UI | grep audit + file listing | Pass |
| New dependencies | `package.json` diff | Pass — none added |

Atomicity is proven with real SQLite rather than mocks: a `BEFORE INSERT` trigger raises
mid-transaction, and the tests assert the surviving state afterwards. The expense case proves
the balance rolls back when the expense insert fails; the inventory case proves the quantity
rolls back when the event insert fails.

## Verification Status for 1.3

Retained for history. All checks passed; see `docs/sessions/2026-09-30-session-04.md`.

## Verification Status for 1.2

Retained for history. All checks passed; see `docs/sessions/2026-09-30-session-03.md`.

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

`6f95885` — `feat(1): complete first vertical slice`

## Next Action

**1.6 is not yet defined in detail.** It is the foundation verification pass that closes
Phase 1. The Phase 1 scope in `docs/phases/PHASE_01_FOUNDATION.md` expects a real data round
trip and negative cases, both of which 1.5 has now delivered and verified, so 1.6 should
audit that surface rather than build new feature scope.

Carried-forward limitations that 1.6 should consider, none of which were fixed in 1.5:

- The expense ledger cannot record a correcting entry, because `expense` holds non-negative
  spends only. A fix requires a migration.
- There is no command to create an inventory item or to set an opening balance, so both come
  from `npm run db:setup` and an account reads `₹0.00` until one is spent from.
- The Dashboard's task list renders, but nothing creates `plan_task` rows, so it is always
  empty. Task planning is out of Phase 1 scope.

One open item is carried forward: the **PRD-versus-roadmap scope divergence** recorded in
`docs/project/ROADMAP.md` is unresolved. The PRD frames V1 as a 2–3 hour prototype; the
roadmap spreads the same surface across nine phases. The user decides which governs.

## Known Issues

- `npm install` prints `npm warn deprecated eslint@9.39.5`. This comes from
  `eslint-config-next@16.3.7`'s own dependency range, not from a package chosen here. It is
  upstream and is not an introduced warning. No configuration was weakened to suppress it.
  Re-evaluate when Next ships a config on a supported ESLint major.
