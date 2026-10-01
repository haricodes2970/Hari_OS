# Architectural Decisions

Each decision records what was decided, why, and what it rules out. Decisions are not
rewritten silently — superseded entries are marked and kept.

Format: `ADR-XXX — Title` with Status, Date, Context, Decision, Consequences.

---

## ADR-001 — SQLite instead of Supabase

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** `Hari_OS_V1_PRD.docx` section 7 states: "Backend and storage: Supabase
  (Postgres for records, Storage for laundry photos), or SQLite if faster to set up."
  Project technical decisions pin SQLite and explicitly forbid Supabase for this version.
- **Decision:** Use SQLite on the local filesystem. No Supabase, no external database
  dependency. Laundry photos are stored on the local filesystem, not in Supabase Storage.
- **Consequences:** The PRD's Supabase path is not built. V1 is local-only, so there is no
  multi-tenant or network database concern. The Phase 8 laundry upload design must target
  `data/uploads/laundry/` rather than object storage. If remote hosting is ever required,
  this decision is revisited.
- **Origin:** Micro-phase 0.2, resolving the PRD conflict recorded in 0.1.

## ADR-002 — No authentication in V1

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** PRD section 5 mentions a "simple password gate, no full authentication".
  Project instructions list authentication as out of scope for V1.
- **Decision:** No authentication. The app binds to localhost only.
- **Consequences:** The app must not be exposed to a network interface while unauthenticated.
  A gate may be added later without architectural change.
- **Origin:** Micro-phase 0.1.

## ADR-003 — No PWA dependency in Phase 0

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** PRD section 1 and 7 require a Progressive Web App (installable, camera access
  for laundry photos). No PWA manifest or service worker exists yet.
- **Decision:** Do not add a PWA package (`next-pwa`, `@serwist/next`, etc.) in Phase 0. The
  foundation is prepared instead: root layout with configurable metadata, explicit
  `viewport` export including `viewportFit: "cover"` and `themeColor`, and an empty
  `public/` directory ready to hold `manifest.webmanifest` and icons.
- **Consequences:** No bundle size or config complexity is added before it is needed. The
  package choice is deferred to Phase 8 and must be documented when introduced.
- **Origin:** Micro-phase 0.2.

## ADR-004 — npm as the package manager

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** The environment has npm 10.9.8 and pnpm installed. There is no
  repository-specific reason to prefer pnpm.
- **Decision:** Use npm. `package-lock.json` is committed and is the lockfile of record.
- **Consequences:** No lockfile duplication. Switching package managers later would require
  removing the npm lockfile and recommitting.
- **Origin:** Micro-phase 0.2.

## ADR-005 — Light-only styling in V1

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** PRD section 4: "Function over looks: plain black text on a white background
  for V1. Styling comes later." The Next.js scaffold ships an automatic
  `prefers-color-scheme: dark` inversion.
- **Decision:** Removed the scaffold's automatic dark-mode inversion. The app renders
  black text on a white background regardless of OS theme, matching the PRD.
- **Consequences:** Dark mode is a later styling phase, not a defect.
- **Origin:** Micro-phase 0.2.

## ADR-006 — No Google font dependency

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** The Next.js scaffold imports the Geist fonts from `next/font/google`, which
  fetches from Google at build time.
- **Decision:** Use the system font stack (`Arial, Helvetica, sans-serif`) already present in
  the scaffold's `globals.css`. No `next/font/google` import.
- **Consequences:** Builds do not depend on network access, and the app loads instantly
  offline — which matters for a local-first PWA. Visual styling is deferred.
- **Origin:** Micro-phase 0.2.

## ADR-007 — Explicit React types instead of generated route types

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** The Next.js 16 scaffold types the root layout as
  `function RootLayout({ children }: LayoutProps<"/">)`. `LayoutProps` is a global type
  generated into `.next/types` and does not exist until `next dev` or `next build` has run.
  On a fresh clone, `npm run typecheck` failed with `TS2304: Cannot find name 'LayoutProps'`.
- **Decision:** Type the layout as `{ children: ReactNode }` explicitly.
- **Consequences:** `npm run typecheck` passes on a clean checkout with no prior build.
  Generated route types remain available and may be adopted per-route when convenient.
- **Origin:** Micro-phase 0.2, fixing a real failure caught during verification.

## ADR-008 — App Router with `src/` directory

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** Next.js 16 supports App Router and Pages Router. The import alias `@/*` maps to
  `src/*`.
- **Decision:** App Router, with sources under `src/`, import alias `@/*`.
- **Consequences:** Server Components are the default. Future SQLite access (0.5) can run
  server-side without a separate backend service. No Pages Router code.
- **Origin:** Micro-phase 0.2.

## ADR-009 — Prettier without an ESLint integration package

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** Micro-phase 0.3 required Prettier and required that Prettier and ESLint not
  fight. `eslint-config-prettier` is the conventional way to guarantee this, but the guidance
  was to add an integration package only if genuinely necessary.
- **Decision:** Do **not** add `eslint-config-prettier`. Prettier is configured with explicit
  defaults and `eslint-config-next` is left untouched.
- **Evidence:** `eslint-config-next@16.3.7` ships no core ESLint formatting rules
  (`quotes`, `semi`, `indent`, `comma-dangle`, `max-len`, `arrow-parens`,
  `object-curly-spacing`) and no `@stylistic` integration, so there is nothing to disable.
  This was then verified empirically: a deliberately misformatted `.tsx` probe file was
  reported by `prettier --check` while `eslint` exited 0 with no diagnostics. The probe file
  was deleted.
- **Consequences:** One fewer dependency. If a future ESLint plugin introduces stylistic
  rules, this decision must be revisited and `eslint-config-prettier` added at that point.
- **Origin:** Micro-phase 0.3.

## ADR-010 — Prettier ignores documentation and lockfiles

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** `npm run format` runs `prettier --write .` over the whole repository. Left
  alone, it would rewrite `package-lock.json` and reformat every Markdown document.
- **Decision:** `.prettierignore` excludes `package-lock.json` (not ours to format),
  `docs/` and `Hari_OS_V1_PRD.docx` (historical project record, not application code), plus
  `public/`, build output, `data/`, and dependencies.
- **Consequences:** The PRD and past session reports stay byte-stable. Markdown tables in
  application-adjacent files such as `README.md` are still formatted.
- **Origin:** Micro-phase 0.3.

## ADR-011 — Architecture boundaries enforced by ESLint, not a package

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** Micro-phase 0.4 required boundaries that stop UI from coupling directly to
  SQLite or the LLM. The usual tools are dependency-cruiser or eslint-plugin-boundaries,
  both of which add dependencies and configuration.
- **Decision:** Enforce the two load-bearing rules with the built-in ESLint
  `no-restricted-imports` rule, configured in `eslint.config.mjs` as `hari-os/boundaries`.
  Files under `src/domain/` and `src/components/` may not import `@/lib/db`,
  `@/lib/storage`, or `@/commands`. No new dependency.
- **Evidence:** Verified with probe files, since an untested boundary rule is a comment
  wearing a disguise. Probes importing infrastructure from `domain/` and `components/`
  were both reported as errors; probes importing `lib/db` from `app/` and `features/`
  exited clean. All probes were deleted.
- **Consequences:** Violations fail `npm run lint` with no new dependency. The rule is
  intentionally narrow: it constrains only the two layers where purity is unambiguous.
  Service and repository layers are not introduced preemptively. If cross-layer rules grow,
  this decision should be revisited rather than expanded indefinitely.
- **Origin:** Micro-phase 0.4.

## ADR-012 — No shared `src/types/` directory

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** Micro-phase 0.4 listed a `types/` directory in the suggested structure, while
  also instructing that a giant global types file be avoided and that types be owned by
  their area where possible.
- **Decision:** Do not create `src/types/`. Types live in `src/domain/` when they describe
  a business concept, and in the feature that owns them otherwise. They move to a shared
  location only when two boundaries genuinely require the same shape.
- **Consequences:** Types are harder to leak across module boundaries than a shared barrel,
  which is the point. A shared type module can be introduced later if a real duplication
  justifies it.
- **Origin:** Micro-phase 0.4.

## ADR-013 — Directories created without implementation

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** Micro-phase 0.4 asked for clean boundaries but also warned against dozens of
  empty placeholder files and speculative abstractions.
- **Decision:** Create the seven boundary directories that later phases will build on, each
  containing a short README stating what belongs there and what must not. Create no
  subdirectories inside `src/features/`, and no code, until the phase that needs them.
  No barrel `index.ts` files.
- **Consequences:** The structure is visible in the repository today without implying that
  anything is implemented. The cost is seven short files, each of which prevents a
  future agent from guessing where code belongs. A visitor must read `ARCHITECTURE.md` to
  know that only `app/` currently works.
- **Origin:** Micro-phase 0.4.

## ADR-014 — better-sqlite3 instead of the built-in `node:sqlite`

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** Micro-phase 0.5 required a local SQLite implementation with a minimal
  dependency surface and no ORM. Node v22.23.1 ships a built-in `node:sqlite` module, so
  using it would have required zero dependencies at all. It was tested before being
  rejected, not assumed to be unsuitable.
