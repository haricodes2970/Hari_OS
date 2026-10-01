# Phase 2 — Command Engine

**Status: Complete (2026-10-01)** — implemented and verified. See
[`../sessions/2026-10-01-session-01.md`](../sessions/2026-10-01-session-01.md).
A live provider call remains unverified: no API key was available.

## Purpose

Let the user express state in a natural sentence and have the application apply it
correctly, without the language model ever doing arithmetic or persisting state.

From the PRD: a shared chat input, visible on every page, where the user types sentences
such as "used 2 onions", "bought banana 10 rupees cash", or "did laundry". The application
parses each sentence and routes it to the correct module.

## Scope

- One shared input surface, present on every page.
- Turning a sentence into a **structured, typed intent**: which module, which item, what
  quantity, what amount, which account.
- Validating the parsed intent before anything is applied.
- Handing the validated intent to the owning feature for deterministic execution.
- Presenting what was understood, so a wrong interpretation is visible and correctable.
- The OpenRouter integration, at the time this phase begins.

## Dependencies

- Phase 1 complete: a working schema and a proven application data path. A parser with
  nothing to call would be untestable.
- An OpenRouter API key, supplied through the environment and never committed. `.env.example`
  is updated in this phase, not before.
- The modules being addressed by a sentence (Kitchen, Expenses, Habits) should exist, or the
  phase starts with a smaller addressable set.

## Boundaries

This phase is governed by the LLM boundary rules in `AGENTS.md` section 7. They are not
optional:

- **The LLM must never perform arithmetic that affects balances or quantities.** Financial
  balances and inventory quantities are computed by deterministic code in `src/domain`.
  This follows PRD principles 11 and 12 and is non-negotiable.
- **Deterministic application and domain code owns all state mutation.**
- **The command layer must not bypass feature or domain validation to write directly to
  SQLite.** It produces and validates intent, then hands it to the owning feature.
- **Parsing is an interpretation layer, not a source of truth.** Every intent must be
  inspectable and correctable by the user.
- No business logic moves into the parser. It decides *what was meant*, never *what happens*.

## Expected deliverables

- `src/commands/` implementation, still behind the existing ESLint boundary rules.
- An intent type, validated in `src/lib/validation/`.
- Error and low-confidence handling: an unparseable sentence must say so rather than guess.
- Every applied intent traceable to the sentence that produced it, so a wrong entry can be
  found and corrected (PRD principle 13).

## Verification

- Baseline suite passes: `format:check`, `typecheck`, `lint`, `build`.
- Real sentences drive real state changes end to end, and the result is shown.
- **Negative testing is the important part:** malformed, ambiguous, and out-of-domain
  sentences are rejected visibly rather than silently misapplied.
- A demonstrated case where the parse was wrong and the user corrected it.
- A demonstrated case proving the LLM does not compute a balance: the balance changes by
  the same amount as the deterministic code path, and the calculation is inspectable in
  `src/domain`.
- `connection.ts` remains server-only; no LLM call reaches the client bundle.
- No secret or API key appears in a commit, in logs, or in error output.

## Status

**Planned.** No parser, no LLM dependency, no OpenRouter integration, and no API key exists
today. Phase 0 deliberately stopped before any of it.
