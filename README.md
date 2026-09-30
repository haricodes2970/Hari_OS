# Hari OS

A personal operating system that makes daily state visible across tasks, sleep,
kitchen inventory, expenses, skills, and habits.

V1 is a local-first, single-user prototype. No deployment.

## Current Status

Phase 0 — engineering/bootstrap foundation. No Hari OS features are implemented yet.

See `docs/project/PROJECT_STATUS.md` for the live status.

## Stack

- Next.js 16 (App Router) + React 19
- TypeScript
- SQLite (local file, introduced in micro-phase 0.5)
- Local filesystem for uploads

## Requirements

- Node.js >= 20.9.0 (developed against v22.23.1)
- npm

## Local Development

```bash
npm install
npm run dev
```

The app is served at http://localhost:3000.

The SQLite database is created automatically at `data/hari-os.db` on first use, and its
schema is applied automatically. Nothing needs to be created by hand, and `data/` is
git-ignored — the repository is not a backup for local data.

## First run

The database needs the accounts and stock the commands refer to before the app can do
anything. Create them once, explicitly:

```bash
npm run db:setup
```

This is **not** done automatically. Nothing in `src/` inserts rows, because opening a page
should never be the act of inventing financial state. Accounts start at a zero opening
balance, since this project does not know your money, and the example stock quantities are
ordinary rows you are expected to correct or delete. The script is idempotent, so running it
again changes nothing.

## Pages

| Path        | Shows                                             |
| ----------- | ------------------------------------------------- |
| `/`         | Today's spend, tracked count, what is running low |
| `/kitchen`  | Stock levels, and use / restock / recount         |
| `/expenses` | Account balances, and the record of recent spends |

Every command is submitted to `POST /api/commands`. The form works with or without
JavaScript.

## Environment

Copy `.env.example` to `.env.local` if you need to override anything:

```bash
cp .env.example .env.local
```

`.env.local` is git-ignored and must never be committed. `.env.example` is tracked and
must never contain real secrets or machine-specific paths.

The only variable the code currently reads is `HARI_OS_DB_PATH`, which is optional and
defaults to `data/hari-os.db` relative to the project root. It exists for local testing and
tooling. V1 has no deployment, so there is nothing to point it at in production.

## Scripts

| Script                  | Purpose                                     |
| ----------------------- | ------------------------------------------- |
| `npm run dev`           | Start the development server                |
| `npm run build`         | Production build                            |
| `npm run start`         | Serve the production build                  |
| `npm run lint`          | ESLint                                      |
| `npm run typecheck`     | TypeScript check, no emit                   |
| `npm run format`        | Format files with Prettier                  |
| `npm run format:check`  | Verify formatting, no writes                |
| `npm run db:check`      | Verify the local SQLite setup               |
| `npm run db:setup`      | Create first-run accounts and example stock |
| `npm run db:test`       | Schema tests on temporary databases         |
| `npm run domain:test`   | Pure domain rules, in memory                |
| `npm run contract:test` | Command validation                          |
| `npm run exec:test`     | Execution against real SQLite               |
| `npm run app:test`      | Form translation through to persisted state |

## Documentation

- Product requirements: `Hari_OS_V1_PRD.docx`
- Architecture: `docs/project/ARCHITECTURE.md`
- Decisions: `docs/project/DECISIONS.md`
- Roadmap: `docs/project/ROADMAP.md`
- Session reports: `docs/sessions/`