- **Decision:** Use `better-sqlite3`. Also added `@types/better-sqlite3` and `server-only`.
- **Evidence:**
  - `node:sqlite` works on this Node version (SQLite 3.51.2) but prints
    `ExperimentalWarning: SQLite is an experimental feature and might change at any time`
    on every run. Its API can change under us.
  - `better-sqlite3@13` installed from a prebuilt binary in 2 seconds with no compiler,
    no `node-gyp`, and no build tooling, verified working on Node v22.23.1 with SQLite
    3.53.4. It adds 2 packages total and `npm audit` reports 0 vulnerabilities.
  - The database will hold financial balances and inventory quantities, which V1 requires
    to be deterministic and correctable. A stable API is worth two packages here.
- **Consequences:** One native dependency and one types package. Because it is a native
  module, `next.config.ts` sets `serverExternalPackages: ["better-sqlite3"]` so Next does
  not try to bundle it. A Node upgrade that lacks a matching prebuilt binary would require
  a compiler toolchain; the `engines` field pins Node >= 20.9.0 to limit that exposure.
  Revisit if prebuilds stop covering the local Node version.
- **Origin:** Micro-phase 0.5.

## ADR-015 — `server-only` as the server-side guard

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** The database code must never reach the browser. The 0.4 ESLint boundary rule
  already blocks `src/domain/` and `src/components/` from importing `src/lib/db`, but it
  does not cover a Client Component placed inside `src/app/`.
- **Decision:** `src/lib/db/connection.ts` imports `server-only`, the framework's own
  marker package, which throws when resolved outside a Server Component.
- **Evidence:** Verified rather than assumed. A temporary route with `"use client"`
  importing `@/lib/db/connection` was created and `npm run build` failed with
    `You're importing a module that depends on "server-only"`. The probe route was then
    deleted. An earlier probe using an `_`-prefixed directory was silently skipped by the
    App Router as a private folder, which is why the first attempt produced no result;
    the route was renamed before the guard was confirmed.
- **Consequences:** Accidental client usage fails the build instead of shipping SQLite to
  the browser. Because `server-only` throws by default outside a Server Component, the
  standalone `db:check` script runs Node with `--conditions=react-server`.
- **Origin:** Micro-phase 0.5.

## ADR-016 — Optional `HARI_OS_DB_PATH` override

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** The V1 database path should be deterministic, but tests and future tooling
  need to point at a throwaway database without touching the real one.
- **Decision:** The path defaults to `path.join(process.cwd(), "data", "hari-os.db")` and
  may be overridden by the optional `HARI_OS_DB_PATH` environment variable. No other
  configuration was introduced, and no absolute machine-specific path is hard-coded.
- **Consequences:** Normal development needs no configuration at all. `npm run db:check`
  treats an override as legitimate and only asserts that the *default* path stays inside
  the project root. `.env.example` and `.gitignore` handling land in micro-phase 0.6.
- **Origin:** Micro-phase 0.5.

## ADR-017 — `"type": "module"` declared in package.json

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** `src/lib/db/connection.ts` uses ES module syntax, and running it through the
  standalone `db:check` script made Node print
  `MODULE_TYPELESS_PACKAGE_JSON ... Reparsing as ES module`. Suppressing the warning was
  rejected as concealing a real signal.
- **Decision:** Declare `"type": "module"` in `package.json`.
- **Evidence:** Verified that this does not break the project: `npm run build`,
  `npm run typecheck`, `npm run lint`, and `npm run db:check` all pass, and the warning no
  longer appears. Next.js 16 handles ESM projects natively.
- **Consequences:** The warning is removed at its source rather than hidden. If a future
  tool requires CommonJS, this field is the single place to revert.
- **Origin:** Micro-phase 0.5.

## ADR-018 — `.env.example` documents one variable; no `.env` is committed

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** Micro-phase 0.6 required explicit, reproducible environment handling. The
  only environment variable the codebase reads is `HARI_OS_DB_PATH`, introduced in 0.5.
- **Decision:** Add a tracked `.env.example` documenting `HARI_OS_DB_PATH` only, with safe
  example values and no machine-specific absolute paths. Do not add a `.env` file, and do
  not document variables that no code reads yet.
- **Consequences:** A developer can discover the required variables without seeing any real
  value. `.env.example` stays tracked via an explicit `!.env.example` negation, verified
  with `git check-ignore -v --no-index`. `.env.example` will be extended when the OpenRouter
  key is introduced in Phase 2 — not before.
- **Origin:** Micro-phase 0.6.

## ADR-019 — Ignore rules narrowed to secrets and local user data

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** Micro-phase 0.6 required the database, WAL sidecars, and future uploads to be
  untrackable, while explicitly forbidding broad ignores of source code or documentation.
- **Decision:** Extend the existing rules rather than replace them. Added `data/**`, `*.db`,
  `*.db-wal`, `*.db-shm`, `*.sqlite`, `*.sqlite3`, the explicit non-`.local` environment
  variants (`.env.development`, `.env.test`, `.env.production`), and the `!.env.example`
  negation.
- **Evidence:** Every rule was proven with real files rather than assumed. Temporary
  `.env`, `.env.local`, `.env.development`, `.env.development.local`, `.env.test.local`,
  `.env.production.local`, `data/test.db`, `data/uploads/laundry/test.jpg`,
  `data/hari-os.db-wal`, `data/hari-os.db-shm`, and a stray `stray-outside-data.db` were
  created; `git check-ignore` reported every one as ignored and `.env.example` as not
  ignored. All temporary files were then deleted and the database re-verified with
  `integrity_check: ok`.
- **Consequences:** A database created outside `data/` is still protected. Documentation
  and source remain trackable. WAL and shm sidecars cannot be committed even if they appear
  at an unexpected path.
- **Origin:** Micro-phase 0.6.

