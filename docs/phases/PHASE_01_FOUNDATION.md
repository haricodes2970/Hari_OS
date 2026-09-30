# Phase 1 — Application Foundation

**Status: Active** (micro-phases 1.1, 1.2, and 1.3 complete)

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

**Active.** Micro-phases **1.1 (data schema foundation)** and **1.2 (domain model and
deterministic operations)** are complete and verified.

What 1.1 delivered: the eleven PRD tables, an ordered migration mechanism in
`src/lib/db/migrations.ts`, an independently declared expected schema in
`src/lib/db/schema.ts`, and two verification scripts. See `docs/project/ARCHITECTURE.md`
section 12 and ADRs 020–024.

What 1.2 delivered: the pure domain layer in `src/domain/` — money, quantity, inventory, and
accounts — returning `Result` values with a closed set of error codes, with 170 in-memory
tests and no database dependency. Purity is enforced by lint. See section 10 and ADRs
025–028.

What 1.3 delivered: the structured command contract in `src/commands/contract.ts` — four
command kinds carrying facts only, no ids, timestamps, or computed outcomes — and the
validation boundary in `src/lib/validation`, which turns an untrusted object into either a
command or a list of specific issues. 93 in-memory tests, no database, no parser, no LLM. See
section 8 and ADRs 029–032.

What remains: **no feature code exists, and nothing executes a command.** There are no
repositories, services, or query modules, so `applyExpense` computes a new balance that
nothing stores and a validated command goes nowhere. Micro-phase 1.4 is the execution
pipeline, 1.5 the first visible slice, and 1.6 the foundation verification pass.

One known limitation is carried forward from 1.2: the expense ledger cannot record a
correcting entry, because `expense` holds non-negative spends only. Correcting a wrong spend
currently means replacing the row. Any fix belongs in a migration, not in a later feature
slice.
