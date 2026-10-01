import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const infrastructure = [
  "@/lib/db",
  "@/lib/db/*",
  "@/lib/storage",
  "@/lib/storage/*",
  "@/commands",
  "@/commands/*",
];

/**
 * Modules that make a file impossible to test with plain input and output.
 *
 * Includes `server-only`, which is infrastructure by another name, and `next/*`, which would
 * tie a business rule to the framework rendering it.
 */
const impureModules = [
  ...infrastructure,
  "server-only",
  "better-sqlite3",
  "node:fs",
  "node:fs/*",
  "node:os",
  "node:path",
  "node:child_process",
  "node:worker_threads",
  "node:net",
  "node:http",
  "node:https",
  "next/*",
];

/**
 * Modules the command layer may never reach for, because it must not do persistence itself.
 *
 * Micro-phase 1.4 approved the command executor to coordinate repositories, so
 * `@/lib/db/repositories` is permitted. Everything else in `src/lib/db` is listed here
 * explicitly, because ESLint matches the first pattern and does not support gitignore-style
 * negation: `connection`, `migrations`, and `schema` stay forbidden, so the executor cannot
 * open a database, run a migration, or inspect schema metadata. Combined with the ban on
 * `better-sqlite3`, the executor can only reach storage through repositories — it delegates
 * and receives results back, and never writes a query of its own.
 *
 * The list is enumerated rather than wildcarded on purpose. A wildcard would have had to be
 * negated to allow repositories, which ESLint does not support. The cost is that a new
 * non-repository module in `src/lib/db` must be added here, which is a small, explicit
 * review point rather than a silent hole.
 */
const persistenceModules = [
  "@/lib/db/connection",
  "@/lib/db/migrations",
  "@/lib/db/schema",
  "@/lib/storage",
  "@/lib/storage/*",
  "better-sqlite3",
  "node:fs",
  "node:fs/*",
  "node:os",
  "node:path",
  "node:child_process",
  "node:worker_threads",
  "node:net",
  "node:http",
  "node:https",
  "next/*",
];

/**
 * `persistenceModules` without the framework.
 *
 * `src/app` is the one scope that legitimately imports `next/server` — every route handler does.
 * What must not appear there is storage: no SQL driver, no `node:fs`, no direct handle. So the
 * framework entry is dropped and everything else kept, which is the difference between "no
 * database in the routing layer" and a rule that could not be turned on at all.
 */
const storageModules = persistenceModules.filter(
  (specifier) => specifier !== "next/*",
);

const boundaries = {
  name: "hari-os/boundaries",
  files: ["src/domain/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: infrastructure,
            message:
              "Domain and components must stay free of infrastructure. Move the rule to src/domain, or call it through a feature.",
          },
        ],
      },
    ],
  },
};

/**
 * Globals that make a result depend on when or where it ran, rather than on its input.
 *
 * Shared by every pure-boundary rule below, so the three directories cannot drift apart on
 * what "pure" means.
 */
const impureGlobals = [
  {
    object: "process",
    property: "env",
    message:
      "Must not read the environment. Receive configuration as an argument.",
  },
  {
    object: "Date",
    property: "now",
    message:
      "Must not read the clock. Pass a timestamp in, so results stay deterministic.",
  },
  {
    object: "Math",
    property: "random",
    message: "Must not generate random values. Pass an id in.",
  },
];

/**
 * Purity rules for `src/domain`, enforced rather than merely documented (ADR-025).
 *
 * A domain rule is only testable if it takes plain input and returns plain output. These
 * rules fail the build when that stops being true, which matters because the failure is
 * otherwise silent: a `Date.now()` in a calculation still passes typecheck, still passes
 * every test written against a fixed clock, and quietly makes the rule untestable.
 */
const domainPurity = {
  name: "hari-os/domain-purity",
  files: ["src/domain/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: impureModules,
            message:
              "Domain code must stay pure: no filesystem, network, process, or database access. Pass the value in instead.",
          },
        ],
      },
    ],
    "no-restricted-properties": ["error", ...impureGlobals],
  },
};

/**
 * Purity rules for `src/lib/validation` (ADR-032).
 *
 * Validation is the gate every untrusted input passes through, from a form, a route, or a
 * language model. If the validator could open a database it would stop being callable from a
 * test, a client component, or a form, and its verdict would depend on data rather than on
 * the input. It may import `src/domain`, because reusing the domain's own representation
 * predicates is what keeps the command boundary and the schema CHECK from drifting apart.
 */