## ADR-020 — Hand-written ordered SQL migrations, no migration framework

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** Micro-phase 1.1 required a reproducible, idempotent schema mechanism without
  adding a package for its own sake. The options were a framework (`node-pg-migrate` and
  equivalents, or an ORM's migrator) or a small owned mechanism in `src/lib/db/`.
- **Decision:** A hand-written ordered migration list in `src/lib/db/migrations.ts`, tracked
  in a `schema_migrations` table. Each migration runs inside a transaction together with the
  insert that records it, so a failure cannot leave a half-applied version marked complete.
  Re-running is a no-op.
- **Consequences:** No new dependency. Migrations are schema-only and reviewable in a
  normal diff. The tradeoff is that nothing enforces naming or ordering discipline, so the
  rules are written at the top of the file: never edit an applied migration, never use
  `DROP TABLE` as a normal strategy, no business arithmetic in SQL. A database containing a
  version this code does not know about is refused with a clear error rather than silently
  downgraded, which protects against running new code against an older database.
- **Origin:** Micro-phase 1.1.

## ADR-021 — Money stored as integer minor units

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** `account.balance` and `expense.amount` hold financial values. Floating-point
  storage cannot represent common decimal currency values exactly, and Hari OS requires
  balances to be deterministic (PRD principles 11 and 12).
- **Decision:** Store money as `INTEGER` minor units (paise). No `REAL` money column exists
  anywhere in the schema. The scale is fixed at two decimal places, which matches the
  currency implied by the PRD's rupee examples.
- **Evidence:** SQLite column types are *affinity*, not enforcement. `amount INTEGER` accepted
  a value of `10.5` until a `CHECK (typeof(amount) = 'integer')` constraint was added. This
  was found by a test written specifically to try it, not by inspection. `balance` carries
  the same guard.
- **Consequences:** Arithmetic is exact. Rounding and display formatting become the domain
  layer's responsibility in a later micro-phase — the schema stores a whole number of minor
  units and nothing more. `balance` is deliberately allowed to go negative: being overdrawn
  is a real state, not a database error, so no `CHECK` constrains its sign.
- **Origin:** Micro-phase 1.1.

## ADR-022 — `INTEGER PRIMARY KEY` and ISO-8601 text timestamps

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** Every table needs a primary key, and the PRD mixes daily records with
  instants: `date` for `plan_task`, `sleep_log`, `nap_log`, `habit_log`, `private_log`, and
  `timestamp` for `inventory_event`, `expense`, `skill_log`. The runtime already provides
  `Date`, so no UUID package was needed.
- **Decision:**
  - **IDs:** `id INTEGER PRIMARY KEY` on every table, a rowid alias, so no extra index is
    needed. No `AUTOINCREMENT`, since it only adds `sqlite_sequence` bookkeeping.
  - **Daily dates:** `TEXT` in `YYYY-MM-DD`.
  - **Wall-clock times** (bedtime, sleep time, wake time, nap start and end): `TEXT` in
    `HH:MM`, 24-hour, local.
  - **Instants:** `TEXT` ISO-8601 in UTC, which is what `new Date().toISOString()` emits.
- **Consequences:** ISO-8601 strings sort lexicographically in chronological order, so range
  queries and ordering work without a date library. Storing a calendar date as a date rather
  than an instant avoids the timezone trap where "today" shifts depending on when it is
  converted — a real risk for a sleep log written at 1 AM local. A local-first single-user app
  with no multi-timezone requirement does not need a UUID; integer keys also keep foreign keys
  compact and readable.
- **Origin:** Micro-phase 1.1.

## ADR-023 — `typeof()` checks because SQLite types are advisory

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** SQLite uses type *affinity*, not strict typing: a column declared `INTEGER`
  will still store a `REAL` or `TEXT` value if the conversion is lossy. A `STRICT` table
  would enforce types properly but only permits `INT`, `INTEGER`, `REAL`, `TEXT`, `BLOB`, and
  `ANY` — it has no `NUMERIC` type, which the inventory quantity representation needs.
- **Decision:** Keep ordinary tables and add explicit `CHECK (typeof(col) = ...)` constraints
  where the type is structural: money (`amount`, `balance`), booleans (`done`, `active`,
  `phone_outside`), whole-minute durations (`minutes`), and numeric-ness of quantities
  (`quantity`, `delta`, `low_threshold` accept `integer` or `real`).
- **Consequences:** Booleans reject `2` and `0.5`, not just values outside `0`/`1`. Money
  rejects `10.5`. This costs some verbosity in the DDL, but each constraint is legible and
  testable. `STRICT` tables remain an option for a future micro-phase if `NUMERIC` is no
  longer needed.
- **Origin:** Micro-phase 1.1.

## ADR-024 — Inventory quantity uses `NUMERIC`, allowing integers to stay exact

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** PRD examples are `onions: 8 pieces` and `rice: kg`. A count is an integer, but
  a weight in kilograms is usually fractional, so an integer-only representation would force
  a unit change (grams) or an artificial scale factor (thousandths) that every caller must
  remember to convert.
- **Decision:** `quantity NUMERIC`, with a `CHECK` permitting `integer` or `real` and
  rejecting negatives. Whole counts are stored as exact integers; only genuinely fractional
  values become floating point.
- **Consequences:** This avoids gratuitous float for the common case, at the cost of not
  being fully exact for fractional quantities — binary floating point cannot represent most
  decimal fractions precisely. That limitation is deliberate and bounded: the domain layer
  owns deterministic rounding when it implements quantity arithmetic in a later micro-phase,
  and the schema's job is to refuse negatives and non-numerics. Storing thousandths instead
  would be exact but would push a conversion bug into every future caller.
- **Origin:** Micro-phase 1.1.

## ADR-025 — Domain purity is enforced by lint, not just documented

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** `AGENTS.md` and `ARCHITECTURE.md` require `src/domain` to stay free of
  infrastructure, but until now only *imports* were enforced. A rule that read `Date.now()`,
  `process.env`, or a file would still pass typecheck and still pass every test written
  against a fixed clock, and would quietly become untestable. The failure is silent, which is
  exactly when a rule is worth enforcing.
- **Decision:** Add a `hari-os/domain-purity` ESLint rule over `src/domain` that restricts
  `node:fs`, `node:os`, `node:path`, `node:child_process`, network modules, `better-sqlite3`,
  `server-only`, `next/*`, `@/lib/db`, `@/lib/storage`, and `@/commands` imports, and that
  restricts `process.env`, `Date.now`, and `Math.random`.
- **Consequences:** Every impurity is a build failure with a message naming the fix. The
  cost is that a genuinely pure use of `Date` or `Math` — reading a supplied `Date`, for
  example — needs no exemption today, but would if one appears; the escape hatch is a
  targeted disable comment, which is visible in review. Verified with a temporary probe file
  that triggered all seven restrictions, then deleted.
- **Origin:** Micro-phase 1.2.

## ADR-026 — Result-typed failures instead of exceptions for expected refusals

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** Domain operations are pure functions and cannot throw away a wrong answer, so
  a validation failure has to come back as a value. Throwing would also force every caller to
  wrap each call in a `try`, which is the shape that hides failures rather than surfacing
  them.
- **Decision:** Every operation returns `Result<T>`, a discriminated union of `{ ok: true,
  value }` and `{ ok: false, error }`, with `error.code` drawn from a closed set of seven
  codes. Callers switch on `code`, never on `message`.
- **Consequences:** A caller cannot use a domain result without having handled failure,
  because `value` does not exist on the failure branch. The cost is verbosity at every call
  site, and a mild ergonomic imbalance against plain `try`. Codes are a closed union on
  purpose: adding one later is a deliberate act rather than an incidental new `throw`.
  Domain code cannot produce a database error, so no code exists for one — infrastructure
  failures surface at the layer that owns them.
- **Origin:** Micro-phase 1.2.

## ADR-027 — Fractional quantities are accepted and their error is bounded, not eliminated

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** ADR-024 chose `NUMERIC` over `INTEGER` because stock is both whole counts and
  fractional weights, and explicitly deferred the question of float error to "the domain layer
  owns deterministic rounding". Micro-phase 1.2 is that layer, so the deferral has to be
  resolved. Rejected alternatives: storing thousandths (exact, but ADR-024 rejected it as it
  pushes a conversion bug into every caller), and restricting quantities to integers (exact,
  but forces grams or an arbitrary scale factor onto the user).
- **Decision:** Six decimal places. Inputs must already be within that scale and are rejected
  otherwise; arithmetic results are rounded to that scale exactly once; magnitudes above
  `1e9` are refused because decimal scaling stops being exact there.
- **Consequences:** `0.1 + 0.2` is exactly `0.3`, and re-applying an operation to its own
  output changes nothing, so results are stable and reproducible. Binary floating point
  still cannot represent most decimals exactly, so fractional stock carries a bounded error
  below one millionth of a unit. That limitation is documented in `quantity.ts` rather than
  hidden, and it is far below the precision of any kitchen measurement. Rounding is applied
  only to results, never to inputs, so no caller can silently lose precision on the way in.
- **Origin:** Micro-phase 1.2.

## ADR-028 — Explicit `.ts` import specifiers inside `src/domain`

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** The domain tests run on plain Node, which strips types but resolves ESM
  specifiers itself and therefore requires an explicit file extension. TypeScript and Next
  both accept extensionless specifiers, so the two resolvers disagreed. The domain's first
  runtime imports are in this micro-phase; `src/lib/db` never had the problem because its
  only cross-file import is `import type`, which is erased before resolution.
- **Decision:** Internal domain imports are written as `./quantity.ts`, enabled by
  `allowImportingTsExtensions` in `tsconfig.json`, which is permitted because the project
  never emits.
- **Consequences:** Domain tests run on the real domain source with no build step, no
  transpiler dependency, and no test framework. The trade-off is that domain specifiers look
  unusual next to extensionless imports elsewhere; the alternative was adding a bundler or
  transpiler solely to run tests, which is a larger cost than the style inconsistency.
- **Origin:** Micro-phase 1.2.

## ADR-029 — The command contract carries facts, never results

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** Micro-phase 1.3 needed the shape a future parser must produce. The tempting
  design is a "rich" command that precomputes what will happen — an expense command carrying
  the new balance, a stock command carrying the remaining quantity — because it would let the
  UI show a preview with no extra work.
- **Decision:** A command carries only what the user stated: an item name, a quantity, a
  unit, an account name, an amount in minor units, an optional category, and the originating
  sentence as `sourceText`. It carries no id, no timestamp, and no derived outcome.
  `src/commands/contract.ts` declares four kinds: `inventory.consume`,
  `inventory.restock`, `inventory.set_quantity`, `expense.record`.
- **Consequences:**
  - **Names, not ids.** A language model reading "used 2 onions" cannot know a row id, and
    asking one to invent an id would be asking it to fabricate a fact. Resolution to a row is
    execution's job and produces a domain failure when nothing matches.
  - **No timestamp.** The moment a spend happened is the moment the user logged it, not the
    moment a model finished responding. Inventing one at parse time would quietly record a
    wrong time.
  - **No computed outcome.** The PRD requires balances and quantities to be decided by
    deterministic code. A command that already carried a new balance would put that number
    in the trust boundary, where nothing checks it. A test asserts a validated command
    contains no such field.
  - `expense.record` names the account while the domain takes an id, so `domain-input.ts`
    maps a resolved account into the operation's arguments. It is a translation only: no
    lookup, no arithmetic, no execution.
- **Origin:** Micro-phase 1.3.

## ADR-030 — One required `version` literal, and nothing more

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** These objects are produced by a language model working from a prompt, so the
  shape of what returns can change when the prompt changes. Without a marker, a payload from
  an older prompt would be validated field by field and could be silently reinterpreted —
  for example an `amount` that once meant rupees and now means minor units, which is a
  factor of one hundred applied without anyone deciding to apply it.
- **Decision:** A required `version` field that must equal `COMMAND_VERSION`. Anything else,
  including a future version, is rejected. No compatibility machinery, no migration path, and
  no support for any second version.
- **Consequences:** The validator fails closed on a shape it was not written for, which is the
  whole point of a boundary in front of a non-deterministic producer. The cost is that any
  future contract change is a breaking change requiring both a version bump and prompt
  changes; that is a deliberate cost, because silently accepting two meanings of `amount` is
  the failure this prevents.
- **Origin:** Micro-phase 1.3.

## ADR-031 — Hand-written validation, no schema library

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** `src/lib/validation/README.md` committed to adding a library only when a real
  schema demanded one. This micro-phase is the first concrete need, so the question had to be
  answered rather than deferred again.
- **Decision:** No library. The job is checking the shape of four object types against an
  allowlist of fields, and that is roughly 200 lines of `typeof` checks.
- **Consequences:** Zero dependencies, no build or plugin step, and guards that read as plain
  rules. Errors carry a field path and a specific code, which is more precise than a schema
  library would have produced without extra work. The cost is that this approach would not
  scale gracefully to dozens of schemas, and a library should be reconsidered if the command
  families grow substantially rather than incrementally. Representation checks deliberately
  reuse the domain's own exported predicates (`isMoneyAmount`, `isQuantity`,
  `isAccountName`) rather than re-implementing them, so the command boundary and the schema
  `CHECK` constraints cannot drift apart.
