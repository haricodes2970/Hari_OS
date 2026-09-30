/**
 * Verifies the local SQLite schema.
 *
 * Run with `npm run db:check`. Creates the database if missing, applies pending migrations,
 * then verifies the live schema against the expected V1 schema declared in
 * `src/lib/db/schema.ts`. Performs no data writes and never inserts sample rows.
 */
import fs from "node:fs";

import {
  checkDb,
  closeDb,
  getDb,
  getDatabasePath,
} from "../src/lib/db/connection.ts";
import { getAppliedVersions, migrate } from "../src/lib/db/migrations.ts";
import {
  EXPECTED_CONSTRAINTS,
  EXPECTED_TABLE_NAMES,
  EXPECTED_TABLES,
  INFRASTRUCTURE_TABLES,
} from "../src/lib/db/schema.ts";

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
  fail(
    "foreign_keys is not enabled; foreign key constraints would not be enforced",
  );
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

// --- migrations -------------------------------------------------------------

const database = getDb();
const result = migrate(database);

if (result.alreadyCurrent) {
  pass("schema already at the latest migration");
} else {
  pass(`applied migration(s): ${result.applied.join(", ")}`);
}

const appliedVersions = getAppliedVersions(database);
pass(`schema_migrations records: ${appliedVersions.join(", ") || "none"}`);

// --- tables -----------------------------------------------------------------

const tableSql = database
  .prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  )
  .all();

const found = new Map(tableSql.map((row) => [row.name, row.sql ?? ""]));

const missingTables = EXPECTED_TABLE_NAMES.filter((name) => !found.has(name));
const missingInfra = INFRASTRUCTURE_TABLES.filter((name) => !found.has(name));

if (missingInfra.length > 0) {
  fail(`missing infrastructure table(s): ${missingInfra.join(", ")}`);
} else {
  pass(`infrastructure tables present: ${INFRASTRUCTURE_TABLES.join(", ")}`);
}

if (missingTables.length > 0) {
  fail(`missing expected V1 table(s): ${missingTables.join(", ")}`);
} else {
  pass(`all ${EXPECTED_TABLE_NAMES.length} V1 tables present`);
}

const expectedAll = new Set([
  ...EXPECTED_TABLE_NAMES,
  ...INFRASTRUCTURE_TABLES,
]);
const unexpected = [...found.keys()].filter((name) => !expectedAll.has(name));

if (unexpected.length > 0) {
  fail(`unexpected table(s) present: ${unexpected.join(", ")}`);
} else {
  pass("no unexpected tables");
}

// --- columns ----------------------------------------------------------------

let columnProblems = 0;

for (const [table, expectedColumns] of Object.entries(EXPECTED_TABLES)) {
  if (!found.has(table)) {
    continue;
  }

  const actual = database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name);
  const absent = expectedColumns.filter((column) => !actual.includes(column));

  if (absent.length > 0) {
    fail(`${table} is missing column(s): ${absent.join(", ")}`);
    columnProblems += 1;
  }
}

if (columnProblems === 0) {
  pass("every V1 table has its expected columns");
}

// --- structural constraints -------------------------------------------------

let constraintProblems = 0;

for (const [table, fragments] of Object.entries(EXPECTED_CONSTRAINTS)) {
  if (!found.has(table)) {
    continue;
  }

  const sql = found.get(table);
  const missing = fragments.filter((fragment) => !sql.includes(fragment));

  if (missing.length > 0) {
    fail(
      `${table} is missing expected constraint(s): ${missing.map((m) => `"${m}"`).join(", ")}`,
    );
    constraintProblems += 1;
  }
}

if (constraintProblems === 0) {
  pass("every expected structural constraint is present");
}

closeDb();
pass("closed cleanly");