const validationPurity = {
  name: "hari-os/validation-purity",
  files: ["src/lib/validation/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: impureModules,
            message:
              "Validation must stay pure and data-independent: no filesystem, network, process, or database access, and no framework imports. Check structure, not existence.",
          },
        ],
      },
    ],
    "no-restricted-properties": ["error", ...impureGlobals],
  },
};

/**
 * Boundary rules for `src/commands` (ADR-032).
 *
 * `ARCHITECTURE.md` section 4 allows `commands/` to use `src/domain` and
 * `src/lib/validation`, and requires it to hand a validated intent to a feature rather than
 * writing to the database itself. This rule enforces the second half of that sentence:
 * the command layer may propose and validate, and may not persist.
 *
 * `src/domain` is deliberately *not* blocked here, unlike in `hari-os/domain-purity`, because
 * the architecture explicitly permits it.
 *
 * `src/lib/db/repositories` is now permitted too, since micro-phase 1.4 established the
 * executor as the layer that coordinates repositories and domain operations. Everything else
 * under `@/lib/db` remains forbidden, as does `better-sqlite3`, so the executor delegates
 * storage rather than performing it. `server-only` is permitted as well: it is a marker that
 * can only prevent client-side use, never enable anything.
 */
const commandBoundary = {
  name: "hari-os/command-boundary",
  files: ["src/commands/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: persistenceModules,
            message:
              "The command layer proposes and validates; it does not persist. Hand the validated intent to a feature, which owns the database.",
          },
        ],
      },
    ],
    "no-restricted-properties": ["error", ...impureGlobals],
  },
};

/**
 * Provider boundary rules (ADR-041).
 *
 * Phase 2 put a language model in front of the Phase 1 foundation. The model is an untrusted
 * parser, and the only thing keeping it untrusted is that the surrounding layers are
 * structurally unable to depend on it. These rules make that structural rather than a matter
 * of care, and they are added alongside the existing rules, not in place of any of them.
 *
 * Two directions are forbidden:
 *
 * 1. **Nothing that computes or persists may reach the provider.** Domain, validation, the
 *    command layer, and the database must have zero knowledge of OpenRouter. A domain rule
 *    that could call a model is no longer pure, a validator whose verdict depended on a
 *    network call would be untestable, and an executor that could reach a provider would let
 *    a model's availability decide whether a write is possible.
 * 2. **The provider may not reach execution or storage.** The parser converts text to facts.
 *    If it could call a repository, run a domain mutation, or invoke the executor, then a
 *    model response would be one function call away from a committed transaction, and the
 *    allowlist in `src/commands/parser.ts` would be a suggestion.
 *
 * A component may not import the provider either, and the boundary that prevents a client
 * bundle from reaching an API key is `server-only` plus the fact that these modules are
 * `server-only` by construction. `providerBoundary` enforces the first two;
 * `components/chat-boundary` closes the third.
 */
const providerModules = [
  "@/features/chat/openrouter",
  "@/features/chat/config",
  "@/features/chat/runtime",
];

const providerBoundary = {
  name: "hari-os/provider-boundary",
  files: [
    "src/domain/**/*.{ts,tsx}",
    "src/lib/validation/**/*.{ts,tsx}",
    "src/lib/db/**/*.{ts,tsx}",
    "src/commands/**/*.{ts,tsx}",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: providerModules,
            message:
              "The language model is an untrusted parser behind a port. Domain, validation, storage, and the command layer must not know a provider exists. Reach it through src/commands/parser.ts.",
          },
        ],
      },
    ],
  },
};

/**
 * The parser may convert text into facts and nothing else.
 *
 * Applied to the whole chat provider area rather than to the two files it started with, and
 * with the two modules that legitimately need more excluded. An earlier version listed the
 * filenames explicitly, which looked correct and was not: a new module added beside the
 * provider was outside the rule and could import `better-sqlite3` freely. A probe now covers
 * this, because a boundary rule that only covers the files it already knows about is worse
 * than none — it reports a guarantee it is not providing.
 *
 * `engine.ts` is excluded because connecting a parsed candidate to the Phase 1 executor is
 * precisely its job. `presentation.ts` is excluded because it is pure and imports nothing
 * beyond the domain.
 */
