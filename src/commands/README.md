# Commands

The boundary between natural language and deterministic action.

| File              | Role                                                         |
| ----------------- | ------------------------------------------------------------ |
| `contract.ts`     | The structured command types                                 |
| `domain-input.ts` | Maps a validated command onto a domain operation's arguments |

## The rule that shapes this boundary

The model only _interprets language and proposes a structured intent_. It never performs
persistence, never calculates a financial balance, and never calculates an inventory
quantity. Those are deterministic operations in `src/domain`, applied by ordinary code.

So a command carries facts and never results: an item name, a quantity, a unit, an account
name, an amount in whole minor units. No id, because a model cannot know one. No timestamp,
because the moment a spend happened is not the moment a model responded. No derived balance
or remaining quantity, because that number would sit inside the trust boundary with nothing
checking it.

## What does not exist here yet

No parser, no natural-language handling, no prompt, no LLM dependency, and no OpenRouter
integration. The contract is provider-agnostic on purpose: its shape is dictated by the
schema and the domain, not by how a sentence becomes a sentence.

`executor.ts` added execution in micro-phase 1.4. It resolves a command's names to real rows,
calls the domain operation, and persists what the domain returned, atomically. The domain runs
before any write, so a refusal can never leave a transaction open.

The executor is reached by passing `repositories` and a `now` function. Nothing in the
application wires those together yet — that composition root arrives with the first route in
micro-phase 1.5, and until then there is no user-facing path to a command.

## Rules this directory keeps

Enforced by `npm run lint` via `hari-os/command-boundary` (ADR-032, amended in ADR-035): no
`better-sqlite3`, no filesystem, no network, no environment, no clock, and no
`@/lib/db/connection`, `@/lib/db/migrations`, or `@/lib/db/schema`.

`@/lib/db/repositories` is permitted, so the executor can coordinate storage. It cannot reach
the connection or the driver, so it delegates rather than persists.

`src/domain` and `src/lib/validation` are permitted imports here, as `ARCHITECTURE.md`
section 4 requires.
