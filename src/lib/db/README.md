# Database

The SQLite access boundary. Established in micro-phase 0.5, schema added in 1.1, repositories
added in 1.4.

All database code lives here and nothing else. No component, no domain rule, and no command
parser may import this directory directly.

The file lives at `data/hari-os.db`, outside `public/` and excluded from Git.

## Contents

| File              | Role                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `connection.ts`   | Opens the database, sets WAL and foreign keys, caches the handle    |
| `migrations.ts`   | Ordered migration list and `migrate()`                              |
| `schema.ts`       | The expected V1 schema, declared independently of the migration SQL |
| `repositories.ts` | The only reads and writes of application tables                     |

`connection.ts` does **not** migrate implicitly. Callers ask for it explicitly with
`migrate(database)` so a read-only path cannot silently write.

## Repositories

`createRepositories(database)` returns the reads and writes the four existing commands need,
plus `transaction`. It is not a generic repository layer, and it is deliberately not extended
speculatively — a new method appears when a command needs it.

Two rules govern this file:

- **It contains no business arithmetic.** Every number it stores was decided by `src/domain`
  first. A repository that computed a balance would make the arithmetic impossible to test
  without a database.
- **It does not reimplement name matching.** `findByName` delegates to the domain's own
  `findInventoryItem` and `findAccount`, so there is one rule for what counts as the same
  name rather than two that can drift apart.

A read returns the domain's `Result`, because "no such item" is a domain concept. A write
returns `PersistenceResult`, because a write has no domain failure to report — it either
stored the value or it did not.

## Verifying

```bash
npm run db:check   # apply pending migrations, then verify the live schema
npm run db:test    # isolated constraint and migration tests on temporary databases
npm run exec:test  # command execution against real SQLite on temporary databases
```

`db:check` fails if an expected table or column is missing, if an expected structural
constraint is absent, or if an unexpected table is present. It never inserts sample rows.

`db:test` and `exec:test` create disposable databases in the OS temp directory and remove
them. Neither opens `data/hari-os.db`.

## Schema rules

- Migrations are ordered and append-only. An applied migration is never edited.
- `DROP TABLE` is not a normal migration strategy. Migrations are additive.
- No business arithmetic in SQL. Queries return data; `src/domain` interprets it.
- No trigger exists in the schema. Nothing required one.

## Boundaries this directory keeps

- Server-side only. Every file here imports `server-only`, so importing it from a Client
  Component fails the build.
- All SQLite access goes through here. Nothing else imports `better-sqlite3`.
- Only `src/commands/executor.ts` may import this directory, and only `repositories.ts`. The
  command layer is blocked by lint from importing `connection`, `migrations`, `schema`, or
  the driver, so it delegates storage rather than performing it.
- Money is stored as integer minor units. Quantities use `NUMERIC`. No `REAL` money column
  exists anywhere.
