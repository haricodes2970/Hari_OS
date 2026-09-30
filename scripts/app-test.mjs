/**
 * Application tests: the vertical slice from submitted fields to persisted, visible state.
 *
 * Run with `npm run app:test`.
 *
 * These are the tests for the wiring that micro-phase 1.4 deliberately did not build. The
 * executor tests prove that a well-formed command does the right thing; they cannot prove
 * that a *person* can get one there. That gap is what this file closes, and it is where the
 * real bugs were: an amount that must not be money-scaled because it is a stock quantity, an
 * empty field that must not become a zero expense, a return path that must not become an open
 * redirect.
 *
 * Real SQLite throughout, no mocks, against a disposable database in the OS temp directory.
 * The development database at `data/hari-os.db` is never opened, and its fingerprint is
 * asserted unchanged at the end.
 *
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { createRepositories } from "../src/lib/db/repositories.ts";
import { migrate } from "../src/lib/db/migrations.ts";
import { executeCommand } from "../src/commands/executor.ts";
import { formatMinorUnits } from "../src/domain/money.ts";
import {
  formToCommand,
  safeReturnPath,
} from "../src/features/shared/command-form.ts";
import {
  describeOutcome,
  describeResult,
  tokenForError,
} from "../src/features/shared/outcomes.ts";

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

/**
 * A migrated, disposable database with the accounts and stock the commands need.
 *
 * Identical in shape to the fixture in `exec:test`, and set up by the same statements, so a
 * command that behaves here behaves in the application.
 */
