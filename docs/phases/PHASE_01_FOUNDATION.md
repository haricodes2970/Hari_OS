# Phase 1 — Application Foundation

**Status: COMPLETE** (micro-phases 1.1 through 1.6 complete and verified)

## Purpose

The transition from Phase 0 infrastructure into a usable application skeleton. Phase 0 built
the tools and boundaries; Phase 1 builds the first real application structure on top of
them.

## Scope

- Establishing the first real feature slices under `src/features/`, as the product areas are
  actually implemented.
- The data flow between routes, features, and `src/lib/db/` — the path a request travels
  from UI to persistence and back.
- The first application schema, in a dedicated micro-phase, covering the PRD entities the
  first features require.
- The minimum shared UI structure (layout, navigation) that later phases build on.

## Dependencies

- Phase 0 complete: architecture boundaries, ESLint boundary rules, tooling, and the
  SQLite foundation. All true as of Phase 0 completion.
- The command engine is **not** a prerequisite. Phase 1 may add data through direct,
  deterministic application code first, so that the command engine in Phase 2 has a proven
  data path to wrap.

## Boundaries

- **No natural-language parsing and no LLM.** That is Phase 2.
- No Supabase, no ORM, no authentication, no deployment.
- No Tailwind, no UI framework, no PWA package.
- No feature logic that belongs to a later phase, even in stub form.
- Do not weaken the Phase 0 boundary rules to make a feature fit.

## Expected deliverables

- A first schema micro-phase, with `npm run db:check` updated to expect the new tables.
- At least one working feature slice end to end: route → feature → domain → `src/lib/db/`.
- A short `ARCHITECTURE.md` update if the real structure forces a documented change.

## Verification

- The full baseline suite passes: `format:check`, `typecheck`, `lint`, `build`.
- `npm run db:check` passes with the expected schema present and no unrelated tables.
- A real data round trip is demonstrated: a value written through the application is
  visible after a restart, and a negative case is shown too.
- The ESLint boundary rules still fire when deliberately violated.
- Empty states render without crashing.
- Documentation is updated before the phase is called complete.

## Status

**Complete.** All six micro-phases are done and verified.

What 1.1 delivered: the eleven PRD tables, an ordered migration mechanism in
`src/lib/db/migrations.ts`, an independently declared expected schema in
`src/lib/db/schema.ts`, and two verification scripts. See `docs/project/ARCHITECTURE.md`
section 13 and ADRs 020–024.

What 1.2 delivered: the pure domain layer in `src/domain/` — money, quantity, inventory, and
accounts — returning `Result` values with a closed set of error codes, with 170 in-memory
tests and no database dependency. Purity is enforced by lint. See section 10 and ADRs
025–028.

What 1.3 delivered: the structured command contract in `src/commands/contract.ts` — four
command kinds carrying facts only, no ids, timestamps, or computed outcomes — and the
validation boundary in `src/lib/validation`, which turns an untrusted object into either a
command or a list of specific issues. 93 in-memory tests, no database, no parser, no LLM. See
section 8 and ADRs 029–032.

What 1.4 delivered: the persistence boundary in `src/lib/db/repositories.ts` — the only
module that reads or writes application tables — and the execution pipeline in
`src/commands/executor.ts`, which resolves a command's names to real rows, applies the domain
operation, and persists the result atomically. 76 integration tests against real SQLite. See
ADRs 033–035.

What 1.5 delivered: the first usable vertical slice. `POST /api/commands` is the single
command entry point; the Dashboard (`/`), Kitchen (`/kitchen`), and Expenses (`/expenses`)
read persisted state and render it; the shared `CommandForm` is a Server Component that posts
without client JavaScript; and `src/features/shared/command-runtime.ts` is the composition
root that supplies the real database handle and clock. See section 11 and ADRs 036–039.

What 1.6 delivered: verification only, no new code. The full suite was re-run (460
assertions), the dependency direction audited, the acceptance flow re-run over HTTP against a
disposable database, and the repository audited. See
`docs/sessions/2026-09-30-session-07.md`.

## What Phase 1 delivered

The complete path, verified end to end:

```
Dashboard / Kitchen / Expenses
            |
            v
     POST /api/commands        single entry point (ADR-036)
            |
            v
     validated command          contract + validation boundary
            |
            v
        executor               resolves names, sequences domain then persistence
       /        \
      v          v
   domain    repositories        repositories are the only persistence module
                |
                v
             SQLite
```

Four micro-phase boundaries were honoured and are enforced, not merely documented:

- `src/domain/` is pure. It imports nothing from `src/lib/db`, `src/commands`, or the
  filesystem, and the executor contains no arithmetic of its own.
- `src/lib/db/repositories.ts` is the only module that reads or writes application tables. No
  SQL exists anywhere else.
- `src/components/` cannot import `@/lib/db`, `@/lib/storage`, or `@/commands`. There are no
  client components at all, so no browser code can reach server infrastructure.
- `POST /api/commands` is the only production call site that invokes execution.

## What Phase 1 did NOT deliver

The broader PRD modules remain future work. Phase 1 is a foundation, not the product.

- **No natural-language input, no parser, no LLM, no OpenRouter.** Phase 2. The contract and
  validation boundary that Phase 2 wraps already exist, but no model integration, API key, or
  conversation history does.
- **Routine, Sleep, Skills, Habits, and Photo Diary do not exist.** Their tables are in the
  schema and no code reads or writes them. Only Dashboard, Kitchen, and Expenses are built.
- **The full PRD is not implemented.** Only the Kitchen and Expenses slices, at the depth of
  the four existing commands.
- No authentication, no deployment, no uploads, no PWA packaging, no notifications, no
  screen-time integration, no "what can I cook" view.
- No correcting entry for an expense: `expense` holds non-negative spends only, so a wrong
  spend must be corrected by replacing the row. Carried forward since 1.2; a fix requires a
  migration.
- No command to create an inventory item or set an opening balance. Both come from
  `npm run db:setup`, and an account reads `₹0.00` until one is spent from.
- The Dashboard's task list renders but nothing creates `plan_task` rows, so it is always
  empty. Task planning was out of Phase 1 scope.

**Carried-forward database note:** the baseline fingerprint discrepancy recorded in 1.5
remains unexplained. The current database passes schema verification and contains no
application rows.
