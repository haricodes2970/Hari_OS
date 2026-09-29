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