const providerPurity = {
  name: "hari-os/provider-purity",
  files: ["src/features/chat/**/*.{ts,tsx}"],
  // Excluded with `ignores` rather than by negating inside `files`. A `files` array whose
  // positive patterns match nothing falls back to matching *everything*, so negating there
  // applied this rule across the whole repository — which is how it came to flag `node:fs` in
  // an unrelated nested worktree. `ignores` alongside `files` is the supported way to carve
  // exceptions out.
  ignores: ["src/features/chat/engine.ts", "src/features/chat/presentation.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: [
              ...persistenceModules,
              "@/commands/executor",
              "@/features/shared/command-runtime",
            ],
            message:
              "The parser converts text into facts. It may not persist, execute a command, or compute domain results. Validation happens in src/lib/validation and execution in src/commands/executor.",
          },
        ],
      },
    ],
  },
};

/**
 * The browser may never reach the provider, directly or through the engine.
 *
 * `ChatInput` and `presentation.ts` are the only chat modules a component may use, and both
 * are pure: no key, no endpoint, no engine.
 */
const chatBoundary = {
  name: "hari-os/chat-boundary",
  files: ["src/components/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: providerModules,
            message:
              "A client component must not import the parser, its provider, or its configuration. Render the outcome the server produced instead.",
          },
        ],
      },
    ],
  },
};

/**
 * One enforcing config per scope, carrying every pattern that scope is meant to enforce
 * (ADR-046).
 *
 * ## Why this block exists at all
 *
 * In ESLint flat config, two config objects that set the **same rule** for the **same files** do
 * not merge. The later object replaces the earlier one wholesale — including the parts of it that
 * were never meant to be overridden. `src/domain` was covered by `hari-os/boundaries`,
 * `hari-os/domain-purity`, *and* `hari-os/provider-boundary`; `provider-boundary` came last, so its
 * three provider patterns were all that `src/domain` actually enforced.
 *
 * The effect was that this repository reported architecture rules it was not providing.
 * `src/domain/accounts.ts` could import `@/lib/db` or `node:fs` and `npm run lint` would pass,
 * while `AGENTS.md` stated that a violation fails the build. A probe confirmed it: only the
 * provider patterns fired anywhere, and `src/features/chat` — the one scope with a single config
 * covering it — was the only scope fully enforced. `no-restricted-properties` was unaffected,
 * because it is a differently named rule, which is why `Date.now()` in the domain was correctly
 * caught while `better-sqlite3` in the same file was not.
 *
 * ## The fix
 *
 * These objects are placed **last**, so for each scope they are the winning configuration, and
 * each carries the union of every pattern its scope was originally meant to enforce. Nothing that
 * was meant to be forbidden becomes allowed: each group below already existed in this file, and
 * each is the exact group the earlier, shadowed config specified.
 *
 * The earlier configs are left in place rather than deleted. They remain the documented statement
 * of intent, they still carry rules with other names (`no-restricted-properties`), and deleting
 * them would be a larger diff to shared infrastructure than the defect warrants. What they no
 * longer do is *depend* on winning, which is what made this fail silently.
 *
 * `scripts/architecture-probe.mjs` probes every combination in this block and fails if any of
 * them stops firing, so a future config added above these cannot quietly disarm them again.
 */
/**
 * Feature and command imports, refused from `src/domain`.
 *
 * Dependency direction points inward and downward, so a domain rule may not import the layers
 * above it: a feature may call a domain rule, never the reverse.
 *
 * ## Why this was not already enforced
 *
 * `hari-os/boundaries` states the same rule, and is **shadowed** for `src/domain` by the enforced
 * block below — ESLint replaces a same-named rule wholesale rather than merging it. So the
 * repository reported a boundary it was not providing for this scope, which is precisely the
 * defect ADR-046 was written about, recurring one level up: a domain module could import a
 * feature and reach a database through it while `npm run lint` passed. Adding the pattern there
 * is what closes it.
 *
 * ## Why `src/components` is not included
 *
 * Two components legitimately import a feature's `presentation.ts` — `ChatInput` renders the chat
 * result wording and `OutcomeBanner` renders the outcome wording — and that is vocabulary rather
 * than behaviour. The exception cannot be expressed in this rule: negation inside a `group` is
 * ignored and a top-level negation fails schema validation, so the honest options are enumerating
 * every slice (which blocks a new slice by omission, silently) or leaving components alone.
 * Enforcing the reverse direction for components is left to a phase that reviews them rather than
 * half-enforced here.
 */
const upperLayerModules = [
  "@/features",
  "@/features/*",
  "@/commands",
  "@/commands/*",
];

