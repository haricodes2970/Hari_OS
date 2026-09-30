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

Two rules cover this, both of which fail `npm run lint`:

- `hari-os/boundaries` applies to `src/domain` and `src/components`, and blocks imports of
  `@/lib/db`, `@/lib/storage`, and `@/commands` (section 4).
- `hari-os/domain-purity` applies to `src/domain` only, and blocks the imports and globals
  that would make a business rule untestable: `node:fs`, `node:os`, `node:path`,
  `node:child_process`, network modules, `better-sqlite3`, `server-only`, `next/*`, and
  `process.env`, `Date.now`, `Math.random` (ADR-025).
- `hari-os/validation-purity` applies to `src/lib/validation`, and blocks the same
  filesystem, network, process, and database access, so validation stays independent of data
  (ADR-032).
- `hari-os/command-boundary` applies to `src/commands`, and blocks persistence entirely, so
  the command layer can propose and validate but not write. It deliberately still permits
  `src/domain`, which section 4 allows (ADR-032).

All four cost no extra dependency and turn the rules into build failures rather than code
review comments. Each was verified with probe files that were then deleted: violations were
reported, and legitimate imports from `app/`, `features/`, and `commands/` were not flagged.

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
enforce the same rules.

No validation library is installed. Hand-written guards were judged sufficient for the
concrete need in micro-phase 1.3, and the reasoning is recorded in ADR-031.

`result.ts` holds the validation failure vocabulary. `command.ts` holds the validator for
untrusted command objects (section 8). Both are pure, and `hari-os/validation-purity` fails
the build if either reaches for a database, a file, the network, the environment, or the
clock.

## 8. The command contract

`src/commands/`. The boundary between natural language and deterministic action.

`contract.ts` declares the structured command types. `domain-input.ts` maps a validated
command onto the arguments a `src/domain` operation expects. Both were added in micro-phase
1.3.

The boundary that matters: the model interprets and proposes, deterministic code decides and
persists. Balances and inventory quantities are computed in `src/domain` and written by
ordinary code. A wrong parse must be correctable, so intents are validated and shown to the
user before or after being applied.

### A command carries facts, never results

Four kinds exist, and only those with a domain operation behind them:

| Kind | Carries |
| --- | --- |
| `inventory.consume` | item name, amount, unit |
| `inventory.restock` | item name, amount, unit |
| `inventory.set_quantity` | item name, quantity |
| `expense.record` | account name, item, amount in minor units, optional category |

Common to all: a `version` literal, and the originating sentence as `sourceText`, kept only
so the application can show what it understood. Nothing ever reads `sourceText` to decide
what a command means.

Deliberately absent: ids, timestamps, and any computed outcome. A model cannot know a row id,
the moment a spend happened is not the moment a model responded, and a command that already
carried the new balance would put an unverified number inside the trust boundary. Routine,
sleep, skills, and habits are absent because no domain operation exists for them yet, and a
command type with no execution path would be a promise the code cannot keep (ADR-029).

### Validation is the gate, and it only checks shape

`parseCommand` in `src/lib/validation` turns an untrusted value into either a command or a
list of specific issues. It checks structure and types. It does not check existence — "is
there really an account called cash?" needs the database, so it is a domain failure at
execution — and it computes nothing (ADR-032).

It fails closed. Unknown fields are rejected rather than dropped, so a producer inventing an
`amount` or a `balance` is reported rather than silently tolerated. Only own properties are
read, so a poisoned prototype cannot inject a field. A field that throws while being read
becomes a rejected command rather than an exception escaping the boundary.

Representation checks reuse the domain's own exported predicates, so the command boundary
and the schema `CHECK` constraints cannot drift apart. All issues are reported at once,
because the usual caller is a model that has to try again, and one problem per attempt turns
a two-error payload into two round trips.

### What does not exist yet

No parser, no natural-language handling, no LLM dependency, no OpenRouter integration, and no
prompt. The contract is provider-agnostic: nothing here mentions a vendor, because the shape
is dictated by the schema and the domain, not by how a sentence is turned into it.

## 9. Feature code

`src/features/<area>/`, one directory per product area: `dashboard`, `routine`,
`kitchen`, `expenses`, `skills`, `habits`. A feature owns its rules, its UI, and its data
access, and shares only through its own public surface.

## 10. The domain layer (added in micro-phase 1.2)

