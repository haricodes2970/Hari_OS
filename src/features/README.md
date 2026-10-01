# Features

Vertical slices of application behaviour, one directory per product area: `dashboard`,
`kitchen`, `expenses`, `routine`, `skills`, `habits`.

A feature may own its domain rules, its UI, and its data access. It should not reach into
another feature's internals.

Three exist today. `kitchen` and `expenses` own their own read and write sides. `dashboard` is
the exception that proves the rule's shape: it owns no data and no rules, and composes the other
features' read sides through `src/features/shared/command-runtime.ts`. It is read-only, and
`npm run architecture:probe` asserts it cannot import a database, a driver, a filesystem module,
a provider, the executor, or another feature's write side.

The remaining directories are created by the phase that implements them, not in advance.
