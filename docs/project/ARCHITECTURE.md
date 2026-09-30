# Architecture

An implementation guide for Hari OS V1. It records where code goes and which direction
dependencies may point. It is not an essay and it is not aspirational — it describes the
boundaries that exist now.

## 1. Principles this structure enforces

- The app is an assistant. It surfaces options; the user decides.
- Deterministic code performs arithmetic and state mutations. The LLM only interprets
  language and proposes a structured intent.
- Log reality, not intentions. Every mutation is traceable.
- Function over visual polish for V1.
- Local-first and single-user. SQLite on disk, photos on disk, no deployment.

## 2. Directory structure

```
src/
  app/                  Next.js routes and layouts. Routing concerns only.
  components/           Reusable presentation. No business rules, no I/O.
  features/             Vertical slices: dashboard, routine, kitchen, expenses,
                        skills, habits. One directory per product area.
  domain/               Pure business rules, calculations, and types. No I/O.
  commands/             Natural language command engine (Phase 2). LLM boundary.
  lib/
    db/                 SQLite access. All queries live here.
    storage/            Local filesystem access. All disk I/O for uploads.
    validation/         Input and domain validation.
```

`data/` sits at the repository root, outside `src/` and outside `public/`, and is
excluded from Git.

### Deliberately absent

- **`src/types/`** — not created. A shared global types file attracts unrelated types and
  lets features couple through it. Types are owned by `domain/` or by the feature that
  uses them, and are shared only when two boundaries genuinely need the same shape.
- **Empty feature directories** — not created. `src/features/` exists as the boundary;
  `kitchen/`, `expenses/`, and the rest are created by the phase that implements them.
- **Service or repository layers** — not created. They are introduced when a second caller
  needs them, not beforehand.
- **Barrel `index.ts` files** — not created. They obscure which module a symbol came from.

## 3. What each directory owns

| Directory | Owns | Must not |
| --- | --- | --- |
| `app/` | Routes, layouts, page composition, server entry points | Business rules, SQL, business types |
| `components/` | Rendering, props, event dispatch | Database, filesystem, command engine, business rules |
| `features/` | One product area end to end | Reaching into another feature's internals |
| `domain/` | Business rules, calculations, domain types | React, SQL, filesystem, LLM, any import at all |
| `commands/` | Turning a sentence into a validated structured intent | Performing persistence or arithmetic itself |
| `lib/db/` | Connection, schema, migrations, queries | Business meaning |
| `lib/storage/` | Reading and writing uploaded files | Business meaning |
| `lib/validation/` | Validating input and domain invariants | UI concerns, persistence |

## 4. Dependency direction

Dependencies point inward and downward. A layer never imports the layer above it.

```
  app/  ──────────────┐
    │                 │
    v                 v
features/            commands/  (LLM proposes; never mutates)
    │                 │
    v                 v
  domain/ ◄───────────┘     (pure rules and calculations)
    ▲
    │
lib/db/   lib/storage/   lib/validation/
```

Concretely:

- `domain/` imports nothing. It is the innermost layer.
- `components/` may import types from `domain/`, and nothing else from the application.
- `features/` and `app/` may use `lib/db`, `lib/storage`, and `lib/validation`.
- `commands/` may use `domain/` and `lib/validation`. It hands a validated intent to a
  feature rather than writing to the database itself.
- `lib/*` never import from `app/`, `features/`, `components/`, or `domain/`.

### What is enforced today

`eslint.config.mjs` defines a `hari-os/boundaries` rule using the built-in
`no-restricted-imports`. Files under `src/domain/` and `src/components/` may not import
`@/lib/db`, `@/lib/storage`, or `@/commands`. This costs no extra dependency and turns the
two most important rules into a build failure rather than a code review comment.

This was verified with probe files that were then deleted: violations were reported, and
legitimate imports from `app/` and `features/` were not flagged.

## 5. SQLite access

`src/lib/db/`. Established in micro-phase 0.5. Implemented by `connection.ts`.

### Location

The database file lives at `data/hari-os.db`, which is git-ignored and outside `src/` and
`public/`. The path is derived from the project root:

```
path.join(process.cwd(), "data", "hari-os.db")
```

The directory and file are created automatically on first access, so a fresh clone needs
no manual setup and no committed database.

### The `HARI_OS_DB_PATH` override

`HARI_OS_DB_PATH` is **optional** and unset in normal development. When set, it replaces the
default path; relative values resolve from the current working directory.

It exists for two reasons only: running tests or tooling against a throwaway database, and
pointing at a scratch file while debugging. It is not a deployment mechanism. V1 has no
deployment and no remote database, so there is nothing for it to point at in production.

`.env.example` documents the variable with safe example values. Copy it to `.env.local` to
use it locally; `.env.local` is git-ignored and must never be committed.

Local database files are **intentionally untracked**. Nothing in `data/` is meant to reach
the GitHub repository, and the repository is not a backup for real user data.

### What `connection.ts` does

Infrastructure only:

- resolves the path and creates the directory and file on demand;
- opens the database with WAL journaling and `foreign_keys = ON`;
- returns a single shared handle, cached on `globalThis` so Next.js module reloads in
  development do not leak connections;
- throws a clear error naming the path if opening fails;
- exports `checkDb()` for verification, which reads pragmas and writes nothing.

`connection.ts` starts with `import "server-only"`, so importing it from a Client
Component fails the build. This was verified with a probe route, not assumed.

