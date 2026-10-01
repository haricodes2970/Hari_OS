/**
 * Isolated schema tests.
 *
 * Run with `npm run db:test`. Every test uses a disposable database created in the OS temp
 * directory. The real `data/hari-os.db` is never opened, written to, or dropped.
 *
 * This proves structural behaviour only: that the schema rejects invalid structure, that
 * migrations are reproducible and non-destructive, and that `db:check` fails when it should.
 * It deliberately does not test business behaviour, which belongs to micro-phase 1.2.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { migrate, getAppliedVersions } from "../src/lib/db/migrations.ts";
import { EXPECTED_TABLE_NAMES } from "../src/lib/db/schema.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

let passed = 0;
let failed = 0;
const tempDirs = [];

function ok(message) {
  passed += 1;
  console.log(`ok    ${message}`);
}

function bad(message) {
  failed += 1;
  console.error(`FAIL  ${message}`);
}

function tempDatabase(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hari-os-${label}-`));
  tempDirs.push(dir);
  return path.join(dir, "test.db");
}

function openFresh(label) {
  const file = tempDatabase(label);
  const database = new Database(file);
  database.pragma("foreign_keys = ON");
  return { file, database };
}

/** Asserts that inserting invalid structural data is rejected. */
function expectRejected(database, label, sql, params = []) {
  try {
    database.prepare(sql).run(...params);
    bad(`${label}: invalid row was accepted but should have been rejected`);
  } catch {
    ok(`${label}: rejected as expected`);
  }
}

function expectAccepted(database, label, sql, params = []) {
  try {
    database.prepare(sql).run(...params);
    ok(`${label}: accepted as expected`);
  } catch (error) {
    bad(`${label}: valid row was rejected — ${error.message}`);
  }
}