// Phase 8. Declared once, because `no-restricted-imports` does not merge pattern lists: the
// `src/app` scope is expressed twice below (once for every file, once with the executor added for
// all but the command endpoint) and a second copy of these rules would be free to drift from the
// first. The `@/lib/db` entry is new in this phase — the directory itself was previously only
// refused as `@/lib/db/connection`, so a route could import the repositories it sits above.
// Phase 9. The two modules that read rows a user would not want restated: a private entry and a
// diary note. Each is the *only* reader of its table (ADR-052, ADR-056), which made the boundary a
// convention held by two files rather than a rule — a third reader could have been added and
// `npm run lint` would have stayed green.
const privateReadModules = [
  "@/features/habits/private-log",
  "@/features/habits/diary",
];

const privateReadRule = {
  group: privateReadModules,
  message:
    "A private entry and a diary note are read in one place each: the Habits page and the diary. Nothing else may import them, and least of all the Dashboard.",
};

// The rules that hold for every file in `src/app`, with no exception. The two readers above are
// the only additions, and the files allowed to import them are covered by a later scope.
const appScopeBase = [
  {
    group: storageModules,
    message:
      "src/app holds no SQL and no driver. Read through a feature's view, or persist through the repositories a feature owns.",
  },
  {
    group: ["@/features/chat/openrouter", "@/features/chat/config"],
    message:
      "The provider is reached through src/features/chat/runtime, which is the only module that reads a credential.",
  },
  {
    group: ["@/lib/db"],
    message:
      "A route handler or a client component reaches data through a feature. It may not hold a repository itself.",
  },
];

const appScopePatterns = [...appScopeBase, privateReadRule];