**No schema exists.** The PRD entities are deliberately absent; see section 10.

`better-sqlite3` is a native module, so `next.config.ts` sets
`serverExternalPackages: ["better-sqlite3"]` to stop Next from bundling it.

### Local data safety

`.gitignore` protects all of the following, verified with real files rather than by
inspection:

| Ignored | Why |
| --- | --- |
| `data/`, `data/**` | The SQLite database and future uploaded photos |
| `*.db`, `*.sqlite`, `*.sqlite3` | A database created outside `data/` |
| `*.db-wal`, `*.db-shm` | SQLite WAL sidecars, which are runtime state |
| `.env`, `.env.local`, `.env.development`, `.env.test`, `.env.production` | Real secrets |
| `.env.development.local`, `.env.test.local`, `.env.production.local`, `.env.*.local` | Real secrets |
| `!.env.example` | Explicit negation so the documentation file stays tracked |

The rules are deliberately narrow. Source code, documentation, and configuration are not
excluded; only secrets and local user data are.

## 6. Filesystem storage

`src/lib/storage/`. Used for laundry photos from Phase 8. `public/` is never used for
private user data. Uploads will land under `data/uploads/`, which is already ignored. No
upload code exists yet.

## 7. Validation

`src/lib/validation/`. Shared so that a form, a route handler, and the command engine
enforce the same rules. No validation library is installed, because nothing needs
validating yet.

## 8. Future command parser

`src/commands/`. Phase 2. It will call OpenRouter and produce a typed intent such as
`{ module: "expenses", item: "banana", amount: 10, account: "cash" }`.

The boundary that matters: the model interprets and proposes, deterministic code decides
and persists. Balances and inventory quantities are computed in `src/domain` and written
by ordinary code. A wrong parse must be correctable, so intents are validated against
`lib/validation` and shown to the user before or after being applied.

No parser, no LLM dependency, and no OpenRouter integration exists yet.

## 9. Feature code

`src/features/<area>/`, one directory per product area: `dashboard`, `routine`,
`kitchen`, `expenses`, `skills`, `habits`. A feature owns its rules, its UI, and its data
access, and shares only through its own public surface.

## 10. Not implemented yet

None of the following exist, and their absence is intentional:

- Any feature module, page, or UI beyond the minimal root page
- **Seed data.** No sample or fake rows exist in any table
- **Any business operation.** The schema exists, but nothing reads or writes it yet:
  no inventory arithmetic, no balance calculation, no sleep, habit, or skill logic
- Any repository, service, or query module for the schema
- Filesystem upload handling
- The natural language command parser
- OpenRouter or any LLM integration
- Authentication
- Deployment configuration
- PWA manifest, service worker, or offline support
- A general test framework. The only tests are the two database scripts described below

`src/lib/db/` contains the connection, migrations, and schema declaration. `app/` contains
only the minimal root page from micro-phase 0.2. Every other directory still holds a README.

Do not assume a directory is functional because it exists, and do not assume a table being
present means anything can use it yet.

---

## 11. Schema and migrations (added in micro-phase 1.1)

`src/lib/db/` owns the schema. Nothing outside it may create, alter, or drop a table.

### Files

| File | Role |
| --- | --- |
| `src/lib/db/connection.ts` | Opens the database, sets WAL and foreign keys, caches the handle |
| `src/lib/db/migrations.ts` | Ordered migration list and the `migrate()` function |
| `src/lib/db/schema.ts` | The expected V1 schema, declared independently of the migration SQL |
| `scripts/db-check.mjs` | `npm run db:check` — applies migrations, then verifies the live schema |
| `scripts/schema-test.mjs` | `npm run db:test` — isolated constraint and migration tests |

`migrations.ts` holds SQL in TypeScript rather than in `.sql` files so migrations are part of
the module graph instead of a runtime filesystem read. This keeps the mechanism working
under a production build without extra file tracing, and keeps database access
self-contained in one directory (ADR-020).

### Applying migrations

`migrate(database)` applies every version not yet recorded, in order, each inside a
transaction that also records the version. Re-running is a no-op. A database containing a
version this code does not know about is refused with a clear error rather than downgraded.

Migrations are additive. `DROP TABLE` is not a normal strategy, and an already-applied
migration is never edited.

`connection.ts` deliberately does **not** migrate implicitly. Callers ask for it explicitly,
so a read-only code path cannot silently write to the database.

### Verification

`npm run db:check` migrates and then checks the live schema against `schema.ts`: every
expected table, every expected column, the structural constraints, and the absence of any
unexpected table. Because `schema.ts` is declared separately from the SQL that creates the
tables, a broken migration cannot silently agree with itself.

`npm run db:test` runs isolated tests against disposable databases in the OS temp
directory. It never opens the real `data/hari-os.db`.

### Representation rules

- **IDs:** `INTEGER PRIMARY KEY` on every table.
- **Money:** `INTEGER` minor units. No `REAL` money column exists (ADR-021).
- **Quantities:** `NUMERIC`, allowing exact integers and fractional weights (ADR-024).
- **Dates and times:** ISO-8601 `TEXT`, which sorts chronologically (ADR-022).
- **Booleans:** `INTEGER` constrained to `0` or `1`.
- **Types are enforced with `typeof()` checks**, because SQLite column types are advisory
  (ADR-023).

No schema logic performs business arithmetic. The schema stores facts; `src/domain` decides
what they mean.
