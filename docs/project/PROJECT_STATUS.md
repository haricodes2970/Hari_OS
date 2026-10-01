# Project Status

- **Last updated:** 2026-10-01 (Phase 2, command engine)
- **Repository:** https://github.com/haricodes2970/Hari_OS
- **Branch:** `main`

## Current Phase

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Foundation infrastructure | **Complete** |
| 1 | Application foundation | **Complete** |
| 2 | Command engine (natural language) | **Complete** |

**Phase 0 is complete.** All eight micro-phases are done and verified.

**Phase 1 is complete.** All six micro-phases are done and verified: schema, pure domain
rules, the validated command contract, the execution pipeline, persistence, the server
boundary, and a user-facing vertical slice. A user can record stock changes and expenses
through the UI and see the result persisted.

**Phase 2 is complete.** The natural-language command engine is implemented and verified:
a sentence is parsed by a language model into an untrusted proposal, allowlisted into a
command candidate, and applied by the Phase 1 executor with no arithmetic performed by the
model. Detail in `docs/sessions/2026-10-01-session-01.md`.

## Current Micro-Phase

**Phase 2 — Command engine: COMPLETE AND VERIFIED**

There is no active micro-phase. Phase 2 was delivered as one unit, because the parser, the
provider, the engine, and the route are only meaningful together: a parser with no route is
untestable, and a route with no parser is a stub.

The automated suite is 717 assertions, up from 460. The live provider call is **not**
verified — no `OPENROUTER_API_KEY` was available. Everything reachable without a credential
is verified, including the provider itself, which is tested against a local HTTP stub.

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
| 1.6 — Phase 1 foundation verification and closeout | `946d807` | Complete | Yes |
| 2 — Command engine (natural language) | `pending commit` | Complete | Yes, except the live provider call |

## Active Work

None. Phases 0, 1, and 2 are complete.

## Blockers

None.

## Not verified

- **A live OpenRouter call.** No `OPENROUTER_API_KEY` or `OPENROUTER_MODEL` was available, so
  no request has ever reached the real provider. The request this application builds is asserted
  against a local HTTP stub in `scripts/chat-test.mjs` section 37 and against an injected
  transport in `scripts/parser-test.mjs` section 21, but the model id, the account, and the
  schema's acceptance by a real provider remain untested. Everything up to the socket is verified.
- **Two architecture gaps found during verification and not fixed here.** `src/lib/db` may
  import `@/commands/parser`, and `src/commands` may import
  `@/features/shared/command-runtime`. Both are pre-existing gaps in the Phase 0/1 lint
  configuration rather than Phase 2 regressions, and neither is exercised by the current code.
  Closing them is an architecture change and needs an ADR.

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
  **`getDb()` applies migrations on open (ADR-038). First-run rows come from
  `npm run db:setup`; nothing in `src/` inserts rows (ADR-039).**
- `connection.ts` imports `server-only`, so a Client Component importing it fails the
  build. Verified with a probe route.
- **Every layer now contains code.** `lib/storage/` holds its boundary README only.
- **Pure domain rules in place** from micro-phase 1.2, in `src/domain/`: money, quantity,
  inventory, and accounts, all returning `Result` and all tested in memory with
  `npm run domain:test` (170 assertions). Purity is enforced by the `hari-os/domain-purity`
  lint rule. **The executor calls these operations directly; it contains no arithmetic of
  its own.**
- **Validated command contract in place** from micro-phase 1.3. `src/commands/contract.ts`
  declares four command kinds carrying facts only, and `parseCommand` in
  `src/lib/validation` turns an untrusted object into a command or a list of specific issues.
  93 tests, no database dependency, no parser and no LLM.
- **Execution pipeline in place** from micro-phase 1.4. `src/lib/db/repositories.ts` is the
  only module that reads or writes application tables, and `src/commands/executor.ts`
  sequences a validated command: resolve names to rows, apply the domain operation, persist
  the result atomically. 76 integration tests against real SQLite.
  **Reached in production only through `POST /api/commands`.**
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
| `npm run db:setup` | Create first-run accounts and example stock (explicit, idempotent) |
| `npm run db:test` | Isolated schema and constraint tests on temporary databases |
| `npm run domain:test` | Domain rule tests, in memory, with no database |
| `npm run contract:test` | Command contract and validation tests, in memory |
| `npm run exec:test` | Command execution against real SQLite in temporary databases |
| `npm run app:test` | Form translation through to persisted state (68 tests) |

