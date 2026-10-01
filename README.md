# Hari OS

A personal operating system that makes daily state visible across tasks, sleep,
kitchen inventory, expenses, skills, and habits.

V1 is a local-first, single-user prototype. No deployment.

## Current Status

Phases 0 through 7 are complete: the foundation, the command engine, Kitchen, Expenses, the
Dashboard, Routine and Sleep, and Skills and Habits. Phase 8 is next.

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

| Path        | Shows                                                                                |
| ----------- | ------------------------------------------------------------------------------------ |
| `/`         | Today's spend, tracked count, what is running low, top three tasks, last night       |
| `/kitchen`  | Stock levels, and use / restock / recount                                            |
| `/expenses` | Account balances, and the record of recent spends                                    |
| `/routine`  | Today's tasks, the night check-in, sleep and naps                                    |
| `/habits`   | Cooking, dishes, laundry with a photo, screen time, the private log, a photo preview |
| `/skills`   | The full replacement list, which the Dashboard's urge entry point opens              |
| `/diary`    | Every laundry photo newest first, with your own note beside each one                 |

Every command is submitted to `POST /api/commands`, and the forms work with or without JavaScript.
Photos go to `POST /api/photos` and are served from `/api/photos/<id>/<filename>`. A photo's note
goes to `POST /api/photos/<id>/note`, and posting that field empty is what clears it — notes are
written by forms, never by a sentence, so nothing paraphrases them.

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

| Script                   | Purpose                                     |
| ------------------------ | ------------------------------------------- |
| `npm run dev`            | Start the development server                |
| `npm run build`          | Production build                            |
| `npm run start`          | Serve the production build                  |
| `npm run lint`           | ESLint                                      |
| `npm run typecheck`      | TypeScript check, no emit                   |
| `npm run format`         | Format files with Prettier                  |
| `npm run format:check`   | Verify formatting, no writes                |
| `npm run db:check`       | Verify the local SQLite setup               |
| `npm run db:setup`       | Create first-run accounts and example stock |
| `npm run db:test`        | Schema tests on temporary databases         |
| `npm run domain:test`    | Pure domain rules, in memory                |
| `npm run contract:test`  | Command validation                          |
| `npm run exec:test`      | Execution against real SQLite               |
| `npm run app:test`       | Form translation through to persisted state |
| `npm run parser:test`    | The parser prompt against real sentences    |
| `npm run chat:test`      | Chat surface wording                        |
| `npm run kitchen:test`   | The Kitchen slice                           |
| `npm run expenses:test`  | The Expenses slice                          |
| `npm run dashboard:test` | The Dashboard read model                    |
| `npm run routine:test`   | The Routine slice                           |
| `npm run skills:test`    | Skills, habits, the private log, and photos |
| `npm run diary:test`     | The diary: notes, the timeline, and privacy |

Four acceptance runs serve a production build over HTTP on a disposable database, so run
`npm run build` first:

| Script                     | Purpose                                       |
| -------------------------- | --------------------------------------------- |
| `npm run dashboard:accept` | The Dashboard over HTTP                       |
| `npm run routine:accept`   | The Routine page over HTTP                    |
| `npm run skills:accept`    | The Habits and Skills pages, and photo upload |
| `npm run diary:accept`     | The diary page and the note path over HTTP    |

| Script                       | Purpose                                       |
| ---------------------------- | --------------------------------------------- |
| `npm run responsive:check`   | Navigation and layout at 320, 390, and 1440px |
| `npm run architecture:probe` | The layer-boundary lint rules still fire      |

## Documentation

- Product requirements: `Hari_OS_V1_PRD.docx`
- Architecture: `docs/project/ARCHITECTURE.md`
- Decisions: `docs/project/DECISIONS.md`
- Roadmap: `docs/project/ROADMAP.md`
- Session reports: `docs/sessions/`