`src/domain/` holds the business rules that decide what a number *means*. It is pure: plain
input, plain output, nothing else. A rule here that could not be tested by calling it with
values belongs in a different layer.

### What lives here

| Module | Responsibility |
| --- | --- |
| `result.ts` | The `Result` type and the closed set of domain error codes |
| `decimal.ts` | Exact decimal inspection, scale rounding, negative-zero normalisation |
| `money.ts` | Integer minor units, rupee conversion, balance arithmetic |
| `quantity.ts` | Non-negative quantities, scale rules, addition and subtraction |
| `inventory.ts` | Kitchen stock rules and the stock correctability representation |
| `accounts.ts` | Account and spend rules |

`decimal.ts` exists because money and quantity share one real problem: deciding how many
decimal places a `number` actually has without doing floating-point arithmetic to find out.
`1.15 * 100` is `114.99999999999999`, so a conversion that multiplies is wrong in a way that
depends on which way the error happens to fall. Both modules read the value's own decimal
string instead.

### The rules that matter

- **Money is a whole number of minor units.** Never a float. `toMinorUnits` rejects an amount
  with more than two decimal places rather than rounding it, because half a paise has no
  meaning.
- **Quantities are non-negative and within six decimal places.** Inputs are rejected when
  they exceed the scale; only the result of arithmetic is rounded (ADR-027).
- **Stock cannot go negative.** Consuming more than is recorded is an explicit refusal, not a
  clamped value. Exhausting the stock to exactly zero is valid.
- **A balance may go negative.** Being overdrawn is a real state (ADR-021). There is
  deliberately no `insufficient_balance` error, because the PRD contains no rule that a spend
  must be affordable, and inventing one would be inventing a business rule.
- **Units are compared as trimmed strings and nothing else.** `piece` is not `kg`, and the
  domain does not attempt to know whether `g` and `kg` are convertible — that would be
  inference. Canonicalising what a user wrote belongs to whatever introduces the item.
- **An unknown item or account is an explicit failure**, never a silent creation. Inventing
  an item or an account would be the system deciding something on the user's behalf.

### Failures are values

Every operation returns a `Result`, never an exception for an expected refusal, and every
failure carries a stable `code` from a closed set. Callers switch on `code`, never on
`message` (ADR-026).

### Determinism is a property of the design, not a promise

The domain never reads the clock, never generates an id, never touches the filesystem, and
never mutates an object the caller still holds. Timestamps and ids are arguments. That is
what makes every rule testable by calling it twice with the same values, and it is what the
`hari-os/domain-purity` lint rule enforces (ADR-025).

### Correctability

Inventory is logged as signed deltas, so `reverseInventoryChange` produces an exact
compensating change rather than an approximate one. The expense ledger cannot do this and the
code does not pretend it can: `expense` holds non-negative spends and nothing else, so there
is no row in which a refund or correction could live. That limitation is documented where it
would otherwise be discovered the hard way.

### Testing

`npm run domain:test` runs the rules on the real domain source with no build step, no test
framework, and no database. Internal domain imports carry explicit `.ts` extensions so plain
Node can resolve them (ADR-028).

## 11. Not implemented yet

None of the following exist, and their absence is intentional:

- Any feature module, page, or UI beyond the minimal root page
- **Seed data.** No sample or fake rows exist in any table
- **Persistence of any domain result.** Inventory arithmetic and balance calculation exist
  in `src/domain` and are fully tested, but nothing stores their outcome. No sleep, habit, or
  skill logic exists at all
- Any repository, service, or query module for the schema. The schema exists, and the domain
  rules exist, and nothing connects them: a spend recorded by `applyExpense` does not reach
  SQLite, because that connection is not built yet
- Any command contract or intent type. The domain takes structured input, not a parsed
  sentence
- Filesystem upload handling
- The natural language command parser
- OpenRouter or any LLM integration
- Authentication
- Deployment configuration
- PWA manifest, service worker, or offline support
- A general test framework. The only tests are the two database scripts and the domain
  script described below

`src/lib/db/` contains the connection, migrations, and schema declaration. `src/domain/`
contains the pure rules. `app/` contains only the minimal root page from micro-phase 0.2.
`components/`, `features/`, `commands/`, `lib/storage/`, and `lib/validation/` still hold
boundary READMEs only.

Do not assume a directory is functional because it exists, and do not assume a table being
present means anything can use it yet.

---

## 12. Schema and migrations (added in micro-phase 1.1)

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
