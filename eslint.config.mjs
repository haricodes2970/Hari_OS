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
    "no-restricted-properties": [
      "error",
      {
        object: "process",
        property: "env",
        message:
          "Domain code must not read the environment. Receive configuration as an argument.",
      },
      {
        object: "Date",
        property: "now",
        message:
          "Domain code must not read the clock. Pass a timestamp in, so results stay deterministic.",
      },
      {
        object: "Math",
        property: "random",
        message: "Domain code must not generate random values. Pass an id in.",
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  boundaries,
  domainPurity,
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