## Verification Status for Phase 1 (1.6 closeout)

Re-run in full at closeout. Nothing was added or changed to make these pass.

| Check | Command | Result |
| --- | --- | --- |
| Formatting | `npm run format:check` | Pass |
| TypeScript | `npm run typecheck` | Pass — 0 errors |
| Lint | `npm run lint` | Pass — 0 errors, 0 warnings |
| Production build | `npm run build` | Pass — 4 routes, all dynamic except `_not-found` |
| Schema intact | `npm run db:check` | Pass — 13 checks, 11 V1 tables, no unexpected tables |
| Schema tests | `npm run db:test` | Pass — 53 passed, 0 failed |
| Domain tests | `npm run domain:test` | Pass — 170 passed, 0 failed |
| Contract tests | `npm run contract:test` | Pass — 93 passed, 0 failed |
| Execution tests | `npm run exec:test` | Pass — 76 passed, 0 failed |
| Application tests | `npm run app:test` | Pass — 68 passed, 0 failed |
| **Total assertions** | | **460 passed, 0 failed** |
| Dependency direction | grep audit | Pass — see ARCHITECTURE.md section 11 |
| No SQL outside `src/lib/db` | grep audit | Pass |
| No `better-sqlite3` outside `src/lib/db` | grep audit | Pass |
| No client components exist | grep audit | Pass — zero `"use client"` files |
| Single command entry point | grep audit | Pass — one production call site |
| Clock confinement | grep audit | Pass — `new Date()` only in the runtime boundary and migrations |
| No LLM, network, or OpenRouter | grep audit + `package.json` | Pass — no `fetch`, no SDK, no new dependency |
| Boundary rules still fire | 4 probe files | Pass — 3 lint errors, 1 build failure, all removed |
| Acceptance flow | HTTP against disposable DB | Pass — Kitchen, Expenses, Dashboard, 7 error paths |
| No partial mutation on failure | before/after state diff | Pass — state byte-identical across 7 failures |
| Empty states render | HTTP on unset-up database | Pass — 3 pages return 200 with explicit empty states |
| Working tree | `git status --porcelain` | Clean |
| Remote parity | `git rev-parse` | `HEAD == origin/main` |

The two `new Date()` call sites are `src/features/shared/command-runtime.ts`, which is the
approved execution boundary, and `src/lib/db/migrations.ts`, which records a migration's
`applied_at`. Neither is reachable from a command path.

## Verification Status for 1.5

Retained for history. All checks passed; see `docs/sessions/2026-09-30-session-06.md`.

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

`946d807` — `docs(1.6): close phase 1 foundation`

## Next Action

**Phase 3 — Kitchen: NOT STARTED.** Phase 2 is complete and verified.

Phase 3 is where the kitchen becomes a real module rather than the Phase 1 vertical slice.
Its scope must be planned before work begins; it is not invented here. See
`docs/phases/PHASE_03_KITCHEN.md` and `docs/project/ROADMAP.md`.

The command contract, validation boundary, and natural-language entry point that Phase 3
builds on are already built and proven.

Limitations carried into Phase 2, all recorded and none silently dropped:

- The expense ledger cannot record a correcting entry, because `expense` holds non-negative
  spends only. A fix requires a migration.
- There is no command to create an inventory item or to set an opening balance, so both come
  from `npm run db:setup`, and an account reads `₹0.00` until one is spent from.
- The Dashboard's task list renders, but nothing creates `plan_task` rows, so it is always
  empty. Task planning was out of Phase 1 scope.
- The baseline database fingerprint discrepancy recorded in 1.5 remains unexplained. The
  current database passes schema verification and contains no application rows.

One open item is carried forward: the **PRD-versus-roadmap scope divergence** recorded in
`docs/project/ROADMAP.md` is unresolved. The PRD frames V1 as a 2–3 hour prototype; the
roadmap spreads the same surface across nine phases. The user decides which governs.

## Known Issues

- `npm install` prints `npm warn deprecated eslint@9.39.5`. This comes from
  `eslint-config-next@16.3.7`'s own dependency range, not from a package chosen here. It is
  upstream and is not an introduced warning. No configuration was weakened to suppress it.
  Re-evaluate when Next ships a config on a supported ESLint major.
