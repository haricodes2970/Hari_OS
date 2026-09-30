# AGENTS.md

Operating instructions for coding agents working on Hari OS.

**Read this file and the canonical documents below before changing anything.**

This file states rules, not status. For current phase and micro-phase, read
`docs/project/PROJECT_STATUS.md`.

---

## 1. Project identity

- **Name:** Hari OS
- **What it is:** a personal, single-user, localhost-first web application, intended to
  work as an installable PWA.
- **Core purpose:** replace forgotten intentions and willpower with a visible daily system
  across tasks, sleep, kitchen stock, money, skills, and habits. It surfaces information and
  options. **The user makes every decision.**

**V1 priorities, in order of weight:**

1. Controlled, focused screen use
2. Cooking from known kitchen stock
3. Improved sleep consistency
4. Replacement skills and activities
5. Reality-based logging rather than intention-only tracking

Do not reproduce the PRD here. It is one document, and it is the product authority.

---

## 2. Canonical sources of truth

Look here first, in this order of authority for each kind of question:

| Question                                        | Source                             |
| ----------------------------------------------- | ---------------------------------- |
| What should the product do?                     | `Hari_OS_V1_PRD.docx`              |
| Current phase, micro-phase, status, next action | `docs/project/PROJECT_STATUS.md`   |
| Where code goes and what may import what        | `docs/project/ARCHITECTURE.md`     |
| Why it is that way                              | `docs/project/DECISIONS.md` (ADRs) |
| What actually happened, and what was verified   | `docs/sessions/`                   |
| Phase-specific records, when present            | `docs/phases/`                     |
| Engineering rules                               | `AGENTS.md` (this file)            |

Precedence:

- **Product requirements** come from the PRD. Nothing else may add product scope.
- **Architecture** comes from `ARCHITECTURE.md` plus `DECISIONS.md`. An ADR, once accepted,
  is binding until superseded by another ADR.
- **Implementation status** comes from `PROJECT_STATUS.md`.
- **When documentation disagrees with the code, inspect the repository, then document the
  discrepancy.** Do not silently "fix" code to match stale docs, and do not silently rewrite
  docs to match code. Record the mismatch.

`docs/phases/` does not exist yet. It is created in a later micro-phase. Consult it when it
exists; do not assume it is present.

---

## 3. Current stack

Verified against `package.json`. Do not list or assume anything not in this list.

| Component         | Version                                             |
| ----------------- | --------------------------------------------------- |
| Next.js           | 16.3.7 (App Router, Turbopack)                      |
| React / React DOM | 19.2.8                                              |
| TypeScript        | 5                                                   |
| ESLint            | 9 (`eslint-config-next` 16.3.7, flat config)        |
| Prettier          | 3.9.9                                               |
| better-sqlite3    | 13                                                  |
| server-only       | 0.0.1                                               |
| Package manager   | npm (`package-lock.json` is the lockfile of record) |
| Node              | >= 20.9.0 (`"type": "module"`)                      |

**Deliberately absent. Do not introduce without an explicit instruction or ADR:** ORM
(Prisma, Drizzle), Supabase, Tailwind, React Compiler, a PWA package, an LLM SDK, auth,
deployment configuration, UI frameworks, and any second package manager.

---

## 4. Architecture rules

```
src/app/           Next.js routes, layouts, server entry points
src/components/    reusable presentation
src/features/      vertical product slices, one directory per area
src/domain/        pure business rules and calculations
src/commands/      future natural-language command engine
src/lib/db/        SQLite access (server-only)
src/lib/storage/   future local filesystem storage
src/lib/validation/ validation boundaries
```

Rules:

- `src/app/` — routing concerns only. No business rules, no SQL, no business types.
- `src/components/` — render and dispatch. No database, no filesystem, no command engine,
  no business rules. Receives data as props.
- `src/features/` — one product area end to end. Must not reach into another feature's
  internals.
- `src/domain/` — business rules, calculations, domain types. **Pure.** No React, no SQL,
  no filesystem, no LLM. If a rule cannot be tested with plain input and output, it is in
  the wrong place.
- `src/commands/` — future command engine. Must not write to SQLite directly. It produces
  and validates intent, then hands it to a feature.
- `src/lib/db/` — all SQLite access. Server-only. No business meaning; queries return data,
  and the rules interpreting it live in `src/domain`.
- `src/lib/storage/` — all filesystem access for uploads.
- `src/lib/validation/` — validation shared across form, route, and command entry points.

Dependency direction points inward and downward. A layer never imports the layer above it.

**Enforced, not merely documented.** `eslint.config.mjs` defines a `hari-os/boundaries`
rule using ESLint's built-in `no-restricted-imports`: files under `src/domain/` and
`src/components/` may not import `@/lib/db`, `@/lib/storage`, or `@/commands`. A violation
fails `npm run lint`. If you need to relax it, that is an architecture change and requires
an ADR.

