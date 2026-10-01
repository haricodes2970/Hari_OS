# Project Status

- **Last updated:** 2026-10-01 (Phase 4, expenses)
- **Repository:** https://github.com/haricodes2970/Hari_OS
- **Branch:** `main`

## Current Phase

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Foundation infrastructure | **Complete** |
| 1 | Application foundation | **Complete** |
| 2 | Command engine (natural language) | **Complete** |
| 3 | Kitchen inventory | **Complete** |
| 4 | Expenses | **Complete** |

**Phase 0 is complete.** All eight micro-phases are done and verified.

**Phase 1 is complete.** All six micro-phases are done and verified: schema, pure domain
rules, the validated command contract, the execution pipeline, persistence, the server
boundary, and a user-facing vertical slice. A user can record stock changes and expenses
through the UI and see the result persisted.

**Phase 2 is complete.** The natural-language command engine is implemented and verified:
a sentence is parsed by a language model into an untrusted proposal, allowlisted into a
command candidate, and applied by the Phase 1 executor with no arithmetic performed by the
model. Detail in `docs/sessions/2026-10-01-session-01.md`.

**Phase 3 is complete.** Kitchen is a real feature rather than the Phase 1 vertical slice. A
user can add an item, set what counts as low, record use and restock by form or by sentence,
read the state, and **correct a mistake without anything being deleted**. Quantity arithmetic
stays in `src/domain`; a correction is an ordinary movement applied through `runCommand`. Detail
in `docs/sessions/2026-10-01-session-02.md`.

**Phase 4 is complete.** Expenses is a real money ledger. The PRD's daily bill exists: a day's
total with a breakdown by item and by payment method, as deterministic shareable text that is
served as `text/plain` and copies into any mail app with scripting disabled. Account resolution
is proven exact, a refused expense provably mutates nothing, and a negative balance remains a valid
state. Phase 4 also found and fixed two defects that had been hiding in earlier phases: a missing
CSRF guard on the endpoint that spends money, and architecture lint rules that reported
boundaries they were not enforcing. Detail in `docs/sessions/2026-10-01-session-03.md`.

## Current Micro-Phase

**Phase 4 — Expenses: COMPLETE AND VERIFIED**

There is no active micro-phase. Phase 4 was delivered as one unit.

The automated suite is 1177 assertions across nine suites, up from 920, plus 27
architecture probes. The live provider call is
**not** verified — no `OPENROUTER_API_KEY` was available, unchanged from Phases 2 and 3.
Everything reachable without a credential is verified, including the provider, which is tested
against a local HTTP stub.

Two items were deliberately **deferred** rather than built, both documented: expense
correction/refund, which cannot be done honestly without a schema migration, and batch entry,
where the PRD contradicts itself and Phase 2's accepted ADR holds.

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
| 2 — Command engine (natural language) | `35cb0e3` | Complete | Yes, except the live provider call |
| 3 — Kitchen inventory | `da9a89c` | Complete | Yes, except the live provider call |
| 4 — Expenses | `71ac329` | Complete | Yes, except the live provider call and deferred correction |

## Active Work

None. Phases 0, 1, 2, 3, and 4 are complete.

## Blockers

None.

## Not verified

- **A live OpenRouter call.** No `OPENROUTER_API_KEY` or `OPENROUTER_MODEL` was available, so
  no request has ever reached the real provider. The request this application builds is asserted
  against a local HTTP stub in `scripts/chat-test.mjs` section 37 and against an injected
  transport in `scripts/parser-test.mjs` section 21, but the model id, the account, and the
  schema's acceptance by a real provider remain untested. Everything up to the socket is verified.
- **The parser prompt's handling of a compound sentence is unproven against a real model.** The
  prompt now instructs the model to report both the count and the use in "I had 10 onions, used
  2" rather than dropping the count. Whether a real model complies is a question only a live
  call can answer. The allowlist and the domain rule are verified independently.
