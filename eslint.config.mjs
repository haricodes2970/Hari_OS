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

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  boundaries,
  domainPurity,
  validationPurity,
  commandBoundary,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
