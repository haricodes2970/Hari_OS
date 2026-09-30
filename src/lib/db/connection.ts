import "server-only";
import { migrate } from "./migrations.ts";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

export type DatabaseHandle = Database.Database;

const DATABASE_FILE = "hari-os.db";
const DATA_DIRECTORY = "data";

/**
 * Resolves the absolute path of the SQLite file.
 *
 * The path is derived from the project root, so it is never machine-specific.
 * `HARI_OS_DB_PATH` overrides it and exists for tests and future tooling; it is
 * optional and unset in normal local development.
 */
export function getDatabasePath(): string {
  const override = process.env.HARI_OS_DB_PATH;

  if (override && override.trim().length > 0) {
    return path.resolve(override.trim());
  }

  return path.join(process.cwd(), DATA_DIRECTORY, DATABASE_FILE);
}

function openDatabase(): DatabaseHandle {
  const databasePath = getDatabasePath();

  try {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });

    const database = new Database(databasePath);

    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");

    return database;
  } catch (cause) {
    throw new Error(
      `Failed to open the Hari OS database at ${databasePath}. ` +
        `Delete the file and restart to recreate it.`,
      { cause },
    );
  }
}

/**
 * Next.js reloads modules in development, which would otherwise open a new
 * connection per reload. Caching on globalThis keeps a single handle alive
 * for the lifetime of the process.
 */
const globalForDb = globalThis as unknown as {
  __hariOsDb?: DatabaseHandle;
};

/**
 * Opens the database on first use and returns the shared handle.
 *
 * The file and its directory are created automatically, and the schema is brought up to date
 * on the way. Migrating here is deliberate and is **not** the same thing as seeding:
 *
 * - Creating tables is idempotent, describes the shape the code expects, and depends on
 *   nothing the user did. Running it on every open is what lets a brand-new database work
 *   immediately instead of failing every query with `no such table`.
 * - Creating *rows* — accounts, stock — is not idempotent in meaning, depends on decisions
 *   only the user can make, and stays in `npm run db:setup`.
 *
 * The two are separated precisely so that opening a database can never be the act of
 * inventing user state.
 */
export function getDb(): DatabaseHandle {
  if (!globalForDb.__hariOsDb) {
    const database = openDatabase();
    migrate(database);
    globalForDb.__hariOsDb = database;
  }

  return globalForDb.__hariOsDb;
}

/** Closes the shared handle. Intended for scripts and tests, not for request handling. */
export function closeDb(): void {
  if (globalForDb.__hariOsDb) {
    globalForDb.__hariOsDb.close();
    globalForDb.__hariOsDb = undefined;
  }
}

/**
 * Confirms the database is reachable and reports its state.
 * Used by the `db:check` script; performs no writes.
 */
export function checkDb(): {
  path: string;
  sqliteVersion: string;
  journalMode: string;
  foreignKeys: boolean;
} {
  const database = getDb();
  const databasePath = getDatabasePath();

  const row = database.prepare("SELECT sqlite_version() AS version").get() as {
    version: string;
  };

  const pragmas = database.pragma("journal_mode", { simple: true });
  const foreignKeys = database.pragma("foreign_keys", { simple: true });

  return {
    path: databasePath,
    sqliteVersion: row.version,
    journalMode: String(pragmas),
    foreignKeys: foreignKeys === 1,
  };
}