- **Expense correction and refund are not implemented.** See "Next Action". Deferred by explicit
  decision rather than left unnoticed; the page says so.
- **Batch expense entry is not implemented.** The PRD is self-contradictory on this. Deferred.

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
  `npm run domain:test` (213 assertions). Purity is enforced by the `hari-os/domain-purity`
  lint rule. **The executor calls these operations directly; it contains no arithmetic of
  its own.**
- **Validated command contract in place** from micro-phase 1.3. `src/commands/contract.ts`
  declares five command kinds carrying facts only, and `parseCommand` in
  `src/lib/validation` turns an untrusted object into a command or a list of specific issues.
  99 tests, no database dependency, no parser and no LLM.
- **Execution pipeline in place** from micro-phase 1.4. `src/lib/db/repositories.ts` is the
  only module that reads or writes application tables, and `src/commands/executor.ts`
  sequences a validated command: resolve names to rows, apply the domain operation, persist
  the result atomically. 76 integration tests against real SQLite.
  **Reached in production through `POST /api/commands` and `POST /api/commands/parse`.**
- **Command engine in place from Phase 2.** `POST /api/commands/parse` receives a sentence,
  the model proposes an untrusted result, an allowlist copies a fixed set of fields, and
  `parseCommand` gates it before the unchanged Phase 1 executor applies it. The only network
  call in the application is `src/features/chat/openrouter.ts`, and it cannot write anything: the
  domain and the validator are both barred from importing a provider (ADR-046).
- **Kitchen is a real feature from Phase 3.** `src/features/kitchen/` holds item setup,
  correction, and the read side; `POST /api/kitchen` handles the four operations that move no
  stock (ADR-043). A correction is an ordinary movement through `runCommand`, never a
  deletion or a direct write (ADR-044).
- **Expenses is a real feature from Phase 4.** `src/domain/expenses.ts` holds the daily bill —
  a day's total plus breakdowns by item and by payment method, computed from the day's rows with
  every sum validated. `src/features/expenses/` holds the read side and the deterministic bill
  text, and `GET /expenses/daily-bill` serves it as `text/plain` for copying or sending. The
  breakdown reconciles with the total by construction, and the same ledger always produces
  byte-identical text.
- **First vertical slice in place from micro-phase 1.5.** Dashboard (`/`), Kitchen
  (`/kitchen`), and Expenses (`/expenses`) read persisted state and render it. The shared
  `CommandForm` is a Server Component posting to `POST /api/commands` — the single command
  entry point (ADR-036). There is no client JavaScript in the form and no hydration boundary;
  the endpoint answers `303 See Other` with an outcome token that `OutcomeBanner` renders, so
  the form works identically with and without JavaScript (ADR-037).
- **`npm run db:setup`** creates the first-run rows the commands need: three accounts at a
  zero opening balance, and three example stock items. It is idempotent, and nothing in `src/`
  creates rows (ADR-039). `getDb()` migrates on open, so a new database renders empty states
  instead of erroring (ADR-038). An inventory item can now also be added from the Kitchen page.
- **`npm run app:test`** runs 68 tests covering form translation, return-path safety, the
  end-to-end slice, failure containment, outcome reporting, and display reads, against real
  SQLite on a disposable database.
- **`npm run kitchen:test`** runs 153 tests covering item setup, threshold boundaries, unit
  refusal, the correction invariant, the history log, and every empty state, against real SQLite
  on a disposable database that it fingerprints and removes.
- **`npm run expenses:test`** runs 257 tests covering money precision, exact account resolution,
  the daily bill's arithmetic and determinism, atomic rollback under real SQLite triggers, the
  date boundary, and CSRF, against real SQLite on a disposable database that it fingerprints and
  removes.
- **`npm run architecture:probe`** proves the layer boundaries are actually enforced rather than
  merely declared, which `npm run lint` alone cannot show (ADR-046).