**Do not add new layers.** The set above is the architecture. Adding a service layer, a
repository layer, a barrel `index.ts`, or a `src/types/` directory requires a written
justification and an ADR. Types belong to `domain/` or to the owning feature (ADR-012).

---

## 5. Database rules

- **SQLite is V1.** Fixed by ADR-001. Do not introduce another database.
- **Driver is `better-sqlite3`.** Chosen over Node's built-in `node:sqlite` because that is
  experimental (ADR-014). Import it only inside `src/lib/db/`.
- **Location is `data/hari-os.db`**, resolved from the project root. The directory and file
  are created automatically on first access. Nothing needs manual setup.
- `HARI_OS_DB_PATH` is an **optional** local override, documented in `.env.example`. It
  exists for tests and tooling. There is no production to point it at; V1 has no deployment.
- **Database files are local user state and must never be committed.**
- **No ORM** unless an explicit ADR changes this.
- **No feature schema outside the designated schema phase.** The schema is currently empty
  by design. `npm run db:check` fails if any PRD entity table appears, so keep it green.
- **Arithmetic and business calculations belong in `src/domain`, not in SQL.** The same
  rule applies to the LLM: see section 7.
- All access stays behind `src/lib/db/`. `connection.ts` imports `server-only`, so a Client
  Component importing it fails the build.

Verify database work with `npm run db:check`, not by assuming.

---

## 6. Local data and secrets

These are git-ignored and must stay that way:

- `data/` and `data/**` — SQLite database and future uploads under `data/uploads/`
- `*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite`, `*.sqlite3`
- `.env`, `.env.local`, `.env.development`, `.env.test`, `.env.production`, and their
  `.local` variants

`.env.example` is tracked on purpose (`!.env.example`). It is the configuration reference
and contains documentation and safe examples only.

Rules:

- **Never commit secrets, API keys, local databases, uploads, or user data.**
- **Never put machine-specific absolute paths in tracked files.** Use relative paths or
  documented environment variables.
- **Add an environment variable only when code actually reads a real requirement.** Do not
  pre-configure variables for features that do not exist.
- This repository is not a backup for local data.

---

## 7. LLM / command-engine boundary

This is the most important constraint in the project.

- **OpenRouter is planned for a later phase (Phase 2). No LLM integration, SDK, or API key
  exists now.** Do not invent a key name or provider configuration.
- **Do not implement the parser before its designated phase.**
- Natural-language parsing is an **interpretation layer, not a source of truth.** It turns
  a sentence into a structured, typed intent.
- **LLM output must be structured and validated before any mutation.**
- **The LLM must never perform arithmetic that affects balances or quantities.** Financial
  balances and inventory quantities are computed by deterministic code in `src/domain`.
  This is non-negotiable (PRD principle 11 and 12).
- Deterministic application and domain code own all state mutation.
- **The command layer must not bypass feature or domain validation to write directly to
  SQLite.** It validates an intent, then hands it to the owning feature.
- **Never add an LLM dependency because a feature "could use AI."** If a design needs one,
  write an ADR first.
- Every mutation must be traceable and correctable (PRD principle 13).

---

## 8. Product behavior principles

Already decided. Do not expand them into new requirements.

- **Substitution over restriction.** Every urge gets a replacement action, not just a ban.
- **Visible next action.** The day should not start with a blank mind.
- **Log reality, not intentions.** State is visible: stock counts, balances, bedtimes.
- **No shame-based streaks for private behaviors.** Doom scrolling and masturbation are
  never shown as a streak, score, or progress bar. Neutral habits may have streaks.
- **The assistant suggests and organizes; the user decides.**
- **The user picks from the full skill list.** The system never silently auto-selects one.
- **Corrections must be possible.** A wrong entry has to be easy to fix.
- **Empty states must not crash.**
- Function over visual polish for V1.

---

## 9. Git workflow

- `main` is the working branch.
- **No force-push. No history rewriting. No amending pushed commits.**
- Meaningful commits only. One independently understandable unit per commit where
  practical. Do not manufacture commits to hit a number, and do not squash unrelated work
  into one giant commit.
- Commit message style follows the established convention:
  `feat(0.2): initialize Next.js foundation`, `feat(0.3): establish development tooling`,
  `feat(0.5): establish local sqlite foundation`,
  `chore(0.6): harden environment and local data safety`.
- **Verify before committing.** See section 11.
- **Update documentation before committing when possible.**
- **Push only after verification.** Then confirm the remote contains the commit and the
  working tree is clean.

**Known past failure mode — do not repeat it.** Commit hashes have been written into
documentation before the commits existed, which required a fix-up commit.