- **Origin:** Micro-phase 1.3.

## ADR-032 — Validation and command boundaries are enforced, not documented

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** ADR-025 enforced purity for `src/domain` only. The two directories added in
  this micro-phase have the same requirement and the same silent failure mode: a validator
  that queries SQLite still passes every test written against a fixed schema, and a command
  module that writes a row still typechecks fine.
- **Decision:** Two more lint rules sharing one definition of impurity.
  `hari-os/validation-purity` blocks filesystem, network, process, database, and framework
  access in `src/lib/validation`. `hari-os/command-boundary` blocks the same persistence
  modules in `src/commands`. Both also block `process.env`, `Date.now`, and `Math.random`.
- **Consequences:** `src/commands` is *not* blocked from importing `src/domain`, because
  `ARCHITECTURE.md` section 4 explicitly permits it; blocking it would pre-empt a decision
  that belongs to the execution micro-phase. The distinction the rules do enforce is the one
  the architecture states plainly: the command layer proposes and validates, and does not
  persist. Verified with probe files that triggered nine violations across both rules, then
  deleted. Proven independently of the lint rules by running the suite with
  `better-sqlite3` removed from `node_modules`.
- **Origin:** Micro-phase 1.3.

## ADR-033 — The execution boundary: the domain decides, repositories store, the executor sequences

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** Micro-phases 1.2 and 1.3 produced pure domain operations and validated commands,
  but nothing connected them, so a validated command went nowhere. Three candidate shapes
  were possible: put SQL inside the domain operations, put orchestration inside the
  repositories, or add a thin layer that sequences the other two.
- **Decision:** A third option. `src/commands/executor.ts` sequences, `src/lib/db/repositories.ts`
  stores, and `src/domain` decides. For every command the executor resolves names to rows,
  calls the domain operation, and persists the result the domain returned.
- **Consequences:**
  - **The domain runs before any write.** Nothing is written until the domain has decided the
    outcome, so a refusal such as "only 3 onions" cannot leave a transaction open and the
    executor never has to undo a change the domain declined to make.
  - **The executor calculates nothing.** Every balance and remaining quantity in its output
    arrived from `src/domain`. This is the PRD's rule that the model interprets and proposes
    while deterministic code decides, expressed as a dependency rather than a convention.
  - **Three error vocabularies stay separate**: `validation` (the producer is broken),
    `domain` (the request is a real-world impossibility, carrying its own code such as
    `unknown_item` or `insufficient_inventory`), and `persistence` (the request was valid and
    storage failed — the one case where retrying makes sense). Collapsing them would make
    "the model sent nonsense", "you only have 3 onions", and "the disk is full" look alike.
  - **Identity and time are obtained, never supplied.** A command carries no id and no
    timestamp, so the executor reads both from the row it loaded and from the execution clock.
  - The executor accepts `unknown` rather than `Command`, re-validating at its entry. The
    types already forbid a bad command, but the real caller holds a parsed model response,
    and a runtime check means skipping validation is a failure rather than something a later
    refactor can quietly introduce.
- **Origin:** Micro-phase 1.4.

## ADR-034 — The execution clock is injected, not read

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** Every command needs a real timestamp for the event or expense row it stores,
  and the command is forbidden from supplying one. The obvious implementation reads
  `Date.now()` in the executor — but `hari-os/command-boundary` bans that, for the same
  reason `hari-os/domain-purity` bans it in the domain: an ambient clock makes a result depend
  on when it ran rather than on its input.
- **Decision:** The executor takes a `now: () => string` alongside its repositories. Whatever
  composes the executor supplies the real clock.
- **Consequences:** The executor stays deterministic and testable, and the boundary rule needs
  no exception. The test is stronger for it: a clock the test controls can assert that two
  executions of the same command store *different* real timestamps, which proves the value
  comes from execution time rather than from the command — something an assertion about
  `Date.now()` could only approximate. The cost is that 1.4 contains no code reading the real
  clock; the composition root that supplies it arrives with the first route in a later
  micro-phase, and until then no production path exists to execute a command.
- **Origin:** Micro-phase 1.4.

## ADR-035 — Repositories are enumerated, delegate name matching, and delegate storage

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** The four commands need six repository methods and a transaction. The
  alternatives were a generic repository base class, a unit-of-work abstraction, or naming
  rules mirroring table names. All three would have been more machinery than four commands
  require.
- **Decision:** One concrete module exporting `createRepositories(database)`, returning exactly
  the reads and writes those four commands need plus `transaction`. A read returns the
  domain's `Result`, because "no such item" is a domain concept; a write returns
  `PersistenceResult`, because a write has no domain failure to report.
- **Consequences:**
  - **Name matching is not duplicated.** `findByName` loads candidates and delegates to the
    domain's own `findInventoryItem` and `findAccount` rather than reimplementing comparison
    in SQL. A kitchen inventory is tens of rows, and one matching rule is better than two
    that can drift. This is where a real bug was caught: an early version labelled each row
    with the *requested* name, so a request for an account that did not exist resolved to a
    real one and spent from the wrong balance. The test that found it is now a regression
    assertion.
  - **The `hari-os/command-boundary` rule was amended, not weakened.** `@/lib/db/repositories`
    became reachable from the command layer because 1.4 approves the executor coordinating
    repositories. `connection`, `migrations`, `schema`, and `better-sqlite3` stay forbidden,
    so the executor cannot open a database or write a query of its own. ESLint matches the
    first pattern and does not support gitignore-style negation, so the allowed module is
    enumerated rather than wildcarded — a new non-repository module in `src/lib/db` must be
    added to the list, which is a visible review point.
  - Domain purity is untouched: `domain` still imports nothing, and no rule was relaxed for
    it.
- **Origin:** Micro-phase 1.4.

## ADR-036 — One route handler is the only entry point for commands

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** The executor built in 1.4 was deliberately unwired, so no user path could run
  a command. A Next.js application can expose a server action, a route handler, or both. Two
  entry points would mean two places where validation could be bypassed, two places to
  update when the contract changes, and two places for a bug to hide.
- **Decision:** A single route handler, `POST /api/commands`, is the only way a command enters
  the application. No server action exists. `GET` on the same path answers `405` with an
  `Allow: POST` header, because the surface accepts writes only.
- **Consequences:**
  - The path is `UI → route handler → validation → executor → domain → repositories →
    SQLite`, and there is no alternative route to the data.
  - The endpoint is a real HTTP interface, so the whole slice is testable with `curl` against
    a disposable database. That is how the acceptance flow was verified.
  - Two request shapes are accepted. A JSON body is passed to the executor **untouched**, so
    the API surface is exactly the validated contract. A form body is translated by
    `formToCommand` because a person types `50`, not `5000`.
  - `amount` means two different things in this contract — money in minor units on
    `expense.record`, a quantity of stock on `inventory.consume` and `inventory.restock` —
    so the money conversion is chosen by command kind, never by field name. Getting this
    wrong would have multiplied "2 onions" by 100. A regression test asserts it.
  - This adds one server module that was not anticipated by the architecture, but it sits in
    `src/app/`, where routing concerns belong, and it holds no business logic.
- **Origin:** Micro-phase 1.5.

## ADR-037 — The command form posts without client-side JavaScript

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** The command form was first written as a Client Component using
  `useActionState`, to report the outcome in place. Doing so silently destroyed the
  progressive enhancement it was supposed to improve: React replaces a form's `action`
  attribute with a stub when it owns submission, so the rendered markup contained
  `action="javascript:throw new Error('React form unexpectedly submitted.')"` and the form
  only worked with scripts enabled. The no-JavaScript path did not exist at all.
- **Decision:** `CommandForm` is a Server Component containing a plain
  `<form method="post" action="/api/commands">`. There is no client JavaScript in it.
  The endpoint answers `303 See Other` back to the originating page with the outcome in the
  query string, and `OutcomeBanner` renders it server-side.
- **Consequences:**
  - The form works identically with and without JavaScript, because there is only one path.
    A JavaScript-enabled browser performs a slightly slower full page load.
  - The cost is a page reload per command, which is acceptable for a single-user localhost
    application and is also how the user sees the new quantity, since that data lives in
    Server Components.
  - No hydration boundary exists for the form, so there is less client JavaScript to ship
    and no client/server state to keep in step.
  - The outcome is carried as short tokens (`saved=ok`, `err=insufficient_inventory`,
    `field=amount`) rather than as prose. A token is a fixed word chosen by the server, so
    reflecting an outcome into a URL cannot reflect anything a user typed. `describeOutcome`
    expands the token to a sentence, and an unrecognised token renders as a neutral failure
    rather than as its own text.
- **Origin:** Micro-phase 1.5.

## ADR-038 — Opening the database applies migrations; seeding stays explicit

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** The database file and its directory were created on first access, but the schema
  was not. Every page therefore failed with `no such table: inventory_item` on a new
  database, which returns HTTP 500 and violates the PRD's requirement that empty states must
  not crash.
- **Decision:** `getDb()` runs `migrate()` after opening. Migrations are idempotent and run on
  every open. **Row seeding does not** — see ADR-039.