function tableNames(database) {
  return database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

// --- 1. fresh database -------------------------------------------------------

console.log("Fresh database");

{
  const { file, database } = openFresh("fresh");

  if (fs.existsSync(file) === false) {
    bad("database file was not created on open");
  } else {
    ok("database file created on demand");
  }

  const before = tableNames(database);
  if (before.length === 0) {
    ok("starts with an empty schema before migration");
  } else {
    bad(`expected an empty schema, found: ${before.join(", ")}`);
  }

  const first = migrate(database);
  if (
    first.applied.length === 2 &&
    first.applied[0] === "001_initial" &&
    first.applied[1] === "002_screen_time"
  ) {
    ok(
      "migrations 001_initial and 002_screen_time applied to a fresh database, in order",
    );
  } else {
    bad(`unexpected migration result: ${JSON.stringify(first.applied)}`);
  }

  const missing = EXPECTED_TABLE_NAMES.filter(
    (name) => !tableNames(database).includes(name),
  );
  if (missing.length === 0) {
    ok(`all ${EXPECTED_TABLE_NAMES.length} V1 tables created`);
  } else {
    bad(`missing tables: ${missing.join(", ")}`);
  }

  // Re-running must be a no-op, not a second application.
  const second = migrate(database);
  if (second.alreadyCurrent && second.applied.length === 0) {
    ok("re-running migrations applies nothing (idempotent)");
  } else {
    bad(`migrations were not idempotent: ${JSON.stringify(second)}`);
  }

  const versions = getAppliedVersions(database);
  if (versions.length === 2) {
    ok("schema_migrations records each version exactly once");
  } else {
    bad(`expected two recorded versions, found: ${versions.join(", ")}`);
  }

  database.close();
}

// --- 2. existing database is not destroyed -----------------------------------

console.log("\nExisting database");

{
  const { database } = openFresh("existing");
  migrate(database);

  expectAccepted(
    database,
    "seed a real account",
    "INSERT INTO account (name, balance) VALUES (?, ?)",
    ["cash", 50000],
  );

  const before = database
    .prepare("SELECT balance FROM account WHERE name = 'cash'")
    .get();

  migrate(database);
  migrate(database);

  const after = database
    .prepare("SELECT balance FROM account WHERE name = 'cash'")
    .get();

  if (
    before &&
    after &&
    before.balance === after.balance &&
    after.balance === 50000
  ) {
    ok("existing data survives repeated migration");
  } else {
    bad(
      `data was not preserved: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
    );
  }

  if (tableNames(database).includes("account")) {
    ok("no table was dropped by migration");
  } else {
    bad("migration dropped a table");
  }

  database.close();
}

// --- 3. fresh and already-initialized reach the same schema ------------------

console.log("\nSchema reproducibility");

{
  const a = openFresh("schema-a");
  const b = openFresh("schema-b");
  migrate(a.database);
  migrate(b.database);
  migrate(b.database);

  const sqlA = a.database
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  const sqlB = b.database
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();

  if (JSON.stringify(sqlA) === JSON.stringify(sqlB)) {
    ok("fresh and repeatedly-migrated databases have identical schema");
  } else {
    bad("schema differs between a fresh and an already-migrated database");
  }

  a.database.close();
  b.database.close();
}

// --- 4. structural constraints ----------------------------------------------

console.log("\nStructural constraints");

{
  const { database } = openFresh("constraints");
  migrate(database);

  expectAccepted(
    database,
    "account with a valid name",
    "INSERT INTO account (name, balance) VALUES ('cash', 0)",
  );
  expectRejected(
    database,
    "account with a name outside cash/bank1/bank2",
    "INSERT INTO account (name, balance) VALUES ('crypto', 0)",
  );
  expectRejected(
    database,
    "duplicate account name",
    "INSERT INTO account (name, balance) VALUES ('cash', 1)",
  );

  expectAccepted(
    database,
    "expense with a positive amount",
    "INSERT INTO expense (timestamp, item, amount, account) VALUES ('2026-09-30T10:00:00.000Z', 'banana', 1000, 1)",
  );
  expectRejected(
    database,
    "expense with a negative amount",
    "INSERT INTO expense (timestamp, item, amount, account) VALUES ('2026-09-30T10:00:00.000Z', 'x', -5, 1)",
  );
  expectRejected(
    database,
    "expense with a non-integer (float) amount",
    "INSERT INTO expense (timestamp, item, amount, account) VALUES ('2026-09-30T10:00:00.000Z', 'x', 10.5, 1)",
  );
  expectRejected(
    database,
    "expense referencing a missing account",
    "INSERT INTO expense (timestamp, item, amount, account) VALUES ('2026-09-30T10:00:00.000Z', 'x', 10, 999)",
  );

  expectAccepted(
    database,
    "inventory item with zero quantity",
    "INSERT INTO inventory_item (name, quantity, unit) VALUES ('onion', 0, 'piece')",
  );
  expectRejected(
    database,
    "inventory item with negative quantity",
    "INSERT INTO inventory_item (name, quantity, unit) VALUES ('rice', -1, 'kg')",
  );
  expectRejected(
    database,
    "duplicate inventory item name",
    "INSERT INTO inventory_item (name, quantity, unit) VALUES ('onion', 5, 'piece')",
  );
  expectRejected(
    database,
    "inventory item with a negative low_threshold",
    "INSERT INTO inventory_item (name, quantity, unit, low_threshold) VALUES ('x', 1, 'kg', -2)",
  );
  expectAccepted(
    database,
    "inventory item with a fractional quantity",
    "INSERT INTO inventory_item (name, quantity, unit) VALUES ('dal', 0.5, 'kg')",
  );
  expectRejected(
    database,
    "inventory item with a non-numeric quantity",
    "INSERT INTO inventory_item (name, quantity, unit) VALUES ('tea', 'lots', 'kg')",
  );

  expectRejected(
    database,
    "account with a fractional balance",
    "INSERT INTO account (name, balance) VALUES ('bank1', 10.5)",
  );
  expectAccepted(
    database,
    "account with a negative balance (overdrawn is allowed)",
    "INSERT INTO account (name, balance) VALUES ('bank2', -500)",
  );

  expectAccepted(
    database,
    "inventory event for a real item",
    "INSERT INTO inventory_event (item, delta, timestamp) VALUES (1, -2, '2026-09-30T10:00:00.000Z')",
  );
  expectAccepted(
    database,
    "inventory event with a fractional delta",
    "INSERT INTO inventory_event (item, delta, timestamp) VALUES (1, -0.5, '2026-09-30T10:00:00.000Z')",
  );
  expectRejected(
    database,
    "inventory event for a missing item",
    "INSERT INTO inventory_event (item, delta, timestamp) VALUES (999, -2, '2026-09-30T10:00:00.000Z')",
  );
  expectRejected(
    database,
    "inventory event with a non-numeric delta",
    "INSERT INTO inventory_event (item, delta, timestamp) VALUES (1, 'some', '2026-09-30T10:00:00.000Z')",
  );

  expectAccepted(
    database,
    "habit_log with a valid type",
    "INSERT INTO habit_log (date, type, done) VALUES ('2026-09-30', 'cooking', 1)",
  );
  expectRejected(
    database,
    "habit_log with an invalid type",
    "INSERT INTO habit_log (date, type, done) VALUES ('2026-09-30', 'shopping', 1)",
  );
  expectRejected(
    database,
    "habit_log with a non-boolean done",
    "INSERT INTO habit_log (date, type, done) VALUES ('2026-09-30', 'dishes', 2)",
  );
  expectRejected(
    database,
    "habit_log with a fractional done",
    "INSERT INTO habit_log (date, type, done) VALUES ('2026-09-30', 'dishes', 0.5)",
  );

  expectAccepted(
    database,
    "private_log with a valid type",
    "INSERT INTO private_log (date, type) VALUES ('2026-09-30', 'doom_scrolling')",
  );
  expectRejected(
    database,
    "private_log with an invalid type",
    "INSERT INTO private_log (date, type) VALUES ('2026-09-30', 'other')",
  );

  expectAccepted(
    database,
    "plan_task with a unique (date, title)",
    "INSERT INTO plan_task (date, title, done) VALUES ('2026-09-30', 'Write ADR', 0)",
  );
  expectRejected(
    database,
    "duplicate plan_task for the same date and title",
    "INSERT INTO plan_task (date, title, done) VALUES ('2026-09-30', 'Write ADR', 0)",
  );
  expectAccepted(
    database,
    "second plan_task with a different title on the same date",
    "INSERT INTO plan_task (date, title, done) VALUES ('2026-09-30', 'Ship 1.2', 0)",
  );

  expectAccepted(
    database,
    "sleep_log for a date",
    "INSERT INTO sleep_log (date, phone_outside) VALUES ('2026-09-30', 1)",
  );
  expectRejected(
    database,
    "second sleep_log for the same date",
    "INSERT INTO sleep_log (date, phone_outside) VALUES ('2026-09-30', 0)",
  );

  expectAccepted(
    database,
    "skill",
    "INSERT INTO skill (name, active) VALUES ('Read a book', 1)",
  );
  expectRejected(
    database,
    "duplicate skill name",
    "INSERT INTO skill (name, active) VALUES ('Read a book', 0)",
  );

  expectAccepted(
    database,
    "skill_log with minutes",
    "INSERT INTO skill_log (skill, timestamp, minutes) VALUES (1, '2026-09-30T10:00:00.000Z', 30)",
  );
  expectAccepted(
    database,
    "skill_log without minutes",
    "INSERT INTO skill_log (skill, timestamp) VALUES (1, '2026-09-30T10:00:00.000Z')",
  );
  expectRejected(
    database,
    "skill_log with negative minutes",
    "INSERT INTO skill_log (skill, timestamp, minutes) VALUES (1, '2026-09-30T10:00:00.000Z', -5)",
  );
  expectRejected(
    database,
    "skill_log with fractional minutes",
    "INSERT INTO skill_log (skill, timestamp, minutes) VALUES (1, '2026-09-30T10:00:00.000Z', 1.5)",
  );
  expectRejected(
    database,
    "skill_log for a missing skill",
    "INSERT INTO skill_log (skill, timestamp) VALUES (999, '2026-09-30T10:00:00.000Z')",
  );

  expectRejected(
    database,
    "plan_task with a NULL title",
    "INSERT INTO plan_task (date, title) VALUES ('2026-09-30', NULL)",
  );

  database.close();
}

// --- 5. db:check must fail when the schema is wrong -------------------------

console.log("\ndb:check failure detection");

function runDbCheck(databasePath) {
  try {
    const output = execFileSync(
      process.execPath,
      ["--conditions=react-server", "scripts/db-check.mjs"],
      {
        cwd: projectRoot,
        env: { ...process.env, HARI_OS_DB_PATH: databasePath },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return { code: 0, output: output + "" };
  } catch (error) {
    return {
      code: error.status ?? 1,
      output: (error.stdout ?? "") + (error.stderr ?? ""),
    };
  }
}

{
  const missingTable = tempDatabase("missing-table");
  const setup = new Database(missingTable);
  setup.pragma("foreign_keys = ON");
  migrate(setup);
  setup.exec("DROP TABLE habit_log");
  setup.close();

  const result = runDbCheck(missingTable);
  if (result.code !== 0 && result.output.includes("habit_log")) {
    ok("db:check fails when a required table is removed");
  } else {
    bad(`db:check did not fail on a missing table (exit ${result.code})`);
  }
}

{
  const unexpectedTable = tempDatabase("unexpected-table");
  const setup = new Database(unexpectedTable);
  setup.pragma("foreign_keys = ON");
  migrate(setup);
  setup.exec("CREATE TABLE secret_analytics (id INTEGER PRIMARY KEY)");
  setup.close();

  const result = runDbCheck(unexpectedTable);
  if (result.code !== 0 && result.output.includes("secret_analytics")) {
    ok("db:check fails when an unexpected table is present");
  } else {
    bad(`db:check did not fail on an unexpected table (exit ${result.code})`);
  }
}

{
  const missingColumn = tempDatabase("missing-column");
  const setup = new Database(missingColumn);
  setup.pragma("foreign_keys = ON");
  migrate(setup);
  setup.exec(
    "DROP TABLE account; CREATE TABLE account (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)",
  );
  setup.close();

  const result = runDbCheck(missingColumn);
  if (result.code !== 0 && result.output.includes("balance")) {
    ok("db:check fails when a required column is missing");
  } else {
    bad(`db:check did not fail on a missing column (exit ${result.code})`);
  }
}

{
  const good = tempDatabase("good");
  const setup = new Database(good);
  setup.pragma("foreign_keys = ON");
  migrate(setup);
  setup.close();

  const result = runDbCheck(good);
  if (result.code === 0) {
    ok("db:check passes for a correct schema");
  } else {
    bad(`db:check failed for a correct schema: ${result.output}`);
  }
}

// --- 6. a database from newer code is refused --------------------------------

console.log("\nUnknown schema version");

{
  const future = tempDatabase("future");
  const setup = new Database(future);
  migrate(setup);
  setup
    .prepare(
      "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
    )
    .run("999_from_the_future", new Date().toISOString());
  setup.close();

  const result = runDbCheck(future);
  if (result.code !== 0 && result.output.includes("999_from_the_future")) {
    ok("a database newer than the code is refused with a clear error");
  } else {
    bad(`unknown schema version was not refused (exit ${result.code})`);
  }
}

// --- cleanup -----------------------------------------------------------------

for (const dir of tempDirs) {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`temporary databases removed: ${tempDirs.length}`);

if (failed > 0) {
  process.exitCode = 1;
}
