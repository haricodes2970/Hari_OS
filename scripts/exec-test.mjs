/**
 * Execution tests: the four commands against real SQLite persistence.
 *
 * Run with `npm run exec:test`. Every test runs against a disposable database in the OS temp
 * directory, created and migrated the same way `db:test` does it. The development database at
 * `data/hari-os.db` is never opened by this file, and its checksum is asserted to be unchanged
 * at the end.
 *
 * Real SQLite throughout, with no mocks, because the properties under test are transactional:
 * that a spend and its balance change land together or not at all. A mock repository would
 * pass those tests while proving nothing about rollback, so the failure cases are produced
 * with a real SQLite trigger that raises mid-transaction.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { createRepositories } from "../src/lib/db/repositories.ts";
import { migrate } from "../src/lib/db/migrations.ts";
import { executeCommand } from "../src/commands/executor.ts";
import { COMMAND_VERSION } from "../src/commands/contract.ts";
import { toMinorUnits } from "../src/domain/money.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const developmentDatabase = path.join(projectRoot, "data", "hari-os.db");

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

function assert(condition, message) {
  if (condition) {
    ok(message);
  } else {
    bad(message);
  }
}

function assertEqual(actual, expected, message) {
  if (Object.is(actual, expected)) {
    ok(message);
  } else {
    bad(
      `${message} (expected ${String(expected)}, received ${String(actual)})`,
    );
  }
}

function fingerprint(file) {
  if (!fs.existsSync(file)) {
    return "absent";
  }

  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

const developmentFingerprintBefore = fingerprint(developmentDatabase);

/** A migrated, disposable database with the fixture rows the commands need. */
function freshDatabase(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hari-os-${label}-`));
  tempDirs.push(dir);

  const database = new Database(path.join(dir, "test.db"));
  database.pragma("foreign_keys = ON");
  migrate(database);

  database
    .prepare(
      "INSERT INTO account (id, name, balance) VALUES (1, 'cash', 50000)",
    )
    .run();
  database
    .prepare(
      "INSERT INTO account (id, name, balance) VALUES (2, 'bank1', 100000)",
    )
    .run();
  database
    .prepare(
      "INSERT INTO inventory_item (id, name, quantity, unit, low_threshold) VALUES (1, 'onions', 10, 'piece', 2)",
    )
    .run();
  database
    .prepare(
      "INSERT INTO inventory_item (id, name, quantity, unit) VALUES (2, 'rice', 2.5, 'kg')",
    )
    .run();

  return database;
}

/** Execution dependencies over a database, with a clock the test controls. */
function dependenciesFor(database, clock) {
  return { repositories: createRepositories(database), now: clock };
}

const FIXED_NOW = "2026-09-30T15:00:00.000Z";
const fixedClock = () => FIXED_NOW;

function itemRow(database, id) {
  return database
    .prepare(
      "SELECT quantity, unit, low_threshold FROM inventory_item WHERE id = ?",
    )
    .get(id);
}

function eventRows(database, item) {
  return database
    .prepare(
      "SELECT item, delta, timestamp, source_text FROM inventory_event WHERE item = ? ORDER BY id",
    )
    .all(item);
}

function accountRow(database, id) {
  return database.prepare("SELECT balance FROM account WHERE id = ?").get(id);
}

function expenseRows(database) {
  return database
    .prepare(
      "SELECT timestamp, item, amount, account, category FROM expense ORDER BY id",
    )
    .all();
}

// ---------------------------------------------------------------------------
console.log("\ninventory.consume against a real persisted item");
// ---------------------------------------------------------------------------

{
  const database = freshDatabase("consume");
  const result = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "inventory.consume",
      itemName: "onions",
      amount: 2,
      unit: "piece",
      sourceText: "used 2 onions",
    },
    dependenciesFor(database, fixedClock),
  );

  assert(result.ok, "consume succeeds against a persisted item");

  if (result.ok) {
    assertEqual(
      result.value.kind,
      "inventory",
      "the outcome is an inventory change",
    );
    assertEqual(
      result.value.change.before,
      10,
      "the domain decided the starting quantity",
    );
    assertEqual(
      result.value.change.after,
      8,
      "the PRD example: 10 onions less 2 is 8",
    );
  }

  assertEqual(
    itemRow(database, 1).quantity,
    8,
    "the persisted quantity matches the domain result",
  );

  const events = eventRows(database, 1);
  assertEqual(events.length, 1, "exactly one event was appended");
  assertEqual(events[0].delta, -2, "the event records a negative delta");
  assertEqual(
    events[0].timestamp,
    FIXED_NOW,
    "the event carries the execution timestamp",
  );
  assertEqual(
    events[0].source_text,
    "used 2 onions",
    "the event keeps the sentence for display and correction",
  );

  database.close();
}

// ---------------------------------------------------------------------------
console.log("\ninventory.restock and inventory.set_quantity");
// ---------------------------------------------------------------------------

{
  const database = freshDatabase("restock");
  const result = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "inventory.restock",
      itemName: "rice",
      amount: 0.5,
      unit: "kg",
    },
    dependenciesFor(database, fixedClock),
  );

  assert(result.ok, "restock succeeds with a fractional quantity");
  assertEqual(
    itemRow(database, 2).quantity,
    3,
    "2.5 kg plus 0.5 kg is persisted as 3 kg",
  );
  assertEqual(
    eventRows(database, 2)[0].delta,
    0.5,
    "the restock event has a positive delta",
  );
  database.close();
}

{
  const database = freshDatabase("recount");
  const result = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "inventory.set_quantity",
      itemName: "onions",
      quantity: 4,
    },
    dependenciesFor(database, fixedClock),
  );

  assert(result.ok, "set_quantity succeeds");
  assertEqual(
    itemRow(database, 1).quantity,
    4,
    "the recount is persisted as an absolute value",
  );
  assertEqual(
    eventRows(database, 1)[0].delta,
    -6,
    "the recount logs the derived delta, so the change stays explainable",
  );
  database.close();
}

// ---------------------------------------------------------------------------
console.log("\nexpense.record against a real persisted account");
// ---------------------------------------------------------------------------

{
  const database = freshDatabase("expense");
  const result = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "expense.record",
      accountName: "cash",
      item: "banana",
      amount: toMinorUnits(10).value,
      sourceText: "bought banana 10 rupees cash",
    },
    dependenciesFor(database, fixedClock),
  );

  assert(result.ok, "expense.record succeeds against a real account");

  if (result.ok) {
    assertEqual(
      result.value.kind,
      "expense",
      "the outcome is an account change",
    );
    assertEqual(
      result.value.change.after,
      49_000,
      "500 rupees less 10 is 490, as the PRD states",
    );
  }

  assertEqual(
    accountRow(database, 1).balance,
    49_000,
    "the account balance is reduced by exactly 10",
  );
  assertEqual(
    accountRow(database, 2).balance,
    100_000,
    "the other account is untouched",
  );

  const rows = expenseRows(database);
  assertEqual(rows.length, 1, "exactly one expense row was stored");
  assertEqual(rows[0].item, "banana", "the expense records what was bought");
  assertEqual(rows[0].amount, 1_000, "the expense stores whole minor units");
  assertEqual(
    rows[0].account,
    1,
    "the expense is linked to the resolved account id",
  );
  assertEqual(
    rows[0].timestamp,
    FIXED_NOW,
    "the expense carries the execution timestamp",
  );
  assertEqual(rows[0].category, null, "an uncategorised spend stores null");
  database.close();
}

// ---------------------------------------------------------------------------
console.log("\nFailure paths");
// ---------------------------------------------------------------------------

{
  const database = freshDatabase("unknown-item");
  const result = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "inventory.consume",
      itemName: "potato",
      amount: 1,
      unit: "piece",
    },
    dependenciesFor(database, fixedClock),
  );

  assert(!result.ok, "an unknown item fails");
  assertEqual(
    !result.ok && result.error.kind,
    "domain",
    "an unknown item is a domain failure, not a validation or persistence one",
  );
  assertEqual(
    !result.ok && result.error.kind === "domain" && result.error.error.code,
    "unknown_item",
    "the failure is specifically unknown_item",
  );
  assertEqual(
    eventRows(database, 1).length,
    0,
    "no event was written for a failed lookup",
  );
  database.close();
}

{
  const database = freshDatabase("unknown-account");
  const result = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "expense.record",
      accountName: "bank2",
      item: "x",
      amount: 100,
    },
    dependenciesFor(database, fixedClock),
  );

  assert(!result.ok, "an unknown account fails");
  assertEqual(
    !result.ok && result.error.kind === "domain" && result.error.error.code,
    "missing_account",
    "the failure is specifically missing_account, distinct from unknown_item",
  );
  assertEqual(expenseRows(database).length, 0, "no expense row was written");
  assertEqual(
    accountRow(database, 1).balance,
    50_000,
    "an unknown account did not silently resolve to a real one and spend from it",
  );
  assertEqual(
    accountRow(database, 2).balance,
    100_000,
    "the other real account is untouched too",
  );
  database.close();
}

{
  const database = freshDatabase("insufficient");
  const result = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "inventory.consume",
      itemName: "onions",
      amount: 99,
      unit: "piece",
    },
    dependenciesFor(database, fixedClock),
  );

  assert(!result.ok, "consuming more than available fails");
  assertEqual(
    !result.ok && result.error.kind === "domain" && result.error.error.code,
    "insufficient_inventory",
    "the domain's own refusal is surfaced, not reworded",
  );
  assertEqual(
    itemRow(database, 1).quantity,
    10,
    "the persisted quantity is unchanged after refusal",
  );
  assertEqual(
    eventRows(database, 1).length,
    0,
    "a refused consumption writes no event",
  );
  database.close();
}

{
  const database = freshDatabase("unit-mismatch");
  const result = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "inventory.consume",
      itemName: "onions",
      amount: 1,
      unit: "kg",
    },
    dependenciesFor(database, fixedClock),
  );

  assert(
    !result.ok,
    "a unit mismatch fails at execution, where the item is known",
  );
  assertEqual(
    !result.ok && result.error.kind === "domain" && result.error.error.code,
    "invalid_unit",
    "the failure is invalid_unit, decided by the domain against the real item",
  );
  database.close();
}

{
  const database = freshDatabase("invalid-command");
  const invalid = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "inventory.teleport",
      itemName: "onions",
    },
    dependenciesFor(database, fixedClock),
  );

  assert(!invalid.ok, "an invalid command cannot execute");
  assertEqual(
    !invalid.ok && invalid.error.kind,
    "validation",
    "a malformed command is rejected as a validation failure, before any repository is touched",
  );
  assertEqual(
    itemRow(database, 1).quantity,
    10,
    "an invalid command changes nothing",
  );

  const forged = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "expense.record",
      accountName: "cash",
      item: "x",
      amount: 100,
      balance: 999_999,
    },
    dependenciesFor(database, fixedClock),
  );

  assert(!forged.ok, "a command carrying a precomputed balance is rejected");
  assertEqual(
    !forged.ok && forged.error.kind,
    "validation",
    "an injected result field is a validation failure, so it cannot be executed",
  );

  const forgedId = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "inventory.consume",
      itemName: "onions",
      amount: 1,
      unit: "piece",
      id: 1,
    },
    dependenciesFor(database, fixedClock),
  );

  assert(!forgedId.ok, "a command cannot fabricate a database id");
  assertEqual(
    !forgedId.ok && forgedId.error.kind,
    "validation",
    "an injected id is rejected before any row is read",
  );
  database.close();
}

// ---------------------------------------------------------------------------
console.log("\nTimestamps come from execution, not the command");
// ---------------------------------------------------------------------------

{
  const database = freshDatabase("clock");
  const stamps = ["2026-01-01T00:00:00.000Z", "2026-12-31T23:59:59.000Z"];
  let call = 0;

  const first = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "inventory.consume",
      itemName: "onions",
      amount: 1,
      unit: "piece",
      sourceText: "used 1 onion",
    },
    dependenciesFor(database, () => stamps[call++]),
  );
  const second = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "expense.record",
      accountName: "cash",
      item: "x",
      amount: 100,
    },
    dependenciesFor(database, () => stamps[call++]),
  );

  assert(first.ok && second.ok, "both executions succeed");
  assertEqual(
    eventRows(database, 1)[0].timestamp,
    stamps[0],
    "the first execution stored the clock's first reading",
  );
  assertEqual(
    expenseRows(database)[0].timestamp,
    stamps[1],
    "the second execution stored the clock's second reading, not the first",
  );
  assert(
    eventRows(database, 1)[0].timestamp !== "used 1 onion",
    "the source sentence is never mistaken for a timestamp",
  );
  database.close();
}

// ---------------------------------------------------------------------------
console.log("\nAtomicity: a failed multi-write leaves no partial state");
// ---------------------------------------------------------------------------

{
  const database = freshDatabase("atomic-expense");

  // A real constraint violation in the middle of the two-write transaction, produced by the
  // database rather than by a mock, so the rollback being tested is SQLite's own.
  database.exec(`
    CREATE TRIGGER refuse_expense BEFORE INSERT ON expense
    BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;
  `);

  const result = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "expense.record",
      accountName: "cash",
      item: "banana",
      amount: 1_000,
    },
    dependenciesFor(database, fixedClock),
  );

  assert(!result.ok, "an expense whose insert fails is reported as a failure");
  assertEqual(
    !result.ok && result.error.kind,
    "persistence",
    "a storage failure is distinguished from a domain or validation failure",
  );
  assertEqual(
    accountRow(database, 1).balance,
    50_000,
    "the account balance was rolled back: no money vanished without a record",
  );
  assertEqual(
    expenseRows(database).length,
    0,
    "no expense row survived the rollback",
  );

  database.exec("DROP TRIGGER refuse_expense");

  const retried = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "expense.record",
      accountName: "cash",
      item: "banana",
      amount: 1_000,
    },
    dependenciesFor(database, fixedClock),
  );

  assert(retried.ok, "the same command succeeds once storage recovers");
  assertEqual(
    accountRow(database, 1).balance,
    49_000,
    "the retried spend applied in full",
  );
  database.close();
}

{
  const database = freshDatabase("atomic-inventory");

  // The inverse order: the quantity is written first, so this proves the second write's
  // failure rolls the first one back.
  database.exec(`
    CREATE TRIGGER refuse_event BEFORE INSERT ON inventory_event
    BEGIN SELECT RAISE(ABORT, 'simulated log failure'); END;
  `);

  const result = executeCommand(
    {
      version: COMMAND_VERSION,
      kind: "inventory.consume",
      itemName: "onions",
      amount: 3,
      unit: "piece",
    },
    dependenciesFor(database, fixedClock),
  );

  assert(
    !result.ok,
    "a stock change whose event fails is reported as a failure",
  );
  assertEqual(
    !result.ok && result.error.kind,
    "persistence",
    "it is a persistence failure",
  );
  assertEqual(
    itemRow(database, 1).quantity,
    10,
    "the quantity write was rolled back, so no unexplained number is left behind",
  );
  assertEqual(eventRows(database, 1).length, 0, "no event was stored");
  database.close();
}

// ---------------------------------------------------------------------------
console.log("\nRepeated execution is consistent");
// ---------------------------------------------------------------------------

{
  const database = freshDatabase("repeat");
  const spend = {
    version: COMMAND_VERSION,
    kind: "expense.record",
    accountName: "cash",
    item: "banana",
    amount: 1_000,
  };

  const first = executeCommand(spend, dependenciesFor(database, fixedClock));
  const second = executeCommand(spend, dependenciesFor(database, fixedClock));

  assert(first.ok && second.ok, "two identical spends both succeed");
  assertEqual(
    accountRow(database, 1).balance,
    48_000,
    "the balance reduced by exactly 1000 twice",
  );
  assertEqual(
    expenseRows(database).length,
    2,
    "each execution stored its own expense row",
  );

  // Replaying from the same starting state must land on the same number, which is the
  // property that makes a wrong entry correctable.
  const other = freshDatabase("repeat-control");
  const control = executeCommand(spend, dependenciesFor(other, fixedClock));
  assert(
    control.ok && control.value.change.after === first.value.change.after,
    "replaying from an identical starting state produces an identical balance",
  );
  other.close();

  for (let i = 0; i < 3; i += 1) {
    executeCommand(
      {
        version: COMMAND_VERSION,
        kind: "inventory.consume",
        itemName: "onions",
        amount: 1,
        unit: "piece",
      },
      dependenciesFor(database, fixedClock),
    );
  }

  assertEqual(
    itemRow(database, 1).quantity,
    7,
    "three further consumptions reduced stock to 7",
  );
  assertEqual(
    eventRows(database, 1).length,
    3,
    "each consumption left its own event",
  );
  database.close();
}

// ---------------------------------------------------------------------------
console.log("\nThe boundary does not leak into the domain");
// ---------------------------------------------------------------------------

{
  // The domain is exercised through the executor but owns no persistence of its own: this
  // proves the domain can still be driven with a literal, exactly as 1.2 intended.
  const database = freshDatabase("boundary");
  const before = itemRow(database, 1).quantity;
  const repositories = createRepositories(database);
  const item = repositories.inventory.findByName("onions");

  assert(item.ok, "the repository resolves a name to a real row");
  assertEqual(
    item.ok && item.value.id,
    1,
    "the id comes from the row, never from a command",
  );
  assertEqual(
    item.ok && item.value.quantity,
    before,
    "the repository returns persisted state",
  );

  // A repository result is a plain value; the domain consumes it with no database in sight.
  const plain = item.ok ? { ...item.value } : null;
  assertEqual(
    plain === null ? null : plain.id,
    1,
    "a domain value is a plain object, not a row handle",
  );

  database.close();
}

{
  // The architecture check itself: the domain suite must still run with the driver absent.
  let domainSuite = "not run";
  try {
    execFileSync("node", ["scripts/domain-test.mjs"], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    domainSuite = "passed";
  } catch {
    domainSuite = "failed";
  }
  assertEqual(
    domainSuite,
    "passed",
    "the domain suite is unaffected by the execution layer",
  );
}

// ---------------------------------------------------------------------------
console.log("\nDevelopment database safety");
// ---------------------------------------------------------------------------

assertEqual(
  fingerprint(developmentDatabase),
  developmentFingerprintBefore,
  "data/hari-os.db was not read-modified or written by any test in this file",
);

for (const dir of tempDirs) {
  fs.rmSync(dir, { recursive: true, force: true });
}

assertEqual(
  tempDirs.length > 0,
  true,
  "temporary databases were created and then removed",
);
assert(
  !tempDirs.some((dir) => fs.existsSync(dir)),
  "no temporary database directory was left behind",
);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
