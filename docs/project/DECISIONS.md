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