- **Consequences:**
  - Creating tables describes the shape the code expects and depends on nothing the user did,
    so it is safe to do automatically. Creating rows depends on decisions only the user can
    make, so it is not.
  - Opening a database can never be the act of inventing user state. The two operations are
    separated precisely so that this stays true.
  - A fresh database now renders three empty states instead of erroring.
  - `migrate` is imported with a relative path so the test scripts, which run under plain
    Node rather than the bundler, can resolve it. This follows the convention already used in
    `repositories.ts`, where `@/` is for types and relative `.ts` paths are for runtime
    imports.
- **Origin:** Micro-phase 1.5.

## ADR-039 — First-run setup is an explicit script, never automatic seeding

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:** `expense.record` resolves an account name to an account row and
  `inventory.consume` resolves an item name to a tracked item. On an empty database neither
  exists, so every command fails with `missing_account` or `unknown_item` and the application
  looks broken rather than merely unconfigured.
- **Decision:** `npm run db:setup` creates the three PRD accounts and three example stock
  items. It is idempotent, and nothing in `src/` creates rows.
- **Consequences:**
  - Rejected: inserting defaults on first page render. It would write user state as a side
    effect of reading a screen, make database contents depend on which page was opened, and
    fabricate financial balances.
  - **Opening balances are zero.** The project does not know the user's money, and inventing a
    figure would be precisely the kind of plausible fabrication the PRD forbids. There is no
    command for setting an opening balance in this phase, so an account reads `₹0.00` until
    one is spent from.
  - The example stock quantities are real rows and are expected to be corrected or deleted.
  - Running the script after real use has begun will not reset a balance or a quantity,
    because every insert is skipped when the row already exists.
- **Origin:** Micro-phase 1.5.

## ADR-040 — The parser is a port, and the model is an interpreter rather than an authority

- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** Phase 2 introduces a language model that reads a sentence and proposes what the
  user meant. `AGENTS.md` section 7 and PRD principles 11 and 12 require that the model never
  perform arithmetic affecting balances or quantities, and that deterministic code own all
  mutation. Those rules are only worth something if they are structural rather than advisory.
- **Decision:** `src/commands/parser.ts` defines a `NaturalLanguageParser` port whose `parse`
  returns `unknown` on success. Nothing above the port knows a provider exists, and
  `src/features/chat/openrouter.ts` is one implementation behind it. Three guarantees are
  enforced by construction:
  1. **No arithmetic.** A proposal reports `amountRupees`, the number the user said. Conversion
     to whole minor units is `toMinorUnits` in `src/domain`. A model answering `5000` produces
     a field the contract does not accept, and validation refuses the command.
  2. **No identity, time, or outcomes.** `candidateToCommand` copies a fixed allowlist of
     fields and nothing else, so `id`, `timestamp`, `balance`, `after`, `confidence`, and `sql`
     in a response are never read. A model cannot smuggle a value in by inventing a field,
     because no invented field is ever read.
  3. **No authority over execution.** The parser calls neither the executor, the domain, nor
     the database. It emits an unvalidated candidate, which is exactly what the existing
     `parseCommand` gate is designed to receive.
- **Consequences:**
  - A proposal carrying a forged `balance` alongside legitimate facts still executes. That is
    correct: the extras are neutralised by the allowlist rather than by a veto, so a model
    cannot make a valid command unexecutable by adding noise to it. The result is asserted in
    `scripts/chat-test.mjs` section 31.
  - Rejected: a repair step that re-prompts or coerces malformed output. It would be a second,
    weaker implementation of the interpretation logic the trust model depends on not existing.
  - Rejected: sanitising by prompt instruction. Instruction is not enforcement; the allowlist is.
  - The provider returns content that is not JSON as a raw string rather than failing, because
    the transport did its job and whether the content is executable is `interpret`'s question.
    Duplicating that decision would create two places that must agree what a proposal is.
- **Origin:** Phase 2.

## ADR-041 — A second entry point widens the input, never the execution path

- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** Phase 1 has exactly one command entry point, `POST /api/commands` (ADR-036),
  which receives an already-shaped command. Phase 2 needs to receive a sentence instead.
  Replacing the structured endpoint would put a language model in front of the one path the
  whole application trusts.
- **Decision:** Add `POST /api/commands/parse` as a *second* endpoint. It receives a sentence,
  parses it, and then converges on the same executor through the same engine the rest of the
  application uses. `POST /api/commands` is untouched and remains available. There is one
  execution path and two ways of reaching it.
- **Consequences:**
  - The structured forms on `/kitchen` and `/expenses` keep working with no provider configured,
    which is what makes the missing-key state a degraded mode rather than a broken application.
  - Results travel back as query parameters for form callers: an **enum and closed-set tokens
    only**, plus the user's own sentence echoed as `said`. Model prose is never reflected into a
    URL or a page, so a model cannot place arbitrary content in the interface.
  - A caller that sends `Accept: application/json` receives the structured result instead, and
    the route answers that case too.
  - An unreadable request body is `400`, not an empty sentence. Treating a broken client as
    "the user typed nothing" reports success for a request that was never understood.
- **Origin:** Phase 2.

## ADR-042 — Command submission is guarded by an origin check, because V1 has no session

- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** `POST /api/commands/parse` is a write: a parsed sentence is executed. ADR-002
  puts authentication out of scope for V1, so there is no cookie or session to protect the
  write. That leaves any page the user happens to have open able to post a form to
  `localhost` and cause a command to run. This was found by direct HTTP acceptance testing,
  after the route had already been committed to a passing test suite that never posted to it.
- **Decision:** Reject a submission whose `Origin` names another site, with `403`, before the
  sentence is read and before any provider call. A request with no `Origin` is allowed, because
  non-browser clients do not send one and refusing them would break `curl` and the tests.
  `safeReturnPath` continues to restrict the `next` parameter to same-site paths.
- **Consequences:**
  - The check accepts `Origin` against **both** the reconstructed request URL and the `Host`
    header. `next start` derives its own canonical hostname from configuration, so a request
    that genuinely arrived at `http://127.0.0.1:3111` is seen server-side as
    `http://localhost:3111`. Comparing against the URL alone refuses the application's own
    users, which is worse than having no guard. `http://` and `https://` are both tried because
    a TLS-terminating proxy would present one scheme while the internal URL carries the other.
  - The guard is a CSRF defence, not an authorisation system. It does not stop a local process,
    and it is not a substitute for authentication if V1 ever becomes multi-user.
  - The route now has direct handler tests. It previously had none, which is why the gap was
    invisible to `npm test`.
- **Origin:** Phase 2, found during verification.

## ADR-043 — Kitchen setup operations get a third endpoint, and it cannot execute a command

- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** ADR-036 states that `POST /api/commands` is the only way a command enters the
  application, and ADR-041 added a second endpoint without replacing it. Phase 3 needs
  operations that ADR-036's contract cannot express: starting to track an item, renaming it,
  changing its low-stock threshold, and correcting a logged entry. The command contract carries
  a *movement* — an item, an amount, a unit — and none of these is one. `npm run db:setup` was
  the previous answer, and it is a CLI script: a user who forgot the stock could not add an item
  from the page, and a threshold could not be set at all.
- **Decision:** Add `POST /api/kitchen` for the four operations that move no stock. Its
  operation set is a closed enum, exactly as the command kinds are, and an unrecognised value
  is refused rather than ignored. It reuses ADR-042's origin check through the shared
  `features/shared/same-origin.ts` module so the two write routes cannot drift. A **correction**
  is a form target here and nothing more: it is built by the domain's `reverseInventoryEvent`,
  turned into an ordinary `inventory.consume` or `inventory.restock`, and executed through
  `runCommand`. This endpoint cannot execute a command of its own.
- **Consequences:**
  - **ADR-036 is narrowed, not overridden.** There is still exactly one path to the executor,
    and this route does not create a second one. What changed is that reaching a *maintenance*
    operation is no longer the same thing as executing a *command*. That distinction is real
    and was previously unstated; ADR-036's wording is left in place as history, and this ADR
    records the exception rather than quietly rewriting the earlier one.
  - A rename or a threshold writes **no event**, because neither moves stock. They are not
    movements, and pretending otherwise would put meaningless rows in a log meant to explain
    why a number is what it is. A correction, which does move stock, writes a real event.
  - Form fields are read strictly here rather than forwarded to `parseCommand`. A blank
    quantity box is the dangerous case: `Number("")` is `0`, so a loose read would silently
    record "0 onions". The domain takes a `Quantity`, so there is nothing downstream that could
    safely receive an unparsed string; the refusal has to happen where it can still name the
    field.
  - Items are addressed by **id, not name**, in every operation. A name is editable, so a form
    left open across a rename would otherwise act on whatever item now carries that name.
  - Failures return a closed-set token, never the domain's sentence. The domain's message
    quotes the item name the user typed, and a redirect carries its query string into history,
    a referrer, and a screenshot. `OutcomeBanner` expands the token to the same wording the
    rest of the application already uses, so nothing user-typed reaches a URL.
- **Origin:** Phase 3.

## ADR-044 — A correction is a reversal, never a deletion or an overwrite

- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** PRD principle 13 requires every mutation to be traceable and correctable. A
  wrong stock entry is inevitable — the user miscounts, or a sentence is misread — so the
  correction path is a product requirement, not an edge case. Three implementations are
  possible: delete the event, overwrite the stored quantity, or apply the opposite movement.
