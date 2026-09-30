# Domain

Pure business rules, calculations, and types.

Imports nothing from the rest of the application. No React, no database, no filesystem,
no LLM. If a rule here cannot be tested with plain input and output, it is in the wrong place.

This is where deterministic arithmetic belongs: balance updates and inventory quantity
changes are computed here, never by the LLM and never in a component.

## Contents

| Module         | Responsibility                                                        |
| -------------- | --------------------------------------------------------------------- |
| `result.ts`    | `Result` type and the closed set of domain error codes                |
| `decimal.ts`   | Exact decimal inspection, scale rounding, negative-zero normalisation |
| `money.ts`     | Integer minor units, rupee conversion, balance arithmetic             |
| `quantity.ts`  | Non-negative quantities, scale rules, addition and subtraction        |
| `inventory.ts` | Kitchen stock rules and stock correctability                          |
| `accounts.ts`  | Account and spend rules                                               |

## Rules this directory keeps

Purity is enforced by `npm run lint`, not merely documented:

- No `node:fs`, `node:os`, `node:path`, `node:child_process`, network, `better-sqlite3`,
  `server-only`, `next/*`, `@/lib/db`, `@/lib/storage`, or `@/commands`.
- No `process.env`, `Date.now`, or `Math.random`. Timestamps and ids are arguments.
- No mutation of objects the caller still holds. Operations return new values.

Money is always a whole number of minor units. No operation here reads or writes SQLite;
see ADR-025 for the full boundary.

## Testing

```bash
npm run domain:test
```

Runs against the real source with no build step, no test framework, and no database.
