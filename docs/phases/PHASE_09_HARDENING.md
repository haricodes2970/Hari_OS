# Phase 9 — Hardening

**Status: Complete**

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

### Scope correction applied during this phase

The scope item **"The application must work offline"** conflicts with ADR-059, which caches
nothing and accepts that a browser reload without a server has nothing to show. ADR-059 is
accepted and binding, so that item is **not** product scope and offline operation was not
built. What remains from the item, and what this phase did verify, is the narrower and
correct claim: **no code path reaches the network for anything it did not choose to.** No
telemetry, no remote fonts, no CDN, no external fetch outside the LLM call the user asked
for. That is a property of the code and it is checkable, so it was checked.

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

## What was done

### Defects found and fixed

Each is a real defect, found by reading the code against the claim it was supposed to satisfy.
None was found by a test that already existed.

| Defect | Why it mattered | Fix |
| --- | --- | --- |
| A `returnTo` of `//evil.example` was accepted as same-site | The browser leaves the origin the guard exists to protect | `safeReturnPath` resolves against an unresolvable host and rejects any result whose origin differs; also rejects control characters and backslashes |
| Habit and private command responses carried the diary note | Private text was serialised into every response, unread by any page | `HabitCommandView` — the type has no field for a note (ADR-061) |
| A sixth reader of private or diary text would have passed review | The invariant was a convention, not a rule | Enforced in `eslint.config.mjs` via a shared constant (ADR-061) |
| A photo filename was trusted from the caller | Path traversal through the upload route | Only generated UUID filenames are accepted |
| A locked database produced a raw SQLite error | The user saw storage internals and could not tell whether their data saved | 5s busy timeout, then a human message stating that nothing was saved |
| A kitchen correction read its entry id with a lenient parse | `parseInt` accepted `12abc` and `12.9` | Digits-only, like every other id in the project |
| An oversized upload body was read before being refused | Memory exhaustion from one request | `Content-Length` pre-check before the body is read, with slack for multipart framing |
| A failed photo write was reported as a validation error | The user re-uploaded a photo that had in fact been refused for a different reason | The real failure kind is now reported |
| A malformed note form cleared the diary note | An empty submit destroyed the user's words | A form that failed validation writes nothing |
| An outcome was placed before a URL fragment | `/habits#notes?msg=…` — the page never saw the outcome | `outcomeRedirect` sets parameters on the URL, merging query and preserving fragment |
| `outcomeRedirect` was committed in `9e90b4d` without its callers' import resolving | **The branch did not typecheck from a clean checkout.** Three `TS2305` errors | `9467ac8` adds the function. Verified by reverting it and watching `tsc` fail |

### Tests

Every fix above has a regression test that fails without it.

Fourteen suites test one layer against the one below it. That structure has a gap: none of them
asks whether a change made by one module is visible, and correct, in a module that has no other
way of knowing it happened. `scripts/regression-test.mjs` closes that gap — twelve sections follow
one fact through command, validation, domain, SQLite, read model, and page, and the last closes
the database and reads it all back.

### Verification

All green at the end of the phase:

| Check | Result |
| --- | --- |
| `format:check` · `typecheck` · `lint` · `build` | pass |
| `architecture:probe` | 85 passed, 0 failed |
| `regression:test` | 87 passed, 0 failed |
| `db:test` · `domain:test` · `contract:test` · `exec:test` | 58 · 278 · 112 · 76 passed |
| `app:test` · `kitchen:test` · `skills:test` · `expenses:test` | 77 · 168 · 172 · 257 passed |
| `dashboard:test` · `routine:test` · `diary:test` · `chat:test` | 77 · 113 · 74 · 132 passed |
| `pwa:test` · `parser:test` | 61 · 135 passed |
| Determinism of balance and inventory arithmetic | re-verified in `regression:test` §2 and §12 |
| Data safety | `git check-ignore` on real files; no tracked `.db`, no tracked `data/`, no secrets |

## Accepted limitations

These are real and deliberately not fixed. Each is a decision, not an oversight, and each is
recorded here so the next person does not rediscover it as a bug.

- **No idempotency keys.** A retried request writes twice. V1 is single-user on localhost, and the
  user can see and correct the duplicate through the history every module already keeps.
- **No rate limiting.** A local process can be flooded by anything running on the machine. The
  origin guard is a browser check, not an authentication control.
- **Request-size limits apply only to photos.** Other routes accept whatever the body holds; they
  are small by construction and add no limit to avoid a rule nobody maintains.
- **`Origin` may be absent.** A same-origin form post from some browsers and clients omits it.
  The guard rejects a *mismatched* origin and accepts an absent one.
- **Generic redirect queries must preserve `?` and `#`.** Handled by `outcomeRedirect`; a caller
  that concatenates a query string by hand reintroduces the bug.
- **A corrupt database fails loudly.** Wrong column types raise rather than coerce. Silently
  repairing a user's data is worse than refusing to read it.
- **Photo orphan cleanup is not automatic.** If a row write fails after the file is written, the
  file remains. Rare, invisible, and safe; an automatic sweeper would be a new capability.

## Verification

- The full baseline suite passes: `format:check`, `typecheck`, `lint`, `build`.
- `npm run db:check` passes with the full expected schema and no unexpected tables.
- Every page built in earlier phases is shown rendering with completely empty data.
- Determinism is re-verified for balance and inventory arithmetic after all changes.
- The secret and data scan from Phase 0 is repeated across the whole history and passes.
- A fresh clone is demonstrated to install, build, and run.
- Every defect found during this phase is recorded, whether or not it was fixed.

## Status

**Complete.** Every item in Verification was run and passed. The scope correction recorded above
was applied before the work, not after: the phase never attempted offline operation, because
ADR-059 says it is not in the product.

The full record of what happened, in order, is in the Phase 9 session report.