# Database

The SQLite access boundary. Established in micro-phase 0.5, schema added in 1.1.

All database code lives here and nowhere else. No component, no domain rule, and no
command parser may import this directory directly.

The file lives at `data/hari-os.db`, outside `public/` and excluded from Git.

## Contents

| File            | Role                                                                |
| --------------- | ------------------------------------------------------------------- |
| `connection.ts` | Opens the database, sets WAL and foreign keys, caches the handle    |
| `migrations.ts` | Ordered migration list and `migrate()`                              |
| `schema.ts`     | The expected V1 schema, declared independently of the migration SQL |

`connection.ts` does **not** migrate implicitly. Callers ask for it explicitly with
`migrate(database)` so a read-only path cannot silently write.

## Verifying

```bash
npm run db:check   # apply pending migrations, then verify the live schema
npm run db:test    # isolated constraint and migration tests on temporary databases
```

`db:check` fails if an expected table or column is missing, if an expected structural
constraint is absent, or if an unexpected table is present. It never inserts sample rows.

`db:test` creates disposable databases in the OS temp directory and removes them. It never
opens `data/hari-os.db`.

## Schema rules

- Migrations are ordered and append-only. An applied migration is never edited.
- `DROP TABLE` is not a normal migration strategy. Migrations are additive.
- No business arithmetic in SQL. Queries return data; `src/domain` interprets it.
- No trigger exists. Nothing in the schema required one.

## Boundaries this directory keeps

- Server-side only. Every file here imports `server-only`, so importing it from a Client
  Component fails the build.
- All SQLite access goes through here. Nothing else imports `better-sqlite3`.
- Money is stored as integer minor units. Quantities use `NUMERIC`. No `REAL` money column
  exists anywhere.
