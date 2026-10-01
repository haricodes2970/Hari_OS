/**
 * The architecture audit, run as a test rather than trusted as a claim.
 *
 * Run with `npm run architecture:probe`.
 *
 * ## Why this file exists
 *
 * ESLint flat config does not merge two config objects that set the *same rule* for the *same
 * files* — the later one replaces the earlier one wholesale. Between Phase 1 and Phase 4 this
 * repository carried four overlapping configurations for the same directories, so the last one
 * silently won and the earlier patterns were never applied.
 *
 * The result was a codebase that reported rules it was not providing. `src/domain/accounts.ts`
 * could import `@/lib/db` or `node:fs` and `npm run lint` passed, while `AGENTS.md` stated that a
 * violation fails the build. Only the provider patterns fired anywhere. Nothing in the test suite
 * caught it, because every test happened to obey the boundary that was not being enforced — a
 * codebase can comply by discipline and still have no enforcement at all, and the two are
 * indistinguishable until something tries to break the rule.
 *
 * That is the gap this file closes. It does not check that the code obeys the architecture; the
 * other suites do that by writing compliant code. It checks that the *guards fire at all*, which
 * is the property nothing else can observe.
 *
 * ADR-046 records the fix. These probes are what would catch its regression.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Each case: where the probe goes, and the specifier that must be refused there.
 *
 * Written as data so a new boundary is one line rather than a new script, and so the table reads
 * as the project's actual architecture instead of as whatever the tests happen to cover.
 */
