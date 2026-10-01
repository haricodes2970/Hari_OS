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
- `hari-os/command-boundary` applies to `src/commands`. It blocks `better-sqlite3`, the
  filesystem, the network, the environment, and the clock, and blocks `@/lib/db/connection`,
  `@/lib/db/migrations`, and `@/lib/db/schema`. It permits `src/domain` (section 4) and
  `@/lib/db/repositories`, so the executor can coordinate repositories without performing
  persistence (ADR-035).

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

Five kinds exist, and only those with a domain operation behind them:

| Kind | Carries |
| --- | --- |
| `inventory.consume` | item name, amount, unit |
| `inventory.restock` | item name, amount, unit |
| `inventory.set_quantity` | item name, quantity |
| `inventory.recount_after_use` | item name, counted quantity, used amount, unit |
| `expense.record` | account name, item, amount in minor units, optional category |

`inventory.recount_after_use` was added in Phase 3 for the PRD's compound sentence "I had 10
onions, used 2". It carries **two stated facts and no result**: the model reports the 10 and the
2 the user said, and the subtraction that produces 8 happens in `src/domain` and nowhere else. A
kind that could carry a difference would put an unverified number inside the trust boundary.

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

`src/commands/` still contains no provider dependency. The contract remains provider-agnostic:
nothing in `contract.ts` mentions a vendor, because the shape is dictated by the schema and the
domain, not by how a sentence is turned into it. The parser port added in Phase 2 lives in
`src/commands/parser.ts` and holds the same rule — it defines the port, and the provider is an
implementation behind it. See section 14.

## 9. Feature code

`src/features/<area>/`, one directory per product area. A feature owns its rules, its UI, and
its data access, and shares only through its own public surface.

`src/features/shared/` holds what the Kitchen and Expenses pages both need: the form-to-command
translation, the composition root, the read side, and the mapping from error codes to sentences.

`src/features/chat/` is the natural-language slice. It owns the OpenRouter provider, the
runtime seam that reads configuration, the engine that sequences parse-then-execute, and the
pure presentation layer. Of these, only `presentation.ts` is reachable from a component; see
section 14. Area directories for the remaining product areas do not exist yet — see section 12.

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

## 11. The application layer (added in micro-phase 1.5)

The first vertical slice, from a submitted form to persisted state that a page then displays.

```
src/app/page.tsx, /kitchen, /expenses    pages: read state, render it, dispatch nothing
src/components/CommandForm.tsx          the shared form (Server Component, no client JS)
src/components/Nav.tsx                   section links
src/components/OutcomeBanner.tsx         renders a redirect's outcome token
src/app/api/commands/route.ts            POST only: the single command entry point
src/features/shared/command-form.ts      form fields -> contract fields (the only translation)
src/features/shared/command-runtime.ts   the composition root: real database, real clock
src/features/shared/queries.ts           read side for the pages
src/features/shared/outcomes.ts          error codes -> sentences a user can act on
```

Three rules hold this together.

**There is one path to the executor.** Every command reaches it through
`POST /api/commands` (ADR-036). No page, component, or feature calls a repository or the
executor directly, so there is no second path to the data that could skip validation. Phase 2
added a route that reaches the same executor from a sentence (ADR-041), and Phase 3 added one
that reaches only Kitchen maintenance operations and can execute no command (ADR-043); the
property that matters is the single path to the data, and it still holds.

**The composition root is the only place that knows about the real world.**
`command-runtime.ts` supplies the database handle and the clock — the single call to
`new Date()` in the application. The executor itself takes both as arguments, which is why it
stays deterministic and testable to the millisecond while this module is not testable at all.
That asymmetry is deliberate.

**Presentation decides nothing.** Pages and components never compute a balance, a quantity, a
low-stock state, or an outcome. `formatMinorUnits` and `isLowStock` live in the domain;
`outcomes.ts` maps codes to text and contains no rules. The `hari-os/boundaries` lint rule
keeps `src/components/` free of `@/lib/db`, `@/lib/storage`, and `@/commands`, and `npm run
build` fails if a Client Component reaches `server-only`.

