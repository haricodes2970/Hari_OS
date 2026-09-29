# Components

Reusable presentation components, shared across features and routes.

Components render and dispatch events. They do not talk to the database, the filesystem,
or the command engine, and they do not hold business rules. This is enforced by ESLint
boundary rules.

A component that needs data receives it as props from a route or a feature.

Nothing is implemented here yet.
