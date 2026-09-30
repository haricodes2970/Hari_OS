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