### The form posts without client-side JavaScript

`CommandForm` is a Server Component containing a plain
`<form method="post" action="/api/commands">`. The endpoint answers `303 See Other` back to
the page with the outcome as short tokens in the query string, and `OutcomeBanner` renders
it. This works identically with and without JavaScript because there is only one path
(ADR-037). An earlier version used `useActionState` and React replaced the form's `action`
attribute with a stub, so it worked *only* with JavaScript — the enhancement had quietly
become the requirement.

### The endpoint's two shapes

A JSON body is passed to the executor untouched, so the API surface is exactly the validated
contract. A form body is translated by `formToCommand`, because a person types `50`, not
`5000`, and `amount` means money on `expense.record` but a quantity of stock on
`inventory.consume` and `inventory.restock`. The money conversion is therefore chosen by
command kind, never by field name. `formToCommand` fails closed: anything that is not
recognisably a number is forwarded as raw text so validation rejects it and names the field.

## 12. Not implemented yet

None of the following exist, and their absence is intentional:

- Any page beyond Dashboard, Kitchen, and Expenses
- Sleep, routine, skills, habits, diary, or photo features. The schema has their tables and no
  code reads or writes them
- A command to set an opening balance for an account. First-run rows come from `npm run
  db:setup`, and an account reads `₹0.00` until one is spent from. An inventory item can now
  be created from the page, but only through the Kitchen setup route (ADR-043), never as a
  parsed sentence
- A correcting entry for the expense ledger, which holds non-negative spends only. Inventory
  corrections exist; this one needs a migration. Phase 4 assessed it and deferred it (ADR-045,
  ADR-046 are unrelated; the deferral is recorded in `phases/PHASE_04_EXPENSES.md`)
- Batch expense entry from one sentence. The PRD contradicts itself on it, and Phase 2's
  one-sentence-one-command ADR holds
- A "what can I cook with current stock" view. The PRD lists it as later work and Phase 3
  deliberately did not build it
- Filesystem upload handling
- Authentication
- Deployment configuration
- PWA manifest, service service worker, or offline support
- A general test framework. The tests are nine scripts: `db:test`, `domain:test`,
  `contract:test`, `exec:test`, `app:test`, `parser:test`, `chat:test`, `kitchen:test`, and
  `expenses:test`. A tenth, `architecture:probe`, is not a test suite but a check that the
  layer-boundary lint rules still fire (ADR-046)

Do not assume a directory is functional because it exists, and do not assume a table being
present means anything can use it yet.

---

## 13. Schema and migrations (added in micro-phase 1.1)

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

**Changed in micro-phase 1.5 (ADR-038).** `connection.ts` previously did **not** migrate
implicitly, on the reasoning that a read-only path should not silently write. That reasoning
was sound for Phase 0, where nothing read the schema at runtime, but it caused every page to
fail with `no such table` on a new database, which is an HTTP 500 and violates the PRD's
requirement that empty states must not crash. `getDb()` now migrates on open. The original
concern is addressed by the narrower rule that matters: **migrating creates tables, and
creating rows stays in `npm run db:setup`** (ADR-039). Opening a database can never invent
user state.

### Verification

`npm run db:check` migrates and then checks the live schema against `schema.ts`: every
expected table, every expected column, the structural constraints, and the absence of any
unexpected table. Because `schema.ts` is declared separately from the SQL that creates the
tables, a broken migration cannot silently agree with itself.

`npm run db:setup` creates the first-run rows the commands need: the three PRD accounts at a
**zero** opening balance, and three example stock items. It is idempotent, and nothing in
`src/` creates rows. Opening balances are zero because this project does not know the user's
money.

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

## 14. The command engine (added in Phase 2)

A sentence reaches the application through one route and is applied by the same executor that
Phase 1 built. There is one execution path and two ways of reaching it.

