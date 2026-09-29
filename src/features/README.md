# Features

Vertical slices of application behaviour, one directory per product area: `dashboard`,
`routine`, `kitchen`, `expenses`, `skills`, `habits`.

A feature may own its domain rules, its UI, and its data access. It should not reach into
another feature's internals.

No feature directories exist yet. Creating empty ones now would be scaffolding for its own
sake; they are created when the phase that implements them begins.
