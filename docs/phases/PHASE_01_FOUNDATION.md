# Phase 1 — Application Foundation

**Status: Planned**

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

**Planned.** Nothing in this phase is implemented. Phase 0 completed with no product
features, no schema, and no parser.
