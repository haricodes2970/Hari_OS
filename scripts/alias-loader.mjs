/**
 * Resolves the `@/` path alias for the test scripts.
 *
 * Test infrastructure only. Nothing in `src/` imports this, and the application never needs
 * it: Next.js resolves `@/` through `tsconfig.json` at build time, and the test scripts run
 * under plain Node, which has no such configuration.
 *
 * Phase 2 needed this. The parser, the provider, the engine, and the presentation layer all
 * import each other through `@/`, which is correct for the application and unresolvable for a
 * bare Node process. The alternatives were to duplicate those imports relatively inside `src/`,
 * which would have made the source uglier for the sake of a test harness, or to stop testing
 * the engine and provider in process and assert on them only through HTTP, which would have
 * lost the ability to compare database state before and after a refusal.
 *
 * Registered by `register-alias.mjs`; see the `*-test.mjs` scripts.
 */

/** Candidate filenames for a specifier that carries no extension. */
const CANDIDATES = ["", ".ts", "/index.ts", ".tsx", ".mjs", ".js"];

/**
 * Package specifiers whose bare form only resolves inside Next's bundler.
 *
 * `next/server` is published with an `exports` map that Next satisfies through its own
 * resolver; plain Node needs the real `.js` path. Route handlers cannot be imported in a test
 * without this, and testing the handlers directly is worth the shim: the alternative is
 * asserting route behaviour over a running server, which is slower and tests less.
 */
const PACKAGE_ALIASES = new Map([["next/server", "next/server.js"]]);

export async function resolve(specifier, context, nextResolve) {
  const aliased = PACKAGE_ALIASES.get(specifier);

  if (aliased !== undefined) {
    return nextResolve(aliased, context);
  }

  if (!specifier.startsWith("@/")) {
    return nextResolve(specifier, context);
  }

  const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
  const errors = [];

  for (const suffix of CANDIDATES) {
    try {
      return await nextResolve(`${base}${suffix}`, context);
    } catch (error) {
      errors.push(error);
    }
  }

  // Reported once, with every candidate tried, because "module not found" on its own does not
  // say which paths were considered.
  const tried = CANDIDATES.map((suffix) => `${base}${suffix}`).join("\n  ");
  throw new Error(`Could not resolve "${specifier}". Tried:\n  ${tried}`);
}
