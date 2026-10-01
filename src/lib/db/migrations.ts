import "server-only";

import type { DatabaseHandle } from "./connection";

/**
 * Ordered, append-only schema migrations.
 *
 * SQL lives in TypeScript rather than in `.sql` files so that migrations are part of the
 * module graph rather than a runtime filesystem read. This keeps the mechanism working
 * under a Next.js production build without tracing extra files, and keeps database access
 * self-contained inside `src/lib/db/` (ADR-020).
 *
 * Rules for future migrations:
 *  - Never edit a migration that has been applied. Add a new one.
 *  - Never use `DROP TABLE` as a normal strategy. Migrations are additive.
 *  - Keep each migration to schema only. No business arithmetic (ADR-021).
 */

export type Migration = {
  version: string;
  sql: string;
};

const INITIAL_SCHEMA = `
CREATE TABLE plan_task (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (typeof(done) = 'integer' AND done IN (0, 1)),
  UNIQUE (date, title)
);

CREATE TABLE sleep_log (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  bedtime TEXT,
  sleep_time TEXT,
  wake_time TEXT,
  phone_outside INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(phone_outside) = 'integer' AND phone_outside IN (0, 1))
);

CREATE TABLE nap_log (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT
);

CREATE TABLE inventory_item (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  quantity NUMERIC NOT NULL DEFAULT 0
    CHECK (typeof(quantity) IN ('integer', 'real') AND quantity >= 0),
  unit TEXT NOT NULL,
  low_threshold NUMERIC
    CHECK (low_threshold IS NULL OR (typeof(low_threshold) IN ('integer', 'real') AND low_threshold >= 0))
);

CREATE TABLE inventory_event (
  id INTEGER PRIMARY KEY,
  item INTEGER NOT NULL REFERENCES inventory_item(id),
  delta NUMERIC NOT NULL CHECK (typeof(delta) IN ('integer', 'real')),
  timestamp TEXT NOT NULL,
  source_text TEXT
);

CREATE TABLE account (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (name IN ('cash', 'bank1', 'bank2')),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (typeof(balance) = 'integer')
);

CREATE TABLE expense (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL,
  item TEXT NOT NULL,
  amount INTEGER NOT NULL
    CHECK (typeof(amount) = 'integer' AND amount >= 0),
  account INTEGER NOT NULL REFERENCES account(id),
  category TEXT
);

CREATE TABLE skill (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (typeof(active) = 'integer' AND active IN (0, 1))
);

CREATE TABLE skill_log (
  id INTEGER PRIMARY KEY,
  skill INTEGER NOT NULL REFERENCES skill(id),
  timestamp TEXT NOT NULL,
  minutes INTEGER
    CHECK (minutes IS NULL OR (typeof(minutes) = 'integer' AND minutes >= 0))
);

CREATE TABLE habit_log (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cooking', 'dishes', 'laundry')),
  done INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(done) = 'integer' AND done IN (0, 1)),
  photo_url TEXT
);

CREATE TABLE private_log (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('doom_scrolling', 'masturbation')),
  note TEXT
);

CREATE INDEX idx_plan_task_date ON plan_task (date);
CREATE INDEX idx_inventory_event_item ON inventory_event (item);
CREATE INDEX idx_inventory_event_timestamp ON inventory_event (timestamp);
CREATE INDEX idx_expense_account ON expense (account);
CREATE INDEX idx_expense_timestamp ON expense (timestamp);
CREATE INDEX idx_skill_log_skill ON skill_log (skill);
CREATE INDEX idx_habit_log_date ON habit_log (date);
CREATE INDEX idx_private_log_date ON private_log (date);
`;

/**
 * Migration 002 — manual screen-time entries.
 *
 * ## Why this migration exists
 *
 * PRD section 6.6 asks for a "screen-time estimate, entered manually", and `habit_log` cannot
 * store one: its `CHECK` admits only `cooking`, `dishes`, and `laundry`, and it has no column
 * for a number of minutes. Every other Phase 7 table — `skill`, `skill_log`, `habit_log`,
 * `private_log` — already existed and needed nothing. This is the one place the V1 schema was
 * genuinely insufficient, so this is the only migration Phase 7 writes.
 *
 * ## Why the table is rebuilt rather than altered
 *
 * SQLite cannot widen a `CHECK` constraint with `ALTER TABLE`. The four steps below are the
 * documented way to change one: create the replacement, copy the rows, drop the old table,
 * rename. Foreign keys are disabled for the transaction because dropping a table that others
 * reference is refused while enforcement is on — `habit_log` has no references in either
 * direction, and the pragma is restored in the same statement so no connection is left with
 * enforcement off.
 *
 * ## What is not added
 *
 * No score column, no streak column, no category, no JSON. Screen time is a measurement the
 * user enters by hand; the day total is computed from the rows by `src/domain/habits.ts`, and a
 * stored total could disagree with the entries that produced it.
 */
