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

Executing these commands — resolving a name to a row, applying the domain operation, storing
the result — is a later micro-phase, and belongs to the owning feature rather than to this
directory.

## Rules this directory keeps

Enforced by `npm run lint` via `hari-os/command-boundary` (ADR-032): no database, no
filesystem, no network, no environment, no clock. The command layer proposes and validates;
it does not persist.

`src/domain` and `src/lib/validation` are permitted imports here, as `ARCHITECTURE.md`
section 4 requires.