function freshDatabase(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hari-os-app-${label}-`));
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

const FIXED_NOW = "2026-09-30T15:00:00.000Z";

/** Runs what the endpoint does: translate, then execute. */
function submit(database, entries) {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) {
    form.append(name, value);
  }

  const repositories = createRepositories(database);

  return executeCommand(formToCommand(form), {
    repositories,
    now: () => FIXED_NOW,
  });
}

function onions(database) {
  return database
    .prepare("SELECT quantity FROM inventory_item WHERE name = ?")
    .get("onions");
}

function cashBalance(database) {
  return database
    .prepare("SELECT balance FROM account WHERE name = ?")
    .get("cash").balance;
}

// ---------------------------------------------------------------------------
// Money formatting
// ---------------------------------------------------------------------------
console.log("\n# display formatting");

assertEqual(formatMinorUnits(0), "₹0.00", "zero formats as rupees and paise");
assertEqual(
  formatMinorUnits(5000),
  "₹50.00",
  "five thousand minor units is fifty rupees",
);
assertEqual(formatMinorUnits(5), "₹0.05", "one paisa is not rounded away");
assertEqual(formatMinorUnits(105), "₹1.05", "a mixed amount keeps both digits");
assertEqual(
  formatMinorUnits(-5000),
  "-₹50.00",
  "a negative balance keeps its sign",
);
assertEqual(
  formatMinorUnits(123456789),
  "₹1,234,567.89",
  "a large amount is grouped and exact, with no floating point tail",
);
assertEqual(
  formatMinorUnits(Number.NaN),
  "—",
  "an invalid balance renders as no number",
);

// ---------------------------------------------------------------------------
// Form translation
// ---------------------------------------------------------------------------
console.log("\n# form translation");

{
  const form = new FormData();
  form.append("kind", "expense.record");
  form.append("item", "banana");
  form.append("amount", "50");
  form.append("accountName", "cash");
  form.append("category", "groceries");
  form.append("next", "/expenses");

  const command = formToCommand(form);

  assertEqual(
    command.version,
    1,
    "every translated command carries the protocol version",
  );
  assertEqual(command.amount, 5000, "typed rupees become whole minor units");
  assertEqual(
    command.accountName,
    "cash",
    "the account name is the contract's field name",
  );
  assertEqual(
    "quantity" in command,
    false,
    "an absent field is omitted, not sent as empty",
  );
}

{
  const form = new FormData();
  form.append("kind", "inventory.consume");
  form.append("itemName", "onions");
  form.append("amount", "3");
  form.append("unit", "piece");

  const command = formToCommand(form);

  assertEqual(
    command.amount,
    3,
    "a stock quantity called amount is NOT scaled into money",
  );
  assertEqual(
    command.itemName,
    "onions",
    "inventory commands use itemName, not item",
  );
}

{
  const form = new FormData();
  form.append("kind", "expense.record");
  form.append("item", "x");
  form.append("amount", "");
  form.append("accountName", "cash");

  const command = formToCommand(form);

  assertEqual(
    "amount" in command,
    false,
    "an empty amount is omitted rather than becoming zero, which would be a free expense",
  );
}

{
  const form = new FormData();
  form.append("kind", "inventory.consume");
  form.append("itemName", "onions");
  form.append("amount", "2 onions");
  form.append("unit", "piece");

  const command = formToCommand(form);

  assertEqual(
    command.amount,
    "2 onions",
    "text that is not a number is forwarded untouched so validation, not the form, rejects it",
  );
}

{
  const form = new FormData();
  form.append("kind", "expense.record");
  form.append("item", "x");
  form.append("amount", "1.005");
  form.append("accountName", "cash");

  const command = formToCommand(form);

  assertEqual(
    command.amount,
    "1.005",
    "more precision than a paisa is refused by the domain and forwarded for reporting",
  );
}

// ---------------------------------------------------------------------------
// Return path safety
// ---------------------------------------------------------------------------
console.log("\n# return path safety");

assertEqual(safeReturnPath("/kitchen"), "/kitchen", "a same-site path is kept");
assertEqual(
  safeReturnPath("https://evil.example/steal"),
  "/kitchen",
  "an absolute URL is refused rather than used as a redirect",
);
assertEqual(
  safeReturnPath("//evil.example/steal"),
  "/kitchen",
  "a protocol-relative path is refused",
);
assertEqual(
  safeReturnPath(""),
  "/kitchen",
  "an absent return path falls back to a safe default",
);

// ---------------------------------------------------------------------------
// The vertical slice, end to end
// ---------------------------------------------------------------------------
console.log("\n# the vertical slice");

{
  const database = freshDatabase("slice");

  const result = submit(database, {
    kind: "inventory.consume",
    itemName: "onions",
    amount: "3",
    unit: "piece",
    next: "/kitchen",
  });

  assert(result.ok, "a submitted use is accepted");
  assertEqual(
    onions(database).quantity,
    7,
    "the quantity is persisted, 10 minus 3",
  );
  assertEqual(
    cashBalance(database),
    50000,
    "an inventory command leaves the account balance untouched",
  );

  const spend = submit(database, {
    kind: "expense.record",
    item: "banana",
    amount: "50",
    accountName: "cash",
    next: "/expenses",
  });

  assert(spend.ok, "a submitted expense is accepted");
  assertEqual(
    cashBalance(database),
    45000,
    "the balance is persisted, 50000 minus 5000",
  );
  assertEqual(
    formatMinorUnits(cashBalance(database)),
    "₹450.00",
    "the persisted balance formats correctly for display",
  );

  const expense = database.prepare("SELECT amount, account FROM expense").get();
  assertEqual(expense.amount, 5000, "the expense row holds minor units");
  assertEqual(
    expense.account,
    1,
    "the expense is linked to the resolved account row",
  );
  assertEqual(
    expense.amount === 5000 ? cashBalance(database) : 0,
    45000,
    "the balance change and the expense row are consistent",
  );

  const restock = submit(database, {
    kind: "inventory.restock",
    itemName: "onions",
    amount: "4",
    unit: "piece",
    next: "/kitchen",
  });

  assert(restock.ok, "a restock is accepted");
  assertEqual(
    onions(database).quantity,
    11,
    "a restock adds to the stored quantity",
  );

  const recount = submit(database, {
    kind: "inventory.set_quantity",
    itemName: "onions",
    quantity: "12",
    next: "/kitchen",
  });

  assert(recount.ok, "a recount is accepted");
  assertEqual(
    onions(database).quantity,
    12,
    "a recount states the absolute count",
  );

  database.close();
}

// ---------------------------------------------------------------------------
// Failures write nothing
// ---------------------------------------------------------------------------
console.log("\n# failures change nothing");

{
  const database = freshDatabase("failures");

  const before = {
    onions: onions(database).quantity,
    cash: cashBalance(database),
    expenses: database.prepare("SELECT COUNT(*) AS n FROM expense").get().n,
  };

  const attempts = [
    [
      "an unknown item",
      {
        kind: "inventory.consume",
        itemName: "xyz",
        amount: "1",
        unit: "piece",
      },
    ],
    [
      "more stock than exists",
      {
        kind: "inventory.consume",
        itemName: "onions",
        amount: "999",
        unit: "piece",
      },
    ],
    [
      "a unit the item is not tracked in",
      {
        kind: "inventory.consume",
        itemName: "onions",
        amount: "1",
        unit: "kg",
      },
    ],
    [
      "an unknown account",
      { kind: "expense.record", item: "x", amount: "5", accountName: "wallet" },
    ],
    [
      "a negative amount",
      { kind: "expense.record", item: "x", amount: "-5", accountName: "cash" },
    ],
    ["an unknown command kind", { kind: "nonsense" }],
  ];

  for (const [description, entries] of attempts) {
    const result = submit(database, entries);
    assert(result.ok === false, `${description} is refused`);
  }

  assertEqual(
    onions(database).quantity,
    before.onions,
    "the stock quantity is unchanged",
  );
  assertEqual(
    cashBalance(database),
    before.cash,
    "the cash balance is unchanged",
  );
  assertEqual(
    database.prepare("SELECT COUNT(*) AS n FROM expense").get().n,
    before.expenses,
    "no expense row was written by any failure",
  );

  database.close();
}

// ---------------------------------------------------------------------------
// Outcome reporting
// ---------------------------------------------------------------------------
console.log("\n# outcome reporting");

{
  const database = freshDatabase("outcomes");

  const refused = submit(database, {
    kind: "inventory.consume",
    itemName: "onions",
    amount: "999",
    unit: "piece",
  });

  assertEqual(
    refused.ok === false ? tokenForError(refused.error) : null,
    "insufficient_inventory",
    "a domain refusal reports a token that distinguishes it from a malformed submission",
  );

  const malformed = submit(database, { kind: "nonsense" });

  assertEqual(
    malformed.ok === false ? tokenForError(malformed.error) : null,
    "invalid_command",
    "a malformed submission reports a different token than a domain refusal",
  );

  const message = describeResult(refused);
  assert(
    message !== null && message.tone === "error",
    "a refusal renders as an error the user can act on",
  );
  assert(
    message !== null && message.detail.length > 0,
    "the refusal says something, rather than reporting only a code",
  );

  const rendered = describeOutcome("unknown_item", null);
  assert(
    rendered !== null && rendered.detail.includes("kitchen"),
    "an unknown item is explained in the user's own terms",
  );

  const unknownToken = describeOutcome("made_up_token", null);
  assert(
    unknownToken !== null && unknownToken.tone === "error",
    "an unrecognised token renders as a neutral failure, not as its own text",
  );

  assertEqual(
    describeOutcome(null, null),
    null,
    "no outcome token renders nothing at all",
  );

  database.close();
}

// ---------------------------------------------------------------------------
// Display reads
// ---------------------------------------------------------------------------
console.log("\n# display reads");

{
  const database = freshDatabase("reads");
  const { display } = createRepositories(database);

  submit(database, {
    kind: "expense.record",
    item: "banana",
    amount: "50",
    accountName: "cash",
    category: "groceries",
  });

  const inventory = display.listInventory();
  assertEqual(inventory.length, 2, "every tracked item is listed");
  assertEqual(inventory[0].name, "onions", "items are ordered by name");

  const accounts = display.listAccounts();
  assertEqual(accounts.length, 2, "every account is listed");
  assertEqual(
    accounts[0].name,
    "cash",
    "accounts are listed in the PRD's own order",
  );

  const expenses = display.recentExpenses(10);
  assertEqual(expenses.length, 1, "the recorded expense is listed");
  assertEqual(
    expenses[0].accountName,
    "cash",
    "the expense shows the account name, not its id",
  );

  const spend = display.spendForDate("2026-09-30");
  assertEqual(spend.total, 5000, "today's spend totals in minor units");
  assertEqual(
    spend.count,
    1,
    "the entry count is reported alongside the total",
  );

  assertEqual(
    display.spendForDate("1999-01-01").total,
    0,
    "a day with no spending totals zero rather than failing",
  );

  // `rice` has no threshold, so it can never be low; `onions` at 10 is not low either.
  assertEqual(
    inventory.filter(
      (item) =>
        item.lowThreshold !== null && item.quantity <= item.lowThreshold,
    ).length,
    0,
    "nothing is reported low while stock is above its threshold",
  );

  database.close();
}

// ---------------------------------------------------------------------------
// An empty database
// ---------------------------------------------------------------------------
console.log("\n# an empty database");

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hari-os-app-empty-"));
  tempDirs.push(dir);

  const database = new Database(path.join(dir, "empty.db"));
  migrate(database);

  const { display } = createRepositories(database);

  assertEqual(
    display.listInventory().length,
    0,
    "an unmigrated-data database lists no items",
  );
  assertEqual(
    display.listAccounts().length,
    0,
    "an unset-up database lists no accounts",
  );
  assertEqual(
    display.recentExpenses(5).length,
    0,
    "an unused database has no expenses",
  );
  assertEqual(
    display.spendForDate("2026-09-30").total,
    0,
    "spending on an empty day is zero",
  );
  assertEqual(
    display.tasksForDate("2026-09-30").length,
    0,
    "an empty day has no tasks",
  );
  assertEqual(formatMinorUnits(0), "₹0.00", "and a zero balance still renders");

  const result = submit(database, {
    kind: "inventory.consume",
    itemName: "onions",
    amount: "1",
    unit: "piece",
  });

  assertEqual(
    result.ok === false ? tokenForError(result.error) : null,
    "unknown_item",
    "a command against an unset-up database fails as an unknown item, not as a crash",
  );

  database.close();
}

// ---------------------------------------------------------------------------
// Development data must be untouched
// ---------------------------------------------------------------------------
console.log("\n# local data safety");

assertEqual(
  fingerprint(developmentDatabase),
  developmentFingerprintBefore,
  "data/hari-os.db was not read-modified or written by any test in this file",
);

for (const dir of tempDirs) {
  fs.rmSync(dir, { recursive: true, force: true });
}

assert(
  tempDirs.length > 0 && !tempDirs.some((dir) => fs.existsSync(dir)),
  "temporary databases were created and then removed",
);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
