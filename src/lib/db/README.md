# Database

The SQLite access boundary. Established in micro-phase 0.5.

All database code lives here and nowhere else. No component, no domain rule, and no
command parser may import this directory directly.

The file lives at `data/hari-os.db`, outside `public/` and excluded from Git.

## Current contents

`connection.ts` is infrastructure only. It resolves the database path, creates the
directory and file on demand, opens the database with WAL journaling and foreign keys
enabled, and hands back a single shared handle.

It contains **no schema**. The PRD entities — `plan_task`, `sleep_log`, `nap_log`,
`inventory_item`, `inventory_event`, `account`, `expense`, `skill`, `skill_log`,
`habit_log`, `private_log` — are deliberately absent and belong to later schema work.

Run `npm run db:check` to verify this foundation from a clean checkout.

## Boundaries this directory must keep

- Server-side only. `connection.ts` imports `server-only`, so importing it from a Client
  Component fails the build rather than leaking SQLite into the browser bundle.
- No business meaning. Queries return data; the rules that interpret it live in
  `src/domain`.
- Directories containing `README.md` and `connection.ts` are the boundary. New query code
  belongs here; nothing else should import `better-sqlite3` directly.