```
  "used 2 onions"
        │
        ▼
  POST /api/commands/parse          src/app/api/commands/parse/route.ts
        │  same-origin check, body read, no state
        ▼
  getChatEngine()                   src/features/chat/runtime.ts    server-only
        │
        ▼
  parser.parse(text)                src/commands/parser.ts         the port
        │  untrusted: unknown in, unknown out
        ▼
  fetch openrouter.ai               src/features/chat/openrouter.ts  server-only
        │  the only network call and the only place the key travels
        ▼
  interpret(proposal, sourceText)   src/commands/parser.ts
        │  allowlist; money converted by src/domain
        ▼
  parseCommand(candidate)           src/lib/validation/            the existing gate
        │
        ▼
  runCommand()                     src/commands/executor.ts       unchanged since Phase 1
        │
        ▼
  SQLite
```

### The four chat modules and who may import them

| Module | May import | Must not |
| --- | --- | --- |
| `features/chat/config.ts` | `server-only` | — |
| `features/chat/openrouter.ts` | the port, the prompt, `config` | persist, execute, compute domain results |
| `features/chat/engine.ts` | the port, the executor, the domain | — |
| `features/chat/presentation.ts` | the engine's result types | the provider, the engine, a credential |
| `features/chat/runtime.ts` | `config`, `openrouter`, `engine` | be imported by a component |

This is enforced, not documented. `hari-os/provider-boundary` stops `domain/`, `lib/validation/`,
`lib/db/`, and `commands/` from importing a provider module, so the parser cannot come to depend
on knowing one exists. `hari-os/provider-purity` stops the provider and the prompt from
importing storage, the executor, or `command-runtime`. `hari-os/chat-boundary` stops a
component from importing any of them. All three were verified with probe files.

### What the model is structurally unable to do

Not by instruction — by construction. `candidateToCommand` copies a fixed allowlist of fields,
so an invented field is never read; `toMinorUnits` in `src/domain` performs the money
conversion, so no balance or quantity is ever computed by a model; and the port returns
`unknown`, so nothing downstream is tempted to trust the shape. See ADR-040.

### One sentence, one command

A single input yields at most one command. A proposal containing several is refused. There is
no batch planning, no chaining, no retry, and no conversation history, so nothing accumulates
context between calls.

### Results reach the page as tokens, never as prose

A form cannot read a response body, so the route answers with a `303` carrying an enum and
closed-set tokens in the query string. The sentences a user reads are written by
`presentation.ts` from the trusted execution result. Model text is never rendered.

## 15. The kitchen slice (added in Phase 3)

Kitchen became a real feature rather than the Phase 1 vertical slice. Two additions to the
architecture, and one rule that is the reason it is trustworthy.

```
src/features/kitchen/setup.ts        add an item, rename it, set a threshold  server-only
src/features/kitchen/correction.ts   correct a logged entry                   server-only
src/features/kitchen/view.ts         read side: stock, low-stock, history
src/components/KitchenForm.tsx       the Kitchen forms (Server Component, no client JS)
src/app/api/kitchen/route.ts         POST only: the four non-command operations
src/features/shared/same-origin.ts   ADR-042's guard, now shared by both write routes
```

### Movements and maintenance are different things

A **movement** changes a quantity, so it is a command. It travels
`POST /api/commands` or `POST /api/commands/parse`, is validated by `parseCommand`, is computed
by `src/domain`, and is executed by the executor in one transaction. There is no other way to
move stock.

A **maintenance operation** — starting to track an item, renaming one, changing a threshold —
changes no quantity, so it is not a command and has nothing for a sentence to state. These four
operations have their own route with a closed enum of operations, the same origin guard, and
the same token-based outcome (ADR-043). Adding a fifth operation means editing that enum, which
is the point: the surface cannot grow by accident.

### A correction is a reversal, and the log is the record

