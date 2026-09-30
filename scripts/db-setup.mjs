/**
 * Explicit first-run setup: creates the accounts and example stock the commands need.
 *
 * Run with `npm run db:setup`.
 *
 * ## Why this is a script and not application code
 *
 * `expense.record` resolves an account name to an account row, and `inventory.consume`
 * resolves an item name to a tracked item. On an empty database neither exists, so every
 * command would fail with `missing_account` or `unknown_item` and the application would look
 * broken when in fact it has simply never been set up.
 *
 * The tempting fix — inserting default rows the first time a page renders — is deliberately
 * rejected. It would write user state as a side effect of reading a screen, it would make
 * the database content depend on which page was opened, and it would fabricate financial
 * balances. So nothing in `src/` creates rows: setup happens here, when a person runs it and
 * chooses to.
 *
 * ## What it writes
 *
 * - The three accounts from the PRD, each at a balance of **zero**. Zero is the honest
 *   opening balance: this project does not know the user's money, and inventing a figure
 *   would be exactly the kind of plausible fabrication the PRD forbids. There is no command
 *   for setting an opening balance in this phase, so an account currently reads `₹0.00`
 *   until one is recorded.
 * - Two example stock items, so the Kitchen page has something to act on. There is no
 *   "create item" command in this phase either. They are ordinary rows and can be deleted.
 *
 * ## Idempotence
 *
 * Every insert is skipped when the row already exists, so running it twice changes nothing
 * and running it after real use has begun will not reset a balance or a quantity.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeDb, getDatabasePath, getDb } from "../src/lib/db/connection.ts";
import { migrate } from "../src/lib/db/migrations.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The accounts the PRD defines, with ids fixed so the script is deterministic. */
const ACCOUNTS = [
  { id: 1, name: "cash" },
  { id: 2, name: "bank1" },
  { id: 3, name: "bank2" },
];

/** Example stock. Real quantities the user is expected to correct. */
const ITEMS = [
  { id: 1, name: "onions", quantity: 10, unit: "piece", lowThreshold: 3 },
  { id: 2, name: "rice", quantity: 2.5, unit: "kg", lowThreshold: 1 },
  { id: 3, name: "milk", quantity: 1, unit: "litre", lowThreshold: 2 },
];

const databasePath = getDatabasePath();
const created = !fs.existsSync(databasePath);

const database = getDb();

const result = migrate(database);

console.log(`Database: ${path.relative(projectRoot, databasePath)}`);
if (created) {
  console.log("  created");
} else {
  console.log(
    `  already present (schema at version ${result.version ?? "current"})`,
  );
}

const insertAccount = database.prepare(
  "INSERT INTO account (id, name, balance) VALUES (?, ?, 0)",
);
const accountExists = database.prepare("SELECT 1 FROM account WHERE name = ?");

let accountsAdded = 0;
for (const account of ACCOUNTS) {
  if (accountExists.get(account.name) === undefined) {
    insertAccount.run(account.id, account.name);
    accountsAdded += 1;
  }
}

const insertItem = database.prepare(
  "INSERT INTO inventory_item (id, name, quantity, unit, low_threshold) VALUES (?, ?, ?, ?, ?)",
);
const itemExists = database.prepare(
  "SELECT 1 FROM inventory_item WHERE name = ?",
);

let itemsAdded = 0;
for (const item of ITEMS) {
  if (itemExists.get(item.name) === undefined) {
    insertItem.run(
      item.id,
      item.name,
      item.quantity,
      item.unit,
      item.lowThreshold,
    );
    itemsAdded += 1;
  }
}

closeDb();

console.log(
  `\nAccounts: ${ACCOUNTS.length - accountsAdded} present, ${accountsAdded} added`,
);
console.log(
  `Stock items: ${ITEMS.length - itemsAdded} present, ${itemsAdded} added`,
);
console.log(
  accountsAdded + itemsAdded === 0
    ? "\nNothing to do — this database was already set up."
    : "\nSetup complete. Start the app with `npm run dev`.",
);
console.log(
  "\nOpening balances are zero and the stock quantities are examples. Correct them by\n" +
    "deleting the rows from the database if they are not yours.",
);

// The development database must never be left half-initialised by a failed run, and the
// script must not silently modify a database outside the project.
if (
  !databasePath.startsWith(projectRoot) &&
  process.env.HARI_OS_DB_PATH !== undefined
) {
  console.warn(
    `\nNote: ${databasePath} is outside the project because HARI_OS_DB_PATH is set.`,
  );
}