- No pages beyond the three above, no authentication, no uploads, no test framework beyond the
  nine scripts.
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
| `npm run parser:test` | Sentence interpretation against the allowlist (126 tests) |
| `npm run chat:test` | Provider, engine, and route against a local HTTP stub (132 tests) |
| `npm run kitchen:test` | Kitchen setup, correction, history, and empty states (153 tests) |
| `npm run expenses:test` | Money rules, exact account resolution, the daily bill, atomicity, CSRF (257 tests) |
| `npm run architecture:probe` | Proves each layer-boundary lint rule actually fires (27 checks) |

## Verification Status for Phase 4 (closeout)

Every check below was run at closeout on 2026-10-01.

| Check | Command | Result |
| --- | --- | --- |
| Formatting | `npm run format:check` | Pass |
| TypeScript | `npm run typecheck` | Pass — 0 errors |
| Lint | `npm run lint` | Pass — 0 errors, 0 warnings |
| Production build | `npm run build` | Pass |
| Schema intact | `npm run db:check` | Pass — 11 V1 tables, no unexpected tables, no migration added |
| Schema tests | `npm run db:test` | Pass — 53 passed, 0 failed |
| Domain tests | `npm run domain:test` | Pass — 213 passed, 0 failed |
| Contract tests | `npm run contract:test` | Pass — 99 passed, 0 failed |
| Execution tests | `npm run exec:test` | Pass — 76 passed, 0 failed |
| Application tests | `npm run app:test` | Pass — 68 passed, 0 failed |
| Parser tests | `npm run parser:test` | Pass — 126 passed, 0 failed |
| Chat tests | `npm run chat:test` | Pass — 132 passed, 0 failed |
| Kitchen tests | `npm run kitchen:test` | Pass — 153 passed, 0 failed |
| Expenses tests | `npm run expenses:test` | Pass — 257 passed, 0 failed |
| Architecture probes | `npm run architecture:probe` | Pass — 27 passed, 0 failed |
| **Total assertions** | | **1177 passed, 0 failed** |
| Account isolation | cash, bank1, bank2 sequence | Pass — each changed only for its own spend |
| Account disambiguation | 11 near-miss names | Pass — none resolved to any account |
| Partial-ledger lookup | `bank2` absent | Pass — refused, never matched `cash` |
| Atomic rollback | real SQLite triggers, both directions | Pass — neither write survived |
| Bill reconciliation | item and payment-method breakdowns | Pass — both sum to the total |
| Bill determinism | same ledger, repeated | Pass — byte-identical text |
| Domain total vs SQL aggregate | same rows | Pass — identical |
| Date boundaries | yesterday, today, tomorrow | Pass — only today included |
| Precision refusal | `10.555`, `1.005` | Pass — refused, never rounded |
| CSRF | foreign `Origin` on both write routes | Pass — 403, no mutation |
| Same-origin write | the application's own origin | Pass — 303, spend recorded |
| Development database untouched | `sha256sum` before and after | Pass — identical, no WAL/SHM created |
| Disposable database removed | suite self-check | Pass |
| Working tree | `git status --porcelain` | Clean |
| Remote parity | `git rev-parse` | `HEAD == origin/main` |

### Two defects found and fixed in Phase 4

Both were pre-existing, both were found by testing rather than by reading, and neither is a Phase 4
regression. They are recorded in full as ADR-045 and ADR-046.

- **The endpoint that spends money had no CSRF guard.** `POST /api/commands` never received the
  origin check ADR-042 introduced; only the parse route and the Kitchen route had it. Any page the
  user had open could record an expense against a real account. Harmless-looking while it only
  moved stock by ₹10; from Phase 4 it moves money. Fixed, and all three write routes now share one
  implementation.
- **The documented layer boundaries were not enforced.** `src/domain` could import `@/lib/db`,
  `better-sqlite3`, or `node:fs` and `npm run lint` passed, while `AGENTS.md` stated the opposite.
  Later ESLint configs silently replaced earlier ones for the same rule, so only the provider
  patterns were ever in effect. Fixed, and `npm run architecture:probe` now proves each rule fires
  — and that the imports the architecture permits still pass. **The codebase turned out to comply
  already**: lint passed the moment the rules were armed, which means the architecture had been
  upheld by discipline rather than by tooling.

