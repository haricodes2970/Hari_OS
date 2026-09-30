/**
 * Verifies the local SQLite foundation from a clean checkout.
 *
 * Run with `npm run db:check`. It creates the database if missing, reports the
 * resolved path and SQLite configuration, and fails if any Hari OS feature table
 * exists. Schema work belongs to a later phase, so an empty schema is the
 * expected result.
 */
import fs from "node:fs";

import {
  checkDb,
  closeDb,
  getDb,
  getDatabasePath,
} from "../src/lib/db/connection.ts";

const FEATURE_TABLES = [
  "plan_task",
  "sleep_log",
  "nap_log",
  "inventory_item",
  "inventory_event",
  "account",
  "expense",
  "skill",
  "skill_log",
  "habit_log",
  "private_log",
];

function fail(message) {
  console.error(`FAIL  ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`ok    ${message}`);
}

const databasePath = getDatabasePath();

console.log(`Hari OS database check\n  path: ${databasePath}\n`);

// Opening is what creates the file and its directory, so this must come first.
const status = checkDb();

if (fs.existsSync(databasePath)) {
  pass("database file and directory created on demand");
} else {
  fail(`database file was not created at ${databasePath}`);
}

pass(`opened, SQLite ${status.sqliteVersion}`);
pass(`journal_mode = ${status.journalMode}`);

if (status.foreignKeys) {
  pass("foreign_keys = ON");
} else {
  fail("foreign_keys is not enabled");
}

const usingOverride = Boolean(
  process.env.HARI_OS_DB_PATH && process.env.HARI_OS_DB_PATH.trim().length > 0,
);

if (usingOverride) {
  pass(`using HARI_OS_DB_PATH override: ${status.path}`);
} else if (status.path.startsWith(process.cwd())) {
  pass("database resolves inside the project root");
} else {
  fail(`database resolved outside the project root: ${status.path}`);
}

const tables = getDb()
  .prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  )
  .all()
  .map((row) => row.name);

const leaked = tables.filter((name) => FEATURE_TABLES.includes(name));

if (leaked.length > 0) {
  fail(`feature schema leaked into the foundation: ${leaked.join(", ")}`);
} else if (tables.length === 0) {
  pass("no application tables exist (correct for phase 0)");
} else {
  pass(`no feature tables; unrelated tables present: ${tables.join(", ")}`);
}

closeDb();
pass("closed cleanly");