const enforcedBoundaries = [
  {
    name: "hari-os/domain-boundaries-enforced",
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: impureModules,
              message:
                "Domain code must stay pure: no filesystem, network, process, database, or framework access. Pass the value in instead.",
            },
            {
              group: infrastructure,
              message:
                "Domain and components must stay free of infrastructure. Move the rule to src/domain, or call it through a feature.",
            },
            {
              group: providerModules,
              message:
                "The language model is an untrusted parser behind a port. The domain must not know a provider exists.",
            },
            {
              group: upperLayerModules,
              message:
                "A domain rule depends on nothing above it: it takes plain input and returns plain output. A feature may call the domain, never the reverse.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "hari-os/validation-boundaries-enforced",
    files: ["src/lib/validation/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: impureModules,
              message:
                "Validation must stay pure: its verdict has to depend on the input alone, never on the clock, the filesystem, or a database.",
            },
            {
              group: providerModules,
              message:
                "Validation must not know a provider exists. It gates every untrusted input, including a model's.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "hari-os/command-boundaries-enforced",
    files: ["src/commands/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: persistenceModules,
              message:
                "The command layer proposes and validates; it does not persist. Hand the validated intent to a feature, which owns the database.",
            },
            {
              group: providerModules,
              message:
                "The command layer must not reach a provider. The parser is the only module that knows one exists.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "hari-os/component-boundaries-enforced",
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: infrastructure,
              message:
                "Components must stay free of infrastructure. Receive the value as a prop, or read it through a feature.",
            },
            {
              group: providerModules,
              message:
                "A client component must not import the parser, its provider, or its configuration. Render the outcome the server produced instead.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "hari-os/dashboard-boundaries-enforced",
    files: ["src/features/dashboard/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            privateReadRule,
            {
              group: persistenceModules,
              message:
                "The Dashboard is a read model. It composes the owning features' read sides through src/features/shared/command-runtime and may not open a database, touch the filesystem, or import a driver itself.",
            },
            {
              group: providerModules,
              message:
                "The Dashboard renders persisted state. It must not know a language model exists, and it never asks one what to do.",
            },
            {
              group: [
                "@/commands/executor",
                "@/features/kitchen/setup",
                "@/features/kitchen/correction",
              ],
              message:
                "The Dashboard is read-only. It may not execute a command or call a feature's write side; every change goes through the command endpoint or the Kitchen route.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "hari-os/routine-boundaries-enforced",
    files: ["src/features/routine/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: persistenceModules,
              message:
                "The Routine slice reaches storage through src/features/shared/command-runtime and may not open a database, touch the filesystem, or import a driver itself.",
            },
            {
              group: providerModules,
              message:
                "Routine renders and writes what the user recorded. It must not know a language model exists, and it never asks one what to do.",
            },
            {
              group: [
                "@/commands/executor",
                "@/features/kitchen/setup",
                "@/features/kitchen/correction",
                "@/features/expenses/write",
              ],
              message:
                "A feature may not reach into another's write side. Every change on this application goes through the command endpoint or the feature's own route.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "hari-os/skills-boundaries-enforced",
    files: ["src/features/skills/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: persistenceModules,
              message:
                "The Skills slice reaches storage through src/features/shared/command-runtime and may not open a database, touch the filesystem, or import a driver itself.",
            },
            {
              group: providerModules,
              message:
                "Skills renders and records what the user named. It must not know a language model exists, and it never asks one what to do.",
            },
            {
              group: [
                "@/commands/executor",
                "@/features/kitchen/setup",
                "@/features/kitchen/correction",
                "@/features/expenses/write",
              ],
              message:
                "A feature may not reach into another's write side. Every change on this application goes through the command endpoint or the feature's own route.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "hari-os/habits-boundaries-enforced",
    files: ["src/features/habits/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // `@/lib/storage` is deliberately absent from this group, and that is the one
              // difference from the Routine and Dashboard scopes: photos are files, and a feature
              // is the only layer allowed to own them. `src/app` is forbidden from storage by
              // `hari-os/application-boundaries-enforced`, so the Habits slice is where a photo
              // may legitimately be written and read. Everything else that touches the disk
              // directly is still refused, so this slice cannot invent its own filesystem access
              // beside the storage module's.
              group: [
                "@/lib/db/connection",
                "@/lib/db/migrations",
                "@/lib/db/schema",
                "better-sqlite3",
                "node:fs",
                "node:fs/*",
                "node:os",
                "node:path",
                "node:child_process",
                "node:worker_threads",
                "node:net",
                "node:http",
                "node:https",
                "next/*",
              ],
              message:
                "The Habits slice writes photos through src/lib/storage and reaches the database through src/features/shared/command-runtime. It may not open a handle, import a driver, or touch the disk itself.",
            },
            {
              group: providerModules,
              message:
                "Habits renders and records what the user stated. It must not know a language model exists, and it never asks one what to do.",
            },
            {
              group: [
                "@/commands/executor",
                "@/features/kitchen/setup",
                "@/features/kitchen/correction",
                "@/features/expenses/write",
              ],
              message:
                "A feature may not reach into another's write side. Every change on this application goes through the command endpoint or the feature's own route.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "hari-os/application-boundaries-enforced",
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: appScopePatterns }],
    },
  },
  {
    // The same scope, plus the executor, for every route except the one whose job is executing
    // commands. `no-restricted-imports` replaces its patterns rather than merging them, so this
    // repeats the list through the shared constant instead of restating it, and the exception is
    // scoped to one file rather than left implicit: a second route holding the executor would let
    // a change happen outside the feature that owns it.
    name: "hari-os/route-command-boundary",
    files: ["src/app/**/*.{ts,tsx}"],
    ignores: ["src/app/api/commands/route.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...appScopePatterns,
            {
              group: ["@/commands/executor"],
              message:
                "Only the command endpoint executes commands. Every other route hands a change to the feature that owns it.",
            },
          ],
        },
      ],
    },
  },
];

// The three files in `src/app` that are *supposed* to read a private entry or a diary note: the
// Habits page, which is the private log's own page and the diary's own preview; the diary page; and
// the route that writes one note back. Named rather than matched by pattern, because the boundary is
// "these three and no others" — a fourth page importing either module is a mistake whatever it is
// called. They are given the base rules through the same constants, so this is a narrowing of the
// `src/app` scope rather than a hole in it.
const diaryReaderScope = {
  name: "hari-os/private-reader-scope",
  // The note route's own path is written with `*` for the `[id]` segment: in a glob, `[id]` is a
  // character class matching a single `i` or `d`, so the literal form would silently match
  // nothing and the scope would be a no-op that looks like it works.
  files: [
    "src/app/habits/page.tsx",
    "src/app/diary/page.tsx",
    "src/app/api/photos/*/note/route.ts",
  ],
  rules: {
    "no-restricted-imports": ["error", { patterns: appScopeBase }],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  boundaries,
  domainPurity,
  validationPurity,
  commandBoundary,
  providerBoundary,
  providerPurity,
  chatBoundary,
  // Last, so these win for the scopes they cover. See ADR-046 before moving anything above.
  ...enforcedBoundaries,
  // After the enforced scopes, because it is a narrowing of one of them rather than a new rule.
  diaryReaderScope,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Tool state, and any git worktree nested inside the project. `.kilo/` is git-ignored, so
    // it is never part of this project's source, and another session's worktree carries its
    // own copy of the config and its own sources. Linting it from here applied this
    // repository's rules to unrelated code.
    ".kilo/**",
  ]),
]);

export default eslintConfig;
