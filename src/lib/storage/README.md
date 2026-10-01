# Storage

The local filesystem access boundary. Since Phase 7 it holds `photos.ts`: the byte checks, the
server-generated naming, and the write, read, and delete operations behind the laundry photo proof
and the Photo Diary.

All filesystem reads and writes live here. Nothing else touches the disk directly, and
`public/` is never used for private user uploads.

Two rules about who may call it, both enforced in `eslint.config.mjs` and both probed:

- `src/app` may not import this directory, so a route handler cannot write a file. `POST /api/photos`
  calls `src/features/habits/photos.ts` instead.
- `src/features/habits/**` may, and may not reach for `node:fs` beside it, so this module stays the
  only code that knows how a file is stored. See ADR-055.

What is stored in the database is an application URL — `/api/photos/<id>/<filename>` — and never a
filesystem path. See ADR-051.