- **Never fabricate a commit hash.**
- If a document needs a hash, write `pending commit` until the commit actually exists.
- Never amend or force-push merely to fix documentation metadata. A small follow-up
  documentation commit is acceptable and expected.

---

## 10. Micro-phase workflow

Work proceeds in micro-phases. For every assignment:

1. **Read the project documentation before changing anything** — this file, then
   `PROJECT_STATUS.md`, `ARCHITECTURE.md`, `DECISIONS.md`, and the relevant session report.
2. **Identify the current micro-phase** from `PROJECT_STATUS.md`.
3. **Inspect before editing.** Never assume; read the file you are about to change.
4. **Work only inside the explicitly assigned micro-phase.** Respect its hard boundaries.
5. **Verify the implementation** using section 11.
6. **Update documentation** to reflect what actually happened.
7. **Commit meaningful work** with a descriptive message.
8. **Push only after verification**, then confirm remote and working-tree state.
9. **Report exactly what changed and what remains,** including anything not finished.

**Do not automatically advance to the next micro-phase.** Stop when the assigned
micro-phase is complete and verified, and report.

---

## 11. Verification expectations

Baseline for every change:

```bash
npm install
npm run format:check
npm run typecheck
npm run lint
npm run build
```

Add phase-specific verification on top:

**Database work**

```bash
npm run db:check
```

Confirm the database is created on demand, opens, reports the expected pragmas, still
contains no feature tables, and remains git-ignored.

**Security and data changes**

- `git status` and `git diff` before staging
- `git diff --cached --name-only` after staging
- `git check-ignore` on representative real files, not just on the pattern text
- scan staged content and recent history for accidental secrets or user data

**Boundary changes**

- Probe with a temporary file and confirm the ESLint rule actually fires, then delete it
- Probe server-only with a temporary route and confirm the build fails, then delete it
- After deleting probe routes, clear `.next` before trusting `npm run typecheck`

**"The build passes" is never sufficient verification for infrastructure work.** Build
success does not prove an ignore rule works, a file stays untracked, a guard fires, or a
schema stays empty. Verify the specific claim.

---

## 12. Scope-control rules

Prohibited without an explicit instruction and, where architectural, an ADR:

- **Speculative abstractions** — layers, interfaces, or abstractions for possible future use
- **Unnecessary dependencies** — check what is already installed first
- **Placeholder feature implementations** and fake module pages
- **Fake or mock business logic presented as real functionality**
- **Feature work during infrastructure micro-phases**
- **Modifying the PRD to make the implementation fit.** The PRD is the requirement; if it
  is wrong, raise it with the user.
- **Silently changing architectural decisions** — including database technology, framework,
  repository structure, environment strategy, storage strategy, or LLM provider strategy
- **Deployment complexity** before it is required
- **Authentication** before it is required
- **An ORM** without an explicit decision
- **Deleting or rewriting existing work** before inspecting it and confirming it holds no
  value

When something is ambiguous, make the smallest reasonable decision, then document it.

---

## 13. Documentation discipline

- Keep `docs/project/PROJECT_STATUS.md` current: current phase, current micro-phase,
  completed micro-phases, active work, blockers, latest commit, next action.
- Keep `docs/project/ARCHITECTURE.md` aligned with the real architecture.
- Record every meaningful architectural decision in `docs/project/DECISIONS.md` as an ADR,
  including the alternative considered and why it was rejected.
- Use session reports to record actual work, verification, commits, and problems.
- **Do not rewrite historical reports to hide mistakes.** Add the correction and move on.
- **Do not fabricate verification results.** If a check did not run, say so. If it failed,
  say that too.
- **Distinguish planned, implemented, and verified work.** These are different states and
  the documents must not blur them.
- Do not document future progress as if it were complete.

---

## 14. Current status

**Do not infer current status from this file.** Read `docs/project/PROJECT_STATUS.md`.

Historical note: this file was created during Phase 0, micro-phase 0.7, when the project
consisted of the architecture, tooling, SQLite foundation, and environment safety described
in section 3, with no feature code, no schema, and no LLM integration. That is a record of
one moment, not a statement about today.

---

## 15. Agent behavior

- **Inspect before editing.** Read the file, the config, and the surrounding code first.
- **Prefer the smallest correct change.** Do not rewrite working code unnecessarily.
- **Reuse the existing architecture.** If a new pattern is genuinely needed, record why.
- **Do not silently undo prior decisions.** Read the ADR before reversing it.
- **Test assumptions instead of guessing.** A probe file that proves a rule fires is worth
  more than a claim that it would.
- **Surface uncertainty and blockers** rather than hiding them.
- **Keep user data safe.** Assume every local database, upload, and `.env` file matters.
- **Never claim verification that was not actually performed.** Report failures plainly,
  with what was attempted and whether it was fixed.
- **Stop when the assigned micro-phase is complete.**
