# Phase 9 — Hardening

**Status: Planned**

This phase is deliberately unspecific about *what*. Its scope is determined by what Phases
1–8 actually built and what breaks under real use.

## Purpose

Make the application reliable enough to depend on daily. By this point the features exist;
this phase makes them trustworthy.

## Scope

- **Reliability** of the paths that Phases 1–8 introduced, especially SQLite access: behaviour
  under an unexpected database state, a locked file, an interrupted write, and a restart
  mid-operation.
- **Validation hardening** at the boundaries that matter: `src/lib/validation/`, the
  `src/lib/db/` boundary, and the Phase 2 command engine.
- **Correction paths.** PRD principle 13: every mutation must be traceable and correctable.
  This phase verifies that claim across all modules rather than assuming it holds because
  each module built it individually.
- **Empty states.** PRD section 4 and the project's own principles: no page may crash on
  empty data. Every page built in Phases 1–8 is exercised with no data at all.
- **Data safety.** Re-verify the Phase 0 guarantees still hold: `data/` ignored, database
  and sidecars untracked, `.env` files uncommitted, `.env.example` the tracked reference.
- **Local-first integrity.** The application must work offline, with no network dependency
  it did not choose. The PWA work in Phase 8 makes this checkable.
- **Test coverage appropriate to the implemented system** — proportionate to what was
  actually built, not a fixed target.

## Dependencies

- Phases 1 through 8 complete, or at least the subset that will ship.
- The behaviour to harden exists. Hardening an unimplemented path is wasted work.

## Boundaries

- **No deployment target and no production infrastructure.** V1 is localhost only. This phase
  does not introduce hosting, CI/CD, or a production environment.
- **No new product features.** Anything discovered here that is a new capability is recorded
  and scheduled, not built here.
- **No authentication**, which the PRD defers.
- No ORM, no Supabase, no cloud storage.
- No refactor that changes architecture without an ADR. A refactor driven by real friction
  found in this phase is legitimate, and is recorded.

## Expected deliverables

- Test coverage on the paths that carry financial and inventory correctness first. Those are
  the ones where a wrong answer is silent.
- A record of any defect found and fixed, in the session report, not hidden.
- A re-verification of the Phase 0 data-safety guarantees.
- Any ADR needed by architecture changes this phase forces.

## Verification

- The full baseline suite passes: `format:check`, `typecheck`, `lint`, `build`.
- `npm run db:check` passes with the full expected schema and no unexpected tables.
- Every page built in earlier phases is shown rendering with completely empty data.
- Determinism is re-verified for balance and inventory arithmetic after all changes.
- The secret and data scan from Phase 0 is repeated across the whole history and passes.
- A fresh clone is demonstrated to install, build, and run.
- Every defect found during this phase is recorded, whether or not it was fixed.

## Status

**Planned.** None of this exists yet. There is no test infrastructure in the repository
today, and no product code to harden.