const CASES = [
  // src/domain — a business rule may be tested with plain input, or not at all.
  ["src/domain/__probe.ts", "src/domain/accounts.ts", "@/lib/db"],
  ["src/domain/__probe.ts", "src/domain/accounts.ts", "@/lib/db/connection"],
  ["src/domain/__probe.ts", "src/domain/accounts.ts", "@/lib/db/repositories"],
  ["src/domain/__probe.ts", "src/domain/accounts.ts", "@/lib/storage"],
  ["src/domain/__probe.ts", "src/domain/accounts.ts", "better-sqlite3"],
  ["src/domain/__probe.ts", "src/domain/accounts.ts", "node:fs"],
  ["src/domain/__probe.ts", "src/domain/accounts.ts", "@/commands/executor"],
  [
    "src/domain/__probe.ts",
    "src/domain/accounts.ts",
    "@/features/chat/openrouter",
  ],

  // src/lib/validation — the gate every untrusted input passes through.
  [
    "src/lib/validation/__probe.ts",
    "src/lib/validation/command.ts",
    "@/lib/db/connection",
  ],
  ["src/lib/validation/__probe.ts", "src/lib/validation/command.ts", "node:fs"],
  [
    "src/lib/validation/__probe.ts",
    "src/lib/validation/command.ts",
    "@/features/chat/openrouter",
  ],

  // src/commands — proposes and validates; it does not persist.
  [
    "src/commands/__probe.ts",
    "src/commands/executor.ts",
    "@/lib/db/connection",
  ],
  [
    "src/commands/__probe.ts",
    "src/commands/executor.ts",
    "@/lib/db/migrations",
  ],
  ["src/commands/__probe.ts", "src/commands/executor.ts", "better-sqlite3"],
  ["src/commands/__probe.ts", "src/commands/executor.ts", "node:fs"],

  // src/features/skills and src/features/habits — Phase 7. Each owns one area end to end.
  ["src/features/skills/__probe.ts", "src/features/skills/view.ts", "node:fs"],
  [
    "src/features/skills/__probe.ts",
    "src/features/skills/view.ts",
    "better-sqlite3",
  ],
  [
    "src/features/skills/__probe.ts",
    "src/features/skills/view.ts",
    "@/commands/executor",
  ],
  [
    "src/features/skills/__probe.ts",
    "src/features/skills/view.ts",
    "@/features/chat/openrouter",
  ],
  [
    "src/features/habits/__probe.ts",
    "src/features/habits/view.ts",
    "better-sqlite3",
  ],
  [
    "src/features/habits/__probe.ts",
    "src/features/habits/photos.ts",
    "node:fs",
  ],
  [
    "src/features/habits/__probe.ts",
    "src/features/habits/photos.ts",
    "@/lib/db/connection",
  ],
  [
    "src/features/habits/__probe.ts",
    "src/features/habits/view.ts",
    "@/features/chat/runtime",
  ],
  [
    "src/commands/__probe.ts",
    "src/commands/executor.ts",
    "@/features/chat/openrouter",
  ],

  // Phase 8. The diary is part of the habits slice, not a slice of its own, so it is held to the
  // same boundaries: it composes through the runtime, imports its own domain rules, and may not
  // open a database, a driver, or the disk. `node:fs` is the load-bearing probe here — a diary
  // that kept images would be the obvious way to break this rule, so the rule is checked against
  // the module that would most plausibly break it.
  ["src/features/habits/__probe.ts", "src/features/habits/diary.ts", "node:fs"],
  [
    "src/features/habits/__probe.ts",
    "src/features/habits/diary.ts",
    "better-sqlite3",
  ],
  [
    "src/features/habits/__probe.ts",
    "src/features/habits/diary.ts",
    "@/lib/db/connection",
  ],
  [
    "src/features/habits/__probe.ts",
    "src/features/habits/diary.ts",
    "@/commands/executor",
  ],
  // The domain file the whole note rule set lives in. A note rule that could reach a database
  // would no longer be a rule, it would be a query.
  ["src/domain/__probe.ts", "src/domain/diary.ts", "@/lib/db"],
  ["src/domain/__probe.ts", "src/domain/diary.ts", "node:fs"],
  ["src/domain/__probe.ts", "src/domain/diary.ts", "@/features/habits/diary"],
  // The page and its route: routing only, no filesystem, no provider.
  [
    "src/app/diary/__probe.tsx",
    "src/app/diary/page.tsx",
    "@/lib/db/connection",
  ],
  ["src/app/diary/__probe.tsx", "src/app/diary/page.tsx", "node:fs"],
  [
    "src/app/diary/__probe.tsx",
    "src/app/diary/page.tsx",
    "@/features/chat/openrouter",
  ],
  [
    "src/app/api/photos/__probe.ts",
    "src/app/api/photos/[id]/note/route.ts",
    "@/lib/db/connection",
  ],
  [
    "src/app/api/photos/__probe.ts",
    "src/app/api/photos/[id]/note/route.ts",
    "node:fs",
  ],

  // src/components — render and dispatch; no database, no filesystem, no provider.
  ["src/components/__probe.tsx", "src/components/Nav.tsx", "@/lib/db"],
  ["src/components/__probe.tsx", "src/components/Nav.tsx", "@/lib/storage"],
  [
    "src/components/__probe.tsx",
    "src/components/Nav.tsx",
    "@/commands/executor",
  ],
  [
    "src/components/__probe.tsx",
    "src/components/Nav.tsx",
    "@/features/chat/openrouter",
  ],

  // src/features/dashboard — a read model. It composes; it does not open a database and it never
  // asks a model anything.
  [
    "src/features/dashboard/__probe.ts",
    "src/features/dashboard/view.ts",
    "@/lib/db/connection",
  ],
  [
    "src/features/dashboard/__probe.ts",
    "src/features/dashboard/view.ts",
    "better-sqlite3",
  ],
  [
    "src/features/dashboard/__probe.ts",
    "src/features/dashboard/view.ts",
    "node:fs",
  ],
  [
    "src/features/dashboard/__probe.ts",
    "src/features/dashboard/view.ts",
    "@/features/chat/openrouter",
  ],
  [
    "src/features/dashboard/__probe.ts",
    "src/features/dashboard/view.ts",
    "@/commands/executor",
  ],

  // src/features/routine — the slice that owns plan_task, sleep_log, and nap_log. It composes
  // through the runtime like every other feature, and it may not execute a command directly or
  // borrow another feature's write side.
  [
    "src/features/routine/__probe.ts",
    "src/features/routine/view.ts",
    "@/lib/db/connection",
  ],
  [
    "src/features/routine/__probe.ts",
    "src/features/routine/write.ts",
    "better-sqlite3",
  ],
  [
    "src/features/routine/__probe.ts",
    "src/features/routine/view.ts",
    "node:fs",
  ],
  [
    "src/features/routine/__probe.ts",
    "src/features/routine/write.ts",
    "@/commands/executor",
  ],
  [
    "src/features/routine/__probe.ts",
    "src/features/routine/write.ts",
    "@/features/kitchen/setup",
  ],
  [
    "src/features/routine/__probe.ts",
    "src/features/routine/view.ts",
    "@/features/chat/openrouter",
  ],

  // src/app — routing only. The page that aggregates everything must not be able to reach a
  // driver or the filesystem, because "no SQL in the page component" is a claim worth proving.
  ["src/app/__probe.ts", "src/app/page.tsx", "@/lib/db/connection"],
  ["src/app/__probe.ts", "src/app/page.tsx", "better-sqlite3"],
  ["src/app/__probe.ts", "src/app/page.tsx", "node:fs"],
  ["src/app/__probe.ts", "src/app/page.tsx", "@/features/chat/openrouter"],
];

/**
 * Cases that must NOT be blocked.
 *
 * A boundary that forbids too much is a real defect too, and one that forbids a module the
 * architecture permits — `@/lib/db/repositories` for the executor, `@/domain` for a validator —
 * would stop that layer doing its job. Both directions are asserted, because a rule that simply
 * rejects everything would otherwise "pass" this file.
 */
