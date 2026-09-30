# Validation

Input validation, shared so that a form, a route handler, and the command engine enforce the
same rules.

Validation is kept separate from both UI and persistence, and it is pure: it checks the shape
of what it is given, never whether that shape happens to match the data.

| File         | Role                                                         |
| ------------ | ------------------------------------------------------------ |
| `result.ts`  | The validation failure vocabulary                            |
| `command.ts` | `parseCommand` and `isCommand` for untrusted command objects |

## No validation library

There is still no library installed, deliberately. The concrete need in micro-phase 1.3 was
checking the shape of four object types, which hand-written guards cover in about 200 lines.
The reasoning, and the condition under which that stops being true, is in ADR-031.

## What validation does and does not decide

It decides: is this a well-formed command, of a kind we support, with every field the right
type and representation?

It does not decide: whether the account exists, whether there are 2 onions, or what the
balance becomes. Those need data, and data means persistence. They are domain failures at
execution, and the distinction is load-bearing: "the model sent nonsense" and "you only have
3 onions" need completely different responses.

Representation checks reuse the domain's own exported predicates — `isMoneyAmount`,
`isQuantity`, `isAccountName` — so this boundary and the schema `CHECK` constraints cannot
drift apart.

## Fail closed

- Unknown fields are rejected, not dropped.
- Only own properties are read, so a poisoned prototype cannot inject one.
- A wrong-typed value is a failure, never coerced into something plausible.
- A field that throws while being read rejects the command instead of escaping the boundary.
- Every problem is reported at once, so a retry costs one round trip rather than several.

## Rules this directory keeps

Enforced by `npm run lint` via `hari-os/validation-purity` (ADR-032): no database, no
filesystem, no network, no environment, no clock, no framework import.

## Testing

```bash
npm run contract:test
```

Runs on the real source with no build step, no test framework, and no database. The suite
passes with `better-sqlite3` removed from `node_modules`.