## Verification Status for Phase 3 (closeout)

Every check below was run at closeout on 2026-10-01.

| Check | Command | Result |
| --- | --- | --- |
| Formatting | `npm run format:check` | Pass |
| TypeScript | `npm run typecheck` | Pass — 0 errors |
| Lint | `npm run lint` | Pass — 0 errors, 0 warnings |
| Production build | `npm run build` | Pass |
| Schema intact | `npm run db:check` | Pass — 11 V1 tables, no unexpected tables, no migration added |
| Schema tests | `npm run db:test` | Pass — 53 passed, 0 failed |
| Domain tests | `npm run domain:test` | Pass — 213 passed, 0 failed |
| Contract tests | `npm run contract:test` | Pass — 99 passed, 0 failed |
| Execution tests | `npm run exec:test` | Pass — 76 passed, 0 failed |
| Application tests | `npm run app:test` | Pass — 68 passed, 0 failed |
| Parser tests | `npm run parser:test` | Pass — 126 passed, 0 failed |
| Chat tests | `npm run chat:test` | Pass — 132 passed, 0 failed |
| Kitchen tests | `npm run kitchen:test` | Pass — 153 passed, 0 failed |
| **Total assertions** | | **920 passed, 0 failed** |
| Acceptance flow | HTTP against a disposable DB | Pass — 17 steps, Kitchen and Dashboard |
| Development database untouched | `sha256sum` before and after | Pass — identical, no WAL or SHM created |
| No partial mutation on failure | before/after row and event counts | Pass — refused operations wrote nothing |
| Log integrity | `SUM(delta) == quantity` after a correction | Pass — 8 == 8, original entry preserved |
| Low-stock boundaries | Dashboard at `>`, `==`, and `0` | Pass — flagged at `==` and `0`, clear above |
| Failure output | redirect URLs inspected | Pass — closed-set tokens only, no user input reflected |
| Disposable database removed | `kitchen:test` self-check | Pass |
| Working tree | `git status --porcelain` | Clean |
| Remote parity | `git rev-parse` | `HEAD == origin/main` |

### The invariant that makes the correction trustworthy

After a correction, the stored quantity equals the sum of every delta in the log. This is what
distinguishes a reversal from a patched number, and it is why the inverse is computed against
the current quantity rather than a snapshot: a stale-snapshot reversal would silently discard
whatever happened in between, and this check would fail. Verified over HTTP in the acceptance
run.

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

`71ac329` — `feat(4): complete expenses`

## Next Action

**Phase 5 — Dashboard: NOT STARTED.** Phase 4 is complete and verified.

Phase 4 must not be read as approval to begin Phase 5. Nothing outside Expenses was started: no
Routine, Sleep, Skills, Habits, or Photo Diary work, and no change to the Dashboard beyond the
today's-spend figure the PRD requires, which already existed.

Phase 5's scope is not invented here. See `docs/project/ROADMAP.md`.

Limitations carried forward from Phase 4, all recorded and none silently dropped:

- **Expense correction and refund remain deferred.** `expense.amount` is constrained non-negative
  and there is no `source_text`, so a reversal has nowhere to live. The PRD asks for wrong entries
  to be easy to undo; making that real needs a migration, and no refund model was requested.
  **Expense correction/refund remains deferred because the current ledger models non-negative
  spend entries.** The Expenses page states this, so the gap is visible in the product.
- **Batch expense entry is deferred.** The PRD contradicts itself: section 6.4 says it is
  supported, section 5 says it comes later, and Phase 2's accepted ADR commits to one sentence,
  one command.
- An account still reads `₹0.00` until one is spent from, because there is no command to set an
  opening balance. `npm run db:setup` opens all three at zero.
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