- **Decision:** A correction applies the **inverse of the original delta as a new event**. The
  original row is never deleted, the stored quantity is never written directly, and there is no
  undo table and no soft-delete column. The correction's `source_text` is the application-written
  label `correction of entry #N`, which marks it in the log.
- **Consequences:**
  - **The inverse is computed from the current quantity, not from the state the original entry
    left behind.** This is the decision that matters. Movements applied since the original entry
    are unaffected; reversing against a stale snapshot would silently discard everything that
    happened in between. Verified: after `+10, −2, −5, +5, −5`, correcting the `−5` returns the
    item to 8, and the sum of all six deltas still equals the stored quantity.
  - The log stays readable as history rather than as a patched number. A user sees what was
    believed, and later that it was corrected, and can see why the current figure is what it
    is. Deleting the original would destroy the only evidence that a mistake occurred.
  - `source_text` is display-only and is never read to decide what a command means, so using it
    as a label cannot influence execution.
  - Correcting an entry that is no longer reversible — a `−5` against a current quantity of 2 —
    is **refused** rather than approximated. The domain decides, and the refusal is the honest
    answer, because the alternative is a quantity that does not match its own log.
  - A correction is a normal movement in every other respect: same validation, same executor,
    same transaction, same event table. Nothing about it is special except that its source text
    says so.
- **Origin:** Phase 3.

## ADR-045 — The command endpoint gets the origin check ADR-042 intended

- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** ADR-042 added an origin check so that a page on another site could not submit a
  command to this application. Phase 3 reused the guard for `POST /api/kitchen`. What was missed,
  and found in Phase 4, is that `POST /api/commands` — the endpoint ADR-036 named as the *only*
  way a command enters the application — never received it. `features/shared/same-origin.ts` was
  imported by exactly two routes: the parse route and the Kitchen route.
- **Decision:** `POST /api/commands` applies the same shared guard, returning `403` for a
  cross-origin request before any body is read.
- **Consequences:**
  - Before this, any page the user happened to have open could `POST` an `expense.record` to
    `localhost` and record a spend against a real account. V1 has no session and no cookie, so
    nothing about the request identifies it as the user's own. The response was a redirect the
    victim's browser would follow, so the failure was silent as well as unauthorised.
  - **Phase 4 made this materially worse, which is why it was found here.** Before this phase
    `/api/commands` could spend ₹10 at a time and the Kitchen page was a demo. From Phase 4 it
    is the endpoint that moves the user's money. A guard whose absence nobody noticed for three
    phases is not a guard to rely on now.
  - The check runs before `readBody`, so a cross-origin request never reaches the validator, the
    domain, or the database. It is refused at the cheapest point in the pipeline.
  - A missing `Origin` is still allowed. ADR-042 rejected rejecting it, because `curl` and
    server-side callers legitimately send none, and the risk of that being a *security* control
    outweights the convenience. V1 binds to localhost only.
  - All three write routes now share one implementation, so a fourth cannot forget it, and
    `scripts/expenses-test.mjs` asserts `403` on both `/api/commands` and `/api/kitchen` with a
    foreign `Origin`.
- **Origin:** Phase 4, found by testing the CSRF behaviour of the endpoint that spends money.

## ADR-046 — The architecture rules were being reported without being enforced

- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** `AGENTS.md` states that the layer boundaries are "enforced, not merely
  documented", that `src/domain` and `src/components` may not import `@/lib/db`, and that a
  violation fails `npm run lint`. Phase 4's architecture audit probed each of those claims by
  writing a temporary file that imports the forbidden module and running ESLint on it.
- **They did not fire.** `src/domain/accounts.ts` could import `@/lib/db`, `better-sqlite3`, or
  `node:fs` and lint passed. So could `src/lib/validation`, `src/commands`, and `src/components`.
- **The cause is how ESLint flat config resolves overlapping rules.** `no-restricted-imports` is
  a single rule. When two config objects set it for the same files, the **later object replaces
  the earlier one wholesale** — including the patterns it never meant to override. This file had
  four overlapping configurations:

  | Scope | Configs covering it | Winner | What actually fired |
  | --- | --- | --- | --- |
  | `src/domain` | boundaries, domain-purity, provider-boundary | provider-boundary | provider only |
  | `src/lib/validation` | validation-purity, provider-boundary | provider-boundary | provider only |
  | `src/commands` | command-boundary, provider-boundary | provider-boundary | provider only |
  | `src/components` | boundaries, chat-boundary | chat-boundary | provider only |
  | `src/features/chat` | provider-purity | provider-purity | **all of it** |

  So `src/features/chat` was the only scope whose rules were fully in effect, and it was the only
  scope with a single config. `no-restricted-properties` was unaffected — it is a differently
  named rule — which is why `Date.now()` in the domain *was* correctly caught while
  `better-sqlite3` in the same file was not.
- **Decision:** Append one consolidated config per scope at the **end** of the config array, each
  carrying the union of every pattern its scope was originally meant to enforce. The earlier
  configs stay, as the documented statement of intent and as the home of rules with other names,
  but nothing now depends on them winning.
- **Consequences:**
  - Nothing that was meant to be forbidden becomes permitted. Every group in the new configs
    already existed in this file; the fix only stops it being discarded.
  - **The codebase turned out to comply already.** `npm run lint` passed the moment the rules were
    armed, which is the answer worth having: the architecture was being upheld by discipline
    rather than by tooling. That is a real risk that has now been removed, and it also means this
    fix introduced no errors and needed no source changes.
  - The failure was invisible because **every test in the project happened to obey the boundary
    that was not being enforced.** Compliance and enforcement are indistinguishable until
    something tries to break a rule, and nothing did.
  - `scripts/architecture-probe.mjs` (`npm run architecture:probe`) now asserts each rule fires,
    and also asserts the imports the architecture *permits* still pass — a rule that rejected
    everything would otherwise satisfy this file. It runs in the verification set so a future
    config added above these cannot quietly disarm them again.
  - The general lesson is recorded rather than the fix: **in flat config, several rules for one
    scope must be expressed as one rule, or the earlier ones are decorative.** `src/features/chat`
    had it right by accident, and the scopes with two or more configs were the broken ones.
- **Origin:** Phase 4, found by probing every architecture claim rather than trusting it.

---

## ADR-047 — The Dashboard is a read model over the owning features, and it says what is missing

**Date:** 2026-10-01 · **Status:** Accepted · **Phase:** 5

**Context.** The PRD's Dashboard is six cards: today's top 3 tasks, a suggested first action,
low stock, laundry/dishes, today's spend, and an "I feel like scrolling" entry to Skills. Two of
the five modules those depend on exist (Kitchen, Expenses). Routine, Sleep, Skills, Habits, and
Photo Diary do not. The Dashboard page already showed a low-stock count and a spend figure, both
read through `readDashboardSummary` in `src/features/shared/queries.ts`, and the summary's task
list had never been fed by anything.

That leaves two ways to finish the phase. Either fill the screen — add a task list, a habit
tracker, a skills catalogue — or complete the screen from state that exists and mark the rest
unavailable. The first option is five more phases, and each would be built to satisfy a card
rather than to be a feature.

**Alternatives considered.**

- **Build the missing modules to fill the cards.** Rejected: it is Routine, Skills, and Habits
  built as decoration, and it would put half-built features in front of the user.
- **Keep `readDashboardSummary` in `shared/` and extend it.** Rejected: `shared/` is where the
  Kitchen page's inventory view lives, and a Dashboard that composes three features is not a
  shared helper. It would also leave two definitions of "what the dashboard shows" — one in
  `shared/`, one in `features/dashboard/` — able to disagree.
- **Use the SQL aggregate `display.spendForDate` for the dashboard figure.** Rejected: it is a
  second implementation of the day's total. Phase 4's architecture notes name this exact risk,
  and the consequence would be a Dashboard that can say a different number from the bill.
- **Add a repository read per card.** Rejected for low stock and spend, where the owning feature
  already has a read side that applies the real rule. Accepted for `plan_task` and `habit_log`,
  which have no owning feature yet and whose rows would otherwise be fetched by ad-hoc SQL.
- **Invent a suggestion.** Rejected outright. The PRD's principle is that the assistant
  organises and the user decides; a ranked or generated "first action" is the failure, not the
  feature.

**Decision.**

- The Dashboard read model lives in `src/features/dashboard/view.ts` and is the only thing the
  page reads. It composes the Kitchen and Expenses read sides and two focused repository reads.
  It contains no comparison, no sum, and no clock.
- **Low stock** is the domain's `isLowStock` applied to persisted rows. Threshold equality is
  low, as it has always been.
- **Today's spend** is `summariseDay` over the day's rows — the same function that produces the
  daily bill, so the two cannot disagree.
- **Tasks** are real `plan_task` rows, capped at three for display with the true count kept.
  **The suggested first action is the first not-done task**, or nothing. No ranking, no
  generation, no model.
- **Skills** are a build constant, `false`, and the page renders an unavailable state. No route
  was created for a module that does not exist.
- **Dishes and laundry** are read from `habit_log`. A missing row renders as **not recorded**,
  not as "not done": only the second is a claim about the user's day, and nothing in `src/`
  writes a habit row, so the distinction is currently the whole content of that card.
- Two new enforced boundary scopes, probed like the rest: `src/features/dashboard/**` (no
  storage, no driver, no filesystem, no provider, no executor, no feature write side) and
  `src/app/**` (no storage, no driver, no filesystem, no provider config — `next/server`
  exempt, because it is a framework and not storage).