const ALLOWED = [
  [
    "src/commands/__probe_allowed.ts",
    "src/commands/executor.ts",
    "@/lib/db/repositories",
  ],
  [
    "src/lib/validation/__probe_allowed.ts",
    "src/lib/validation/command.ts",
    "@/domain/money",
  ],
  [
    "src/features/expenses/__probe_allowed.ts",
    "src/features/expenses/view.ts",
    "@/domain/expenses",
  ],
  [
    "src/features/dashboard/__probe_allowed.ts",
    "src/features/dashboard/view.ts",
    "@/features/shared/command-runtime",
  ],
  [
    "src/features/dashboard/__probe_allowed.ts",
    "src/features/dashboard/view.ts",
    "@/domain/habits",
  ],
  [
    "src/app/__probe_allowed.ts",
    "src/app/page.tsx",
    "@/features/dashboard/view",
  ],
  // Phase 7. A feature may own a filesystem operation through `src/lib/storage` — that is the
  // only way a photo can be written, since `src/app` is forbidden from storage — while still being
  // refused the driver and the disk.
  [
    "src/features/habits/__probe_allowed.ts",
    "src/features/habits/photos.ts",
    "@/lib/storage/photos",
  ],
  [
    "src/features/habits/__probe_allowed.ts",
    "src/features/habits/view.ts",
    "@/features/shared/command-runtime",
  ],
  [
    "src/features/skills/__probe_allowed.ts",
    "src/features/skills/view.ts",
    "@/domain/skills",
  ],
  // Phase 8. The diary reads its own domain rules and composes through the runtime, exactly as the
  // rest of the habits slice does. If these were blocked, the note rules would have to be
  // reimplemented inside the feature, which is the duplication ADR-056 exists to avoid.
  [
    "src/features/habits/__probe_allowed.ts",
    "src/features/habits/diary.ts",
    "@/domain/diary",
  ],
  [
    "src/features/habits/__probe_allowed.ts",
    "src/features/habits/diary.ts",
    "@/features/shared/command-runtime",
  ],
  [
    "src/app/diary/__probe_allowed.tsx",
    "src/app/diary/page.tsx",
    "@/features/habits/diary",
  ],
  [
    "src/app/api/photos/__probe_allowed.ts",
    "src/app/api/photos/[id]/note/route.ts",
    "@/features/habits/diary",
  ],
  [
    "src/features/routine/__probe_allowed.ts",
    "src/features/routine/view.ts",
    "@/features/shared/command-runtime",
  ],
  [
    "src/features/routine/__probe_allowed.ts",
    "src/features/routine/write.ts",
    "@/domain/sleep",
  ],
];

/** Specifiers that must be refused, checked against the rule that is supposed to refuse them. */
const IMPORT_RULE = "no-restricted-imports";

function lint(file) {
  try {
    return execFileSync("npx", ["eslint", file], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    // A non-zero exit is the expected outcome for a probe that should be blocked. ESLint prints
    // the diagnostics on stdout either way, so the output is what matters, not the exit code.
    const error = cause;
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

function lintContent(file, content) {
  const full = path.join(projectRoot, file);

  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);

  try {
    return lint(file);
  } finally {
    fs.rmSync(full, { force: true });
  }
}

function probe(file, specifier) {
  return lintContent(
    file,
    `import { probe } from "${specifier}";\nexport const value = probe;\n`,
  );
}

console.log("# every documented boundary refuses what it says it refuses");

for (const [file, owner, specifier] of CASES) {
  const output = probe(file, specifier);

  if (output.includes(IMPORT_RULE)) {
    passed += 1;
    console.log(`ok    ${owner} refuses ${specifier}`);
  } else {
    failed += 1;
    console.log(
      `FAIL  ${owner} does NOT refuse ${specifier} — the rule is not firing`,
    );
  }
}

console.log("\n# permitted imports are still permitted");

for (const [file, owner, specifier] of ALLOWED) {
  const output = probe(file, specifier);

  if (output.includes(IMPORT_RULE)) {
    failed += 1;
    console.log(
      `FAIL  ${owner} refuses ${specifier}, which the architecture permits`,
    );
  } else {
    passed += 1;
    console.log(`ok    ${owner} still allows ${specifier}`);
  }
}

console.log(
  "\n# the domain cannot read the clock, the environment, or randomness",
);

for (const [label, content, expected] of [
  [
    "Date.now()",
    "export const when = Date.now();\n",
    "no-restricted-properties",
  ],
  [
    "process.env",
    "export const key = process.env.OPENROUTER_API_KEY;\n",
    "no-restricted-properties",
  ],
  [
    "Math.random()",
    "export const id = Math.random();\n",
    "no-restricted-properties",
  ],
]) {
  const output = lintContent("src/domain/__probe_impure.ts", content);

  if (output.includes(expected)) {
    passed += 1;
    console.log(`ok    src/domain refuses ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  src/domain does not refuse ${label}`);
  }
}

console.log("\n# no probe file was left behind");

{
  const leftovers = CASES.map(([file]) => file)
    .concat(ALLOWED.map(([file]) => file))
    .concat(["src/domain/__probe_impure.ts"])
    .filter((file) => fs.existsSync(path.join(projectRoot, file)));

  if (leftovers.length === 0) {
    passed += 1;
    console.log("ok    every probe file was removed");
  } else {
    failed += 1;
    console.log(
      `FAIL  these probe files were left behind: ${leftovers.join(", ")}`,
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