Nothing is ever deleted and no quantity is ever written directly. A correction computes the
inverse of the original delta from the *current* quantity and applies it as an ordinary
`inventory.consume` or `inventory.restock` through `runCommand`, so a corrected entry is
validated, computed, and logged exactly like any other movement (ADR-044).

The property that makes this checkable is an invariant: **the stored quantity always equals the
sum of the deltas in the log.** The Phase 3 acceptance run asserts it directly, and it is the
reason a stale-snapshot reversal could not pass unnoticed.

```sql
SELECT SUM(delta) FROM inventory_event WHERE item_id = ?   -- == inventory_item.quantity
```

### Three rules the domain keeps

- **A unit cannot change while stock is non-zero.** 8 pieces is not 8 kg, and this application
  does not convert between units. The rule is in `src/domain`, so no caller can skip it.
- **A threshold of zero is a threshold, and no threshold is `NULL`.** The rule is
  `quantity <= threshold`, so a threshold of zero flags an item only while its quantity is
  zero — "tell me when I am out" — and one piece above that it is not low. No threshold at all
  is `NULL`, which is the only value that disables the flag.
  - Phase 5 recorded a discrepancy here: this section used to claim a zero threshold was
    refused, which the code does not do. Phase 6 resolved it in favour of the code's behaviour
    and corrected the documentation, because the reason the old rule gave — "it would flag
    every item forever" — is not true of `quantity <= threshold`. ADR-048 records the decision
    and the alternative.
- **A recount that also reports a use refuses a use larger than the count.** "I had 10 onions,
  used 2" is a count of 10 and a use of 2, and the difference of 8 is computed here — the model
  reports the two numbers the user actually said and never the difference. A use of 3 against a
  count of 2 is impossible, and is rejected rather than normalised to zero.

## 16. The expenses slice (added in Phase 4)

The daily bill is the only new machinery. Money, accounts, and execution were already correct
from Phases 1 and 2, so Phase 4 verified them rather than rebuilding them — including the account
lookup, which is the one place a bug would spend the wrong money.

```
src/domain/expenses.ts                the daily bill: total and both breakdowns   pure
src/features/expenses/view.ts         read side: accounts, the day's rows, the bill server-only
src/features/expenses/bill.ts         the bill as deterministic text               pure
src/app/expenses/daily-bill/route.ts  GET /expenses/daily-bill -> text/plain
```

### A day's spend is aggregated in the domain, not in SQL

`summariseDay` reads the day's rows and computes the total, the breakdown by item, and the
breakdown by payment method. `SUM(amount)` would have been the obvious way to do this and is the
wrong one: it would be a second implementation of the same rule, so the bill's total and the
Dashboard's figure could come to disagree — which is the one thing a money screen must never do.

Three properties make the bill checkable rather than merely plausible:

- **The breakdown reconciles with the total by construction.** Both breakdowns are partitions of
  the same entries, so each sums to the total.
- **Every sum goes through `addMinorUnits`,** which refuses an addition past the exact integer
  range. `SUM` would return a float and lose a paisa quietly.
- **The order is total.** Lines sort by amount then label, grouping is case-insensitive, and the
  displayed spelling is the alphabetically first one present — so the same ledger produces
  byte-identical text regardless of the order rows arrived in. This is a bill to send to somebody.

### The bill is a document, not a generated sentence

Every character of the shareable text comes from persisted rows through `formatMinorUnits`. No
model writes any of it. A summary whose wording came from a model is a summary whose numbers can
be influenced by a sentence typed an hour earlier.

It is served as `text/plain` from a `GET` route rather than produced by a copy button. This
application has no client-side JavaScript (ADR-037); a copy button would have been the project's
first client component, to save three keystrokes. A plain-text document can be selected, copied,
saved, or opened in a mail app, with scripting disabled. It is a read, so it needs no origin
guard — ADR-042 protects writes.

### Spending and balances are different numbers