**Consequences.**

- The Dashboard can be completed and verified without starting Phase 6, and the next phase
  starts from a real screen rather than a blank one.
- "Not available yet" is a supported product state, stated in the product rather than only in
  this file. Three cards say it today: tasks, skills, habits.
- The read model has no second source of truth for anything, so the only way for the Dashboard
  to be wrong is for the owning feature to be wrong.
- `scripts/dashboard-accept.mjs` and `scripts/responsive-check.mjs` are new verification
  scripts rather than new production code. The first exists because a Server Component cannot
  be rendered outside Next.js, so page claims have to be checked over HTTP; the second because
  "the stylesheet uses `auto-fit`" is not a responsive check.

**Origin:** Phase 5, from the finding that the Dashboard's missing parts are five later phases,
not one screen.

---

## ADR-048 — A low-stock threshold of zero is allowed, and the documentation was wrong

**Date:** 2026-10-01 · **Status:** Accepted · **Phase:** 6

**Context.** Phase 5 found a live mismatch and recorded it rather than fixing it, because
choosing between the two sides would change Kitchen behaviour and that was not Phase 5's call.
`ARCHITECTURE.md` section 15 stated: "A threshold of zero is refused. It would flag every item
forever, which is a bug that looks like a feature." The code does not refuse it.
`setLowStockThreshold` accepts zero, and `isLowStock` compares `quantity <= threshold`, so a
threshold of zero flags an item only while its quantity is zero. `scripts/dashboard-test.mjs`
and `scripts/domain-test.mjs` both assert that behaviour, because that is what exists.

Phase 6 was asked to resolve it. The PRD, which is the authority on product behaviour, says only
this: "Low-stock threshold per item; items at or below it appear as flags on the Dashboard (in-app
only in V1)." It does not mention zero, and it does not forbid it. The schema stores
`low_threshold REAL` with no constraint, so there is no storage-level answer either.

**Alternatives considered.**

- **Refuse zero, and change the code.** Rejected. It removes a capability the user can
  reasonably want — "tell me when I am out" — and the only way to express it afterwards would be
  to leave the field empty, which *disables* the flag. A refusal here makes the request
  unreachable rather than approximate. The stated reason for refusing it is also false: under
  `quantity <= threshold`, a zero threshold flags zero-quantity items, not every item. A rule
  defended by a bug the code does not have is not a rule worth enforcing.
- **Leave both as they are and keep the discrepancy open.** Rejected. Phase 5's reason for not
  resolving it was scope, not uncertainty; the uncertainty was settled by the PRD and the
  comparison. Leaving a documented rule that the code contradicts is how a later reader stops
  trusting the document.
- **Normalise zero to `NULL` silently.** Rejected outright: the user asked for something, the
  application would store something else, and the stored value would not be what they said.
  `NULL` is a distinct, explicit "no alert", and the two must stay distinguishable.

**Decision.** A threshold of zero is a threshold. No threshold is `NULL`, and `NULL` is the only
value that turns the flag off. No code changes; the documentation was corrected, and the note
recording the discrepancy was replaced with a dated record of the resolution.

**Consequences.**

- The Kitchen, the Dashboard, and the documentation now say the same thing about zero.
- `quantity <= threshold` remains the only place the comparison exists, and it is unchanged.
- The general lesson is recorded in `AGENTS.md` §2 and was followed here: the mismatch was
  investigated, the authority was consulted, and the *documentation* was changed — explicitly,
  with a dated note and a test that already asserted the surviving behaviour, rather than
  silently.

**Origin:** Phase 6, from the discrepancy Phase 5 recorded and was told to resolve.

---

## ADR-049 — The night check-in is an operation, not a command

**Date:** 2026-10-01 · **Status:** Accepted · **Phase:** 6

**Context.** The PRD's night check-in is one deliberate act with two halves: write tomorrow's
three tasks, and confirm the phone is charging outside the bedroom. ADR-021 established that a
command is "one statement the user made, about one fact, containing no ids and no timestamps",
validated by `parseCommand`, executed by the executor, and the only shape the natural-language
parser may emit.

The check-in is a transaction over four rows — clear tomorrow's undone tasks, insert up to three,
ensure the night exists, record the phone answer — and it is useless if half of it lands.

**Alternatives considered.**

- **A `night.check_in` command carrying a list of titles and a boolean.** Rejected. It would be
  the first multi-fact command in the system, and it would drag four new problems behind it: a
  list field in the contract, list validation with a length rule and a per-item title rule,
  another executor branch with its own transaction, and parser support for a shape no single
  sentence produces. All of that to say something three `task.create` commands already say.
- **Three separate command posts from the form.** Rejected for the reason that decided it: three
  HTTP requests can half-succeed. A plan where two of three tasks were written and the third was
  not is worse than no plan, because the screen would show it as the user's decision.
- **Make the check-in a command and drop the form.** Rejected: the PRD's ritual is a deliberate
  end-of-day act, and typing three tasks into a sentence box is not it.

**Decision.** `runNightCheckIn` in `src/features/routine/write.ts` is an **operation**, dispatched
from `POST /api/routine` with a closed enum of one operation, the same origin guard as the other
write routes (ADR-042/045), and the same token-based outcome as the Kitchen operations (ADR-043).
Every write runs inside one transaction: if any of them fails, nothing changes. The titles
themselves are validated by the same `createTask` the command path uses, and a title the chat
would refuse cannot be submitted through the form.

A task can still be planned one at a time from chat (`task.create`), and tomorrow's plan is
read by the Dashboard. This is the second door to the same operations, not a second
implementation of them.

**Consequences.**

- `/api/routine` exists and is deliberately small: one operation, no GET, no commands. Adding a
  second operation means editing the enum, which is the point.
- The check-in's refusals are testable without HTTP, because the dispatch is a pure function of
  the submitted fields.
- A partial plan is not representable.

**Origin:** Phase 6, from the tension between a four-row ritual and a one-fact command contract.

---

## ADR-050 — `plan_task` has one reader: the Routine feature, not the Dashboard

**Date:** 2026-10-01 · **Status:** Accepted · **Phase:** 6

**Context.** ADR-047 added `display.tasksForDate` to the display repository, and justified it
explicitly: an ad-hoc repository read was accepted for `plan_task` and `habit_log` "which have no
owning feature yet". The Dashboard then applied the PRD's top-three cap itself with
`tasks.slice(0, TOP_TASK_LIMIT)`.

Phase 6 gives `plan_task` an owning feature. `src/features/routine/view.ts` now reads it through
`TaskRepository.listForDate` and selects the top three through the domain's `selectTopTasks`. If
the Dashboard had kept its own read, `plan_task` would have two readers whose only difference is
which one applies the cap — and ADR-047's own reasoning about "two ways to total a day" applies
exactly.

**Alternatives considered.**

- **Keep both reads.** Rejected: two definitions of "today's top three", able to disagree, for a
  table with one owner.
- **Keep `display.tasksForDate` but have the Dashboard call `selectTopTasks` on it.** Rejected: it
  fixes the cap and leaves the duplication, which is the part that had no owner.
- **Move the cap into the display repository.** Rejected: a display cap is a display rule, and the
  domain is where rules live.

**Decision.** The Dashboard composes `readRoutine`, exactly as it already composes the Kitchen and
Expenses read sides, and `display.tasksForDate` is deleted along with the prepared statement
behind it. `TOP_TASK_LIMIT` is re-exported from `src/domain/routine.ts` so existing importers keep
working and there is still one constant. `display.habitsForDate` stays: `habit_log` still has no
owning feature, and Habits is Phase 7.

**Consequences.**

- `plan_task` has one reader. The Dashboard cannot disagree with the Routine page about which
  three tasks the morning opens on, because it asks the same reader the same question.
- The Dashboard gained the sleep card, the consistency count, and the "tomorrow is planned" fact
  as a consequence of composing the Routine read model rather than reaching past it.
- `scripts/app-test.mjs` asserts the empty-day case through `tasks.listForDate` now, which is
  where the assertion belongs.

**Origin:** Phase 6, from ADR-047's stated precondition having come true.

## ADR-051 — A photo is stored as an application URL with its row id, and both parts are checked

**Date:** 2026-10-01 · **Status:** Accepted · **Phase:** 7

**Context.** PRD 6.6 requires a photo as the proof of laundry completion and leaves a Photo Diary
of pictures. `habit_log.photo_url` is the only column in the schema that can hold a picture, and it
exists already. Two things have to be decided: what goes in that column, and how a request turns
into bytes.

The obvious answers are wrong in both directions. Storing a filesystem path (`data/uploads/x.jpg`)
leaks the layout into the database and breaks the moment the directory moves. Storing only the
filename means the route has no way to know whether a filename it was given is one this table
actually names — which is the mistake of serving a data directory by guessing.

**Alternatives considered.**

- **Store the filename, and look the file up by it.** Rejected: nothing ties a filename in a URL to
  a row, so any guess reads any file in the upload directory.
- **Add a `photo` table.** Rejected: it is a schema change for an entity no phase document was
  given, and `habit_log.photo_url` already exists for exactly this. Adding a table would also make
  the photo a separate thing from the day it proves, which is the opposite of what laundry proof
  is.
- **Serve uploads from `public/`.** Rejected: `public/` is served with no authorisation and would
  put the user's laundry photos at a guessable path. `AGENTS.md` already forbids it.