const SCREEN_TIME_MIGRATION = `
PRAGMA foreign_keys = OFF;

CREATE TABLE habit_log_replaced (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cooking', 'dishes', 'laundry', 'screen_time')),
  done INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(done) = 'integer' AND done IN (0, 1)),
  photo_url TEXT,
  minutes INTEGER
    CHECK (minutes IS NULL OR (typeof(minutes) = 'integer' AND minutes >= 0))
);

INSERT INTO habit_log_replaced (id, date, type, done, photo_url)
  SELECT id, date, type, done, photo_url FROM habit_log;

DROP TABLE habit_log;

ALTER TABLE habit_log_replaced RENAME TO habit_log;

CREATE INDEX idx_habit_log_date ON habit_log (date);

PRAGMA foreign_keys = ON;
`;

/**
 * Migration 003 — a note on a diary entry.
 *
 * ## Why this migration exists
 *
 * PRD 6.6: "Digital diary: the laundry photo and daily notes form a visual timeline." Phase 7
 * delivered the photo half and left the notes with nowhere to live: `habit_log.photo_url` is the
 * only column in the schema that can hold a picture, and there was no dated note anywhere.
 *
 * ## Why a column and not a table
 *
 * The instruction for this phase was to reuse the existing photo metadata and make the smallest
 * necessary change, and the reasoning agrees: a diary entry *is* the photo. The row that owns
 * `photo_url` is the entry, so the note belongs on that row.
 *
 * A separate `diary_entry` table was rejected because it would have to carry the photo reference
 * too — and two tables holding a photo's location is two answers to "which picture is this" the
 * day they disagree. With a column, the required invariant is structural: a row cannot have a
 * note and no photo unless a writer put it there, and the single writer refuses.
 *
 * ## Why this is an `ALTER TABLE`, not another rebuild
 *
 * There is no constraint to widen, so there is nothing that needs the four-step table dance
 * migration 002 used. `ADD COLUMN` on a nullable column with no default is a metadata-only change
 * in SQLite: existing rows are untouched, no table is copied, and the operation is deterministic —
 * the same input database always produces the same output.
 *
 * ## What is not added
 *
 * No caption column, no tag column, no `JSON`, no mood or sentiment field, no created/updated
 * timestamps. The note is one string the user typed, and a note with metadata around it is a note
 * a machine is being asked to interpret.
 */
const DIARY_NOTE_MIGRATION = `
ALTER TABLE habit_log ADD COLUMN photo_note TEXT;
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: "001_initial", sql: INITIAL_SCHEMA },
  { version: "002_screen_time", sql: SCREEN_TIME_MIGRATION },
  { version: "003_diary_note", sql: DIARY_NOTE_MIGRATION },
];

const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;

export type MigrateResult = {
  applied: string[];
  alreadyCurrent: boolean;
};

/** Versions recorded as applied in the database. */
export function getAppliedVersions(database: DatabaseHandle): string[] {
  database.exec(CREATE_MIGRATIONS_TABLE);

  return database
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => (row as { version: string }).version);
}

/**
 * Applies every migration that has not been applied yet, in order.
 *
 * Each migration runs inside a transaction together with the insert that records it, so a
 * failure cannot leave a half-applied version recorded as complete. Re-running is safe:
 * applied versions are skipped.
 *
 * Fails if the database contains a version this code does not know about, which would mean
 * the database is newer than the code running against it.
 */
export function migrate(database: DatabaseHandle): MigrateResult {
  const applied = getAppliedVersions(database);
  const appliedSet = new Set(applied);

  const known = new Set(MIGRATIONS.map((migration) => migration.version));
  const unknown = applied.filter((version) => !known.has(version));

  if (unknown.length > 0) {
    throw new Error(
      `Database contains schema version(s) unknown to this code: ${unknown.join(", ")}. ` +
        `The database is newer than the application.`,
    );
  }

  const pending = MIGRATIONS.filter(
    (migration) => !appliedSet.has(migration.version),
  );

  if (pending.length === 0) {
    return { applied: [], alreadyCurrent: true };
  }

  const record = database.prepare(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
  );

  for (const migration of pending) {
    const run = database.transaction(() => {
      database.exec(migration.sql);
      record.run(migration.version, new Date().toISOString());
    });

    run();
  }

  return {
    applied: pending.map((migration) => migration.version),
    alreadyCurrent: false,
  };
}