A balance is what an account holds now, across every day. A day's spend is only what was spent
that day. They are shown separately, neither is derived from the other, and a negative balance is
shown as it is: ADR-021 allows being overdrawn, and no affordability rule was invented.

### The boundary rules are now real (ADR-046)

Until Phase 4, the layer boundaries in `AGENTS.md` were documented but not enforced: `src/domain`
could import `@/lib/db` and `npm run lint` passed. Later ESLint configs silently replaced earlier
ones for the same rule, and only the provider patterns were ever in effect. The rules are fixed
and `npm run architecture:probe` asserts each one fires — including that the imports the
architecture *permits* still pass.

## 17. The dashboard slice (added in Phase 5)

The Dashboard is the one screen that displays no data of its own, so its architecture is entirely
about where each figure comes from.

```
src/features/dashboard/view.ts   the read model: one function, four sources, no rules   server-only
src/domain/habits.ts             the habit_log vocabulary, mirroring the schema's CHECK       pure
src/app/page.tsx                 the screen: render, and nothing else
```

### One read model, composed from the owning features

```
DashboardPage → readDashboard(date) → listKitchenStock()      (Kitchen view, isLowStock)
                                └→ readDailyBill(date)       (Expenses view, summariseDay)
                                └→ readRoutine(date)          (Routine view, selectTopTasks)
                                └→ display.habitsForDate(date)(habit_log)
```

Phase 6 replaced `display.tasksForDate` with `readRoutine`. ADR-047 had accepted that ad-hoc read
only while no feature owned `plan_task`; now one does, and ADR-050 retires it so the table has a
single reader.

`readDashboardSummary` used to live in `src/features/shared/queries.ts` and it moved. That file
holds the Kitchen page's inventory projection; a Dashboard that aggregates three features is not
a shared helper, and leaving the old name behind would have allowed a second definition of "what
the dashboard shows" to drift away from this one.

### Two figures that are the same number on purpose

- **Low stock** is the domain's `isLowStock`, reached through the Kitchen read side. The rule
  `quantity <= threshold` exists once; the Dashboard does not restate it.
- **Today's spend** is `summariseDay` over the day's rows — the function behind the daily bill.
  The Dashboard and the bill therefore cannot disagree, which is why the repository's SQL
  aggregate `spendForDate` is not used here. Two ways to total a day is the failure ADR-047
  describes.

### The read model has no rules, and no opinion

It selects, it calls existing rules, and it shapes. It does not rank, score, or suggest: the
"first action" is the first task row the user wrote down that is not marked done, and it is
absent when there is nothing planned or everything is finished. No model is involved in producing
any word on the page.

A module that does not exist is reported as unavailable rather than as empty. Skills is a build
constant set to `false`; a missing `habit_log` row reads as **not recorded**, which is a statement
about the data rather than a verdict about the user's day.

### New enforced scopes

`npm run architecture:probe` now also asserts, for the Dashboard specifically:

| Scope | Refuses |
| --- | --- |
| `src/features/dashboard/**` | `@/lib/db`, `better-sqlite3`, `node:fs`, provider modules, `@/commands/executor`, feature write sides |
| `src/app/**` | `@/lib/db`, `better-sqlite3`, `node:fs`, provider config and transport |

`next/server` is exempt from the `src/app` rule: every route handler imports it, and a framework
import is not storage access. The rule exists because "no SQL in the page component" is a claim
that was, until Phase 5, made only in prose.

---

## 18. The routine and sleep slice (added in Phase 6)

```
src/domain/calendar.ts            YYYY-MM-DD parsing, UTC day arithmetic      pure
src/domain/routine.ts             tasks, the top three, the night check-in     pure
src/domain/sleep.ts               clock times, night and nap lengths, streak   pure
src/lib/db/repositories.ts        TaskRepository, SleepRepository, NapRepository
src/features/routine/write.ts     the night check-in: one transaction          server-only
src/features/routine/view.ts      the read model the Routine page and the Dashboard share
src/app/api/routine/route.ts      POST only: the one non-command operation
src/app/routine/page.tsx          the Routine page
src/components/RoutineForm.tsx    the check-in form (Server Component, no client JS)
```