**Decision.** `habit_log.photo_url` stores `/api/photos/<id>/<filename>`, where `id` is the row
and `filename` is server-generated. `POST /api/photos` writes the file, inserts the row, and then
sets the URL — three statements in one transaction, because the id does not exist until the insert
has run and the pair must be atomic. `GET /api/photos/<id>/<filename>` reads the file only when
the row exists, has a photo, and its stored URL equals the request exactly. A mismatch is a 404,
not a guess.

Uploads name what they prove and only `laundry` is accepted, because `habit_log.photo_url` is the
only column that can hold a picture. An upload of any other type is refused before anything is
written. The consequence is stated rather than hidden: **the V1 Photo Diary is the timeline of
laundry photos.**

**Consequences.**

- No stored value contains a local path, and moving `data/uploads/` breaks no row.
- No guessed filename reads a file, and the check is one string comparison.
- A photo diary of something other than laundry is not buildable until a phase gives it a column or
  a table. That is a visible limitation rather than a hidden one.
- `src/lib/storage/photos.ts` owns the byte checks: magic bytes decide the type, the extension is
  derived from them, SVG is refused outright, the size is bounded before the write, and the name is
  a fresh UUID. Nothing from the client reaches the path.

**Origin:** Phase 7, from the PRD's laundry-proof requirement.

## ADR-052 — The private log has one reader and can produce no number

**Date:** 2026-10-01 · **Status:** Accepted · **Phase:** 7

**Context.** PRD 6.6: "Private log (yes/no plus optional note) for doom-scrolling incidents and
masturbation. Never shown as a streak, score, or progress bar." The stated reason is to avoid a
shame spiral, so this is a requirement about the user's wellbeing rather than a display preference.

A prohibition phrased as "never shown as" is easy to satisfy and easy to erode. A count is a
streak without a calendar; a "this week" figure is a score; a list that grows every time something
did *not* happen is a count by another route. Each of those is a small, innocent-looking change,
and each violates the PRD.

**Alternatives considered.**

- **Implement it, and rely on review.** Rejected: the rule is about the user's wellbeing, and it
  would rest on every future reader remembering it.
- **Store it and simply not display it.** Rejected: not displaying is not the requirement. A count
  in a repository method is one refactor away from a count on a page.
- **Keep a display query for `private_log` alongside the others.** Rejected: a second door to the
  table is what the rule is protecting against.

**Decision.** Three structural choices, each enforced by a probe or a test rather than by a comment:

- `src/features/habits/private-log.ts` is the only module in `src/` that reads `private_log`. It is
  not imported by `src/features/habits/view.ts`, so the Dashboard — which composes that module —
  cannot reach a private entry even by accident.
- The read model exposes no count, total, streak, frequency, or percentage. There is no function in
  it that takes entries and returns a number.
- The command contract's `private.log` has no field a count could arrive in, and `readCommand`
  rejects unknown fields, so a model that proposes one is refused by name.

A "no" answer deletes the day's entry rather than storing a row that records an absence. That is the
only way the table can shrink, and it is why `PrivateLogRepository.removeForDay` exists.

**Consequences.**

- The Dashboard cannot show a private entry, and `skills-test.mjs` asserts that neither the entry
  nor the behaviour's name appears in its model.
- The private section of `/habits` was asserted over rendered HTML for the absence of the words
  *streak*, *score*, *progress*, *percent*, *rank*, and of any percentage or `progressbar`.
- Recording an entry takes two commands today: a photo, then a sentence. Both are cheap, and
  neither pretends the other happened.

**Origin:** Phase 7, from the PRD's direct prohibition.

## ADR-053 — The laundry photo is required by a check, not by the sentence that claims it

**Date:** 2026-10-01 · **Status:** Accepted · **Phase:** 7

**Context.** The PRD says the application does not accept a text claim alone for laundry. A
sentence arrives through the parser and carries no file, so "did laundry" cannot satisfy the
requirement by itself. The question is where the photo requirement is checked, because the answer
determines whether a sentence can talk its way past it.

If the command carried a field like `hasPhotoProof`, a model could set it. If the page set it
because the user ticked a box, the requirement would be enforced by the same interface it is
supposed to constrain.

**Alternatives considered.**

- **Add a `photoId` field to the habit command.** Rejected: a model cannot know an id, so the field
  would be an unverifiable claim in exactly the place verification matters.
- **Let the photo route record the habit and remove the command entirely.** Rejected: chat is one of
  the two doors the PRD asks for, and a sentence that is permanently unable to complete laundry
  would be a sentence the application lies about.
- **Let the command trust the caller.** Rejected: that is a claim, not a check.

**Decision.** `recordHabit` takes `hasPhotoProof`, and the executor supplies it by asking the
repository whether the day's laundry row already carries a photo. Nothing else may set it. So
"did laundry" is refused with `photo_required` until a photo exists for that day, and accepted once
one does — the same sentence, and the same code path, with the difference being the stored row.

Replacing that day's row keeps the existing `photo_url`. Deleting it would orphan an uploaded file
and make a correction unrecoverable, which PRD principle 13 rules out.

**Consequences.**

- A sentence cannot complete laundry. The failure message names the requirement, so the refusal
  teaches rather than merely blocks.
- `POST /api/photos` is the completion path: it writes the file, records the day as done, and
  attaches the photo in one transaction, deleting the file if the row cannot be written.
- Both routes were exercised over HTTP in `skills-accept.mjs`: a refusal before an upload, and a
  success after one.

**Origin:** Phase 7, from the PRD's laundry-proof requirement.

## ADR-054 — The habit read model replaced the Dashboard's ad-hoc `habit_log` read

**Date:** 2026-10-01 · **Status:** Accepted · **Phase:** 7

**Context.** ADR-050 kept `display.habitsForDate` on the explicit condition that `habit_log` still
had no owning feature. Phase 7 gives it one. The Dashboard had been reading that table to render
two lines, and applying its own filter to decide which habits the PRD section 6.1 lists.

**Alternatives considered.**

- **Leave `display.habitsForDate` in place.** Rejected: ADR-050's condition for it has come true,
  and keeping it would mean two readers of `habit_log` able to disagree about what a day contains.
- **Move the Dashboard's filter into the habit read side.** Rejected: the read side would then carry
  a presentation decision that the Dashboard owns, and a second caller would inherit it.
- **Expose screen time on the Dashboard.** Rejected: PRD 6.1 lists laundry and dishes, and a
  measurement is not a habit. It would also put a number on the summary screen that the user must
  then feel something about.

**Decision.** `display.habitsForDate` is deleted. The Dashboard composes `readHabits`, which is the
single reader of `habit_log`, and applies its own two-habit projection in `view.ts` — a
presentation decision, kept in the presentation layer. Screen time is available on `/habits` and not
on the Dashboard.

**Consequences.**

- `habit_log` has one reader, and the Dashboard cannot disagree with `/habits` about a day.
- The Dashboard's habits lines come from the same read model that decides what "not recorded" means,
  so a day with no row reads identically on both pages.
- `SKILLS_AVAILABLE` is now `true`, and `dashboard-test.mjs` asserts the distinction that motivated
  keeping it a flag at all: the module is available on an empty database, and an empty list is a
  different state from an unavailable one.

**Origin:** Phase 7, from ADR-050's stated precondition having come true.

## ADR-055 — Two new ESLint scopes for the Skills and Habits slices

**Date:** 2026-10-01 · **Status:** Accepted · **Phase:** 7

**Context.** Phase 3 and Phase 4 each added an enforced scope for their feature slice
(`src/features/routine/**` and `src/features/dashboard/**`), because a boundary nobody probes is a
boundary nobody has. Phase 7 adds two slices with a difference between them that needed deciding.

`src/features/habits/**` writes files. `src/app` is forbidden from `src/lib/storage` by
`hari-os/application-boundaries-enforced`, which means a route handler cannot write a photo at all —
so something has to own it, and a feature is the only layer left. Meanwhile the same slice must not
be free to reach for `node:fs` beside the storage module, or "one place that touches the disk" stops
being true.

**Alternatives considered.**

- **Let `src/app` import `@/lib/storage`.** Rejected: it would undo a boundary that exists to keep
  the routing layer free of storage, and every future route would be a judgement call.
- **Put the photo write in the domain.** Rejected: the domain is pure, and this rule was found the
  hard way in ADR-025.
- **Enforce nothing for the new slices.** Rejected: the same gap ADR-046 was written about.

**Decision.** Two scopes, both appended to `enforcedBoundaries` so they win under ESLint's
last-config-wins behaviour (ADR-046). `src/features/skills/**` forbids the full persistence group,
exactly as the Routine scope does. `src/features/habits/**` forbids everything in that group *except*
`@/lib/storage`, with the difference stated in the config's comment.

`architecture-probe.mjs` gained 11 probes: each slice must refuse a driver, the disk, the executor,
and the provider; the Habits slice must still be allowed `@/lib/storage/photos` and
`command-runtime`; the Skills slice must still be allowed its own domain module.

**Consequences.**

- The routing layer still cannot touch the filesystem, and one feature slice owns every disk write.
- A rule that permitted "just this one import" is now visible in the config rather than implied by
  an exception nobody wrote down.
- 58 architecture probes pass, up from 47.

**Origin:** Phase 7, from ADR-046's requirement that every documented boundary be probed.