### The schema already existed, so this phase wrote no migration

`plan_task`, `sleep_log`, and `nap_log` have been in `db/schema.sql` since micro-phase 1.1, and
`db:check` asserts all three tables and their columns. Phase 6 added repositories and rules over
them and **no SQL DDL**, which is the first time a feature slice has needed nothing from
`migrations/`.

### What "a night" means

A night is stored under **the day it began**. Bedtime 23:30 on the 1st and a wake-up at 07:10 on
the 2nd are one row dated the 1st. That is what lets `UNIQUE (date)` mean "one night per day"
instead of "one row per wake-up", and it is why durations wrap past midnight rather than going
negative — the wrap lives in `overnightMinutes`, and nothing else in `src/` subtracts two clock
times.

Three times are recorded, and all three are optional: `bedtime`, `sleep_time`, and `wake_time`.
A night with a bedtime and no wake time has **no length to report**, and the read model returns
`null` for it rather than counting to midnight. A night is allowed to be incomplete because
"I went to bed at 23:30" says nothing about when the user woke, and inventing a placeholder would
be inventing a fact.

Two of the three times being equal is refused at write time, in the domain. A sleep time equal to
the bedtime means no time passed between lying down and sleeping; a wake time equal to either
means the night is either zero-length or a full day. The same ambiguity `overnightMinutes` refuses
to resolve, caught before it reaches the database.

### Day references, never computed dates

A command carries `day: "today" | "tomorrow" | "yesterday"` — the words the user said. The date is
resolved by `resolveDayReference` in `src/domain/routine.ts` against the date the executor's
injected clock produced, in UTC, because every stored timestamp is a UTC instant. No command
contains a date, an id, a duration, a priority, or a timestamp, and the parser is instructed not
to emit one. Adding a computed date to the contract would make the model responsible for knowing
what day it is.

### Task order is the priority, and there is no priority column

Tasks are stored and read in ascending `id`, so the order they were written is the order they
matter in. `selectTopTasks` takes the first three; `taskCount` keeps the true number so a day with
five tasks reports five rather than silently showing three. Nothing in `src/` ranks, scores, or
reorders a task, and there is no column in which a rank could be stored.

### The check-in is an operation, not a command

See ADR-049. `POST /api/routine` has a closed enum of one operation, the same origin guard as the
other write routes, and the same token-based outcome. All four of its writes share one
transaction. Adding a second operation means editing the enum.

### What the streak is, and what it is not

`wakeConsistencyStreak` counts consecutive days with a wake time inside the domain's
`WAKE_WINDOW_START`–`WAKE_WINDOW_END` (06:15–07:30, the two times the PRD reports). It is a
neutral habit counter and it is rendered as a record: no score, no grade, no progress bar, no
punishment, and no wording that compares a day to a target. A missing entry is "not recorded",
never a failure.

### Nap warnings are the PRD's, and they are soft

A nap over 30 minutes warns, and a nap starting after 15:00 warns. The boundaries are exact — 30
minutes does not warn, 15:00 does not — and both messages are produced by the domain and rendered
verbatim. They are shown once, beside the nap, and they block nothing. A nap's length is `null`
while it is still running rather than counting to the current time, because the application does
not know when a nap will end.

### One reader per table, and the enforced scopes are unchanged

`plan_task`, `sleep_log`, and `nap_log` each have exactly one reader, owned by this slice
(ADR-050). The Dashboard composes `readRoutine` rather than reaching past it, which is how it
gained the sleep card without a second definition of "today's tasks". No new enforced boundary
scope was added: the existing rules already forbid `src/app/**` from touching storage and
`src/domain/**` and `src/components/**` from importing it, and `src/features/routine/**` is
covered by the feature rule that existed since Phase 3.
