/**
 * Phase 5 Dashboard tests: the read model, its sources, and its honesty about what does not exist.
 *
 * Run with `npm run dashboard:test`.
 *
 * ## The database, established first
 *
 * `HARI_OS_DB_PATH` is set at module top level and every module that can reach storage is
 * imported afterwards with `await import`, for the reason `kitchen-test.mjs` sets out in full:
 * the composition root resolves the path on first open and caches the handle, so a static import
 * would write to the real `data/hari-os.db`. The fingerprint of that file is taken before
 * anything is imported and asserted at the end, so a repeat of the mistake fails rather than
 * passing quietly.
 *
 * ## What these tests are actually for
 *
 * An aggregating screen is mostly a claim about where its numbers came from. So the sections
 * below assert provenance rather than appearance: that low stock is the domain's `isLowStock`
 * applied to persisted rows, that today's spend is the same value the daily bill prints, and
 * that a module which does not exist produces an unavailable state rather than a plausible
 * number. A Dashboard that rendered `₹0.00` for a day it could not add up would look identical
 * to this one in a screenshot, and be lying.
 *
 * Real SQLite throughout, no mocks. The development database is never opened.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;

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

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const developmentDatabase = path.join(projectRoot, "data", "hari-os.db");

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

// --- the disposable database, before anything that can open one --------------
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "hari-os-dashboard-"));
const scratchFile = path.join(scratchDir, "dashboard.db");
process.env.HARI_OS_DB_PATH = scratchFile;

const { default: Database } = await import("better-sqlite3");
const { migrate } = await import("../src/lib/db/migrations.ts");
const { runCommand, getRepositories, releaseDatabase } =
  await import("../src/features/shared/command-runtime.ts");
// The Kitchen route is the module that dispatches its four operations, so the tests drive the
// same entry point the page does rather than calling the feature functions behind it.
const { runKitchenOperation } = await import("../src/app/api/kitchen/route.ts");
const { readDashboard, SKILLS_AVAILABLE, TOP_TASK_LIMIT } =
  await import("../src/features/dashboard/view.ts");
const { readDailyBill } = await import("../src/features/expenses/view.ts");
const { HABIT_TYPES } = await import("../src/domain/habits.ts");
const { COMMAND_VERSION } = await import("../src/commands/contract.ts");
const commandsRoute = await import("../src/app/api/commands/route.ts");
const POST_COMMANDS = commandsRoute.POST;
const { isSameOriginRequest } =
  await import("../src/features/shared/same-origin.ts");

migrate(new Database(scratchFile));

let scratch = new Database(scratchFile);
scratch.pragma("foreign_keys = ON");

const row = (sql, ...args) => scratch.prepare(sql).get(...args);
const all = (sql, ...args) => scratch.prepare(sql).all(...args);

/** Empties every table and re-seeds the three PRD accounts, as `npm run db:setup` would. */
function reset() {
  scratch.exec(`
    DELETE FROM inventory_event;
    DELETE FROM expense;
    DELETE FROM inventory_item;
    DELETE FROM account;
    DELETE FROM plan_task;
    DELETE FROM habit_log;
  `);
  for (const [id, name, balance] of [
    [1, "cash", 50000],
    [2, "bank1", 100000],
    [3, "bank2", 250000],
  ]) {
    scratch
      .prepare("INSERT INTO account (id, name, balance) VALUES (?, ?, ?)")
      .run(id, name, balance);
  }
}

function addItem({ name, quantity, unit, lowThreshold = "" }) {
  return runKitchenOperation(
    new Map(
      Object.entries({
        operation: "add_item",
        name,
        quantity,
        unit,
        lowThreshold,
      }),
    ),
  );
}

function setThreshold(name, lowThreshold) {
  return runKitchenOperation(
    new Map(
      Object.entries({
        operation: "set_threshold",
        itemId: String(
          row("SELECT id FROM inventory_item WHERE name = ?", name).id,
        ),
        lowThreshold: String(lowThreshold),
      }),
    ),
  );
}

function command(command_) {
  return runCommand(command_);
}

function spend({ item, amount, accountName, category = null }) {
  return command({
    version: COMMAND_VERSION,
    kind: "expense.record",
    item,
    amount,
    accountName,
    category,
  });
}

/** An expense stamped on a chosen day, bypassing the command clock on purpose. */
function spendOn(timestamp, { item, amount, accountName }) {
  const accountId = row(
    "SELECT id FROM account WHERE name = ?",
    accountName,
  ).id;

  scratch
    .prepare(
      "INSERT INTO expense (timestamp, item, amount, account, category) VALUES (?, ?, ?, ?, NULL)",
    )
    .run(timestamp, item, amount, accountId);
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 1-5. low stock is the domain's rule applied to persisted rows",
);

{
  reset();
  addItem({ name: "onions", quantity: 10, unit: "pieces", lowThreshold: 3 });
  addItem({ name: "rice", quantity: 2, unit: "kg" });

  // 4: above its threshold.
  assertEqual(
    readDashboard().lowStock.length,
    0,
    "4. an item above its threshold is absent from the low-stock list",
  );
  assertEqual(
    readDashboard().inventoryCount,
    2,
    "1. both tracked items are counted, low or not",
  );

  // 2: exactly on it.
  setThreshold("onions", 10);
  assertEqual(
    readDashboard().lowStock.length,
    1,
    "2. an item exactly at its threshold is low — the rule is <=, not <",
  );
  assertEqual(
    readDashboard().lowStock[0].name,
    "onions",
    "1. and it is the right item",
  );

  // 3: below it.
  setThreshold("onions", 11);
  assertEqual(
    readDashboard().lowStock.length,
    1,
    "3. an item below its threshold is low",
  );

  // 5: zero stock, with a threshold that makes zero low.
  setThreshold("onions", 0.5);
  command({
    version: COMMAND_VERSION,
    kind: "inventory.set_quantity",
    itemName: "onions",
    quantity: 0,
    sourceText: "counted 0 onions",
  });
  const empty = readDashboard();

  assertEqual(
    empty.lowStock.length,
    1,
    "5. an item at zero is low when its threshold makes zero low",
  );
  assertEqual(
    empty.lowStock[0].quantity,
    0,
    "5. and its zero is shown as zero",
  );

  // A threshold of zero is stored, and under `quantity <= threshold` it flags an item only
  // while the item is at zero. ADR-048 settled the Phase 5 discrepancy in favour of this
  // behaviour; ARCHITECTURE.md section 15 now says the same thing. What matters to the
  // Dashboard is that the behaviour is the domain's and is asserted here, not restated.
  setThreshold("onions", 0);
  assertEqual(
    readDashboard().lowStock.length,
    1,
    "a threshold of zero flags an item that is at zero, and nothing else",
  );

  command({
    version: COMMAND_VERSION,
    kind: "inventory.restock",
    itemName: "onions",
    amount: 1,
    unit: "pieces",
    sourceText: "bought 1 onion",
  });

  assertEqual(
    readDashboard().lowStock.length,
    0,
    "1. one piece above a zero threshold is not low",
  );

  setThreshold("onions", "");
  assertEqual(
    readDashboard().lowStock.length,
    0,
    "1. an item with no threshold is never low, even at zero",
  );

  // The low-stock flag is the domain's, not the view's.
  const { isLowStock } = await import("../src/domain/inventory.ts");
  const rows = getRepositories().display.listInventory();

  assert(
    rows.every(
      (item) =>
        isLowStock(item) ===
        readDashboard().lowStock.some((line) => line.id === item.id),
    ),
    "1. the Dashboard's low-stock list is exactly the set the domain marks low",
  );
}

{
  // 25, 26: a Kitchen mutation moves the Dashboard, and restocking clears it.
  reset();
  addItem({ name: "onions", quantity: 10, unit: "pieces", lowThreshold: 3 });
  assertEqual(
    readDashboard().lowStock.length,
    0,
    "25. healthy stock is not listed",
  );

  command({
    version: COMMAND_VERSION,
    kind: "inventory.consume",
    itemName: "onions",
    amount: 8,
    unit: "pieces",
    sourceText: "used 8 onions",
  });

  const low = readDashboard();

  assertEqual(
    low.lowStock.length,
    1,
    "25. a Kitchen command puts the item on the Dashboard",
  );
  assertEqual(
    low.lowStock[0].quantity,
    2,
    "25. with the quantity that was actually persisted",
  );

  command({
    version: COMMAND_VERSION,
    kind: "inventory.restock",
    itemName: "onions",
    amount: 5,
    unit: "pieces",
    sourceText: "restocked 5 onions",
  });

  assertEqual(
    readDashboard().lowStock.length,
    0,
    "26. restocking removes it from the Dashboard without changing the threshold",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 6-10. today's spend comes from the same rows as the bill");

{
  reset();
  addItem({ name: "onions", quantity: 10, unit: "pieces", lowThreshold: 3 });
  addItem({ name: "rice", quantity: 2, unit: "kg" });

  // 7: nothing spent.
  const quiet = readDashboard();

  assertEqual(
    quiet.spend.computed,
    true,
    "7. an empty day is computed, not skipped",
  );
  assertEqual(quiet.spend.total, 0, "7. and its total is zero");
  assertEqual(
    quiet.spend.formattedTotal,
    "₹0.00",
    "7. which renders as a real amount",
  );
  assertEqual(quiet.spend.count, 0, "7. with no entries behind it");

  // 6, 8: one entry, then several.
  assert(
    spend({ item: "banana", amount: 1000, accountName: "cash" }).ok,
    "6. an expense is accepted",
  );
  assertEqual(
    readDashboard().spend.total,
    1000,
    "6. one expense is the day's total",
  );
  assertEqual(readDashboard().spend.count, 1, "6. counted as one entry");

  spend({ item: "rice", amount: 2500, accountName: "bank1" });
  spend({ item: "milk", amount: 350, accountName: "cash", category: "dairy" });

  // 9: three accounts, one total.
  const day = readDashboard();

  assertEqual(
    day.spend.total,
    3850,
    "9. expenses across all three accounts are one total",
  );
  assertEqual(day.spend.count, 3, "9. counted as three entries");
  assertEqual(
    day.spend.formattedTotal,
    "₹38.50",
    "6. the Dashboard's figure is formatted by the domain's formatter",
  );

  // 6: the Dashboard's number and the bill's number are the same number.
  const bill = readDailyBill(day.date);

  assertEqual(
    bill.total,
    day.spend.total,
    "6. the daily bill totals the same amount",
  );
  assertEqual(
    bill.count,
    day.spend.count,
    "6. from the same number of entries",
  );
  assert(
    bill.text.includes(day.spend.formattedTotal),
    "6. and the bill text contains the figure the Dashboard shows",
  );
  assertEqual(
    day.spend.total,
    row(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM expense WHERE substr(timestamp, 1, 10) = ?",
      day.date,
    ).total,
    "6. the domain total and the SQL aggregate over the same rows agree",
  );

  // 10: the day boundary, in both directions.
  const yesterday = new Date(`${day.date}T00:00:00.000Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const tomorrow = new Date(`${day.date}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  spendOn(`${yesterday.toISOString().slice(0, 10)}T09:00:00.000Z`, {
    item: "yesterday",
    amount: 9999,
    accountName: "cash",
  });
  spendOn(`${tomorrow.toISOString().slice(0, 10)}T09:00:00.000Z`, {
    item: "tomorrow",
    amount: 8888,
    accountName: "cash",
  });

  assertEqual(
    readDashboard().spend.total,
    3850,
    "10. yesterday's and tomorrow's expenses are both excluded from today",
  );
  assertEqual(
    readDashboard(day.date).spend.total,
    3850,
    "10. asking for that day directly gives the same figure",
  );
  assertEqual(
    readDashboard(yesterday.toISOString().slice(0, 10)).spend.total,
    9999,
    "10. and yesterday's own day holds only yesterday's entry",
  );

  // 27: a recorded expense moves the Dashboard.
  spend({ item: "eggs", amount: 600, accountName: "bank2" });
  assertEqual(
    readDashboard().spend.total,
    4450,
    "27. recording an expense changes the Dashboard's total",
  );

  // 8: a negative balance is a balance, not a spend.
  reset();
  scratch.prepare("UPDATE account SET balance = 100 WHERE name = 'cash'").run();
  spend({ item: "bus", amount: 5000, accountName: "cash" });

  assertEqual(
    row("SELECT balance FROM account WHERE name = 'cash'").balance,
    -4900,
    "an expense may overdraw an account (ADR-021)",
  );
  assertEqual(
    readDashboard().spend.total,
    5000,
    "8. and an overdrawn account still reports the day's real spend",
  );
  assert(
    readDailyBill(readDashboard().date).text.includes("₹50.00"),
    "8. the bill agrees with the Dashboard on the overdrawn day",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 11-14. empty states, and modules that do not exist");

{
  // 13: a fresh database, migrated and never set up.
  scratch.exec(`
    DELETE FROM inventory_event;
    DELETE FROM expense;
    DELETE FROM inventory_item;
    DELETE FROM account;
    DELETE FROM plan_task;
    DELETE FROM habit_log;
  `);

  const empty = readDashboard();

  assertEqual(empty.inventoryCount, 0, "13. a fresh database tracks nothing");
  assertEqual(
    empty.lowStock.length,
    0,
    "11. an empty inventory has no low-stock rows",
  );
  assertEqual(empty.spend.total, 0, "12. an empty database has no spend");
  assertEqual(empty.spend.computed, true, "12. and a zero day still computes");
  assertEqual(empty.taskCount, 0, "14. and no task exists to invent one from");
  assertEqual(
    empty.suggestedFirstAction,
    null,
    "14. the suggested action is absent, not a placeholder",
  );
  assertEqual(
    empty.habits.length,
    0,
    "14. no habit is reported that was never recorded",
  );
  assertEqual(
    empty.skillsAvailable,
    false,
    "14. the Skills list is declared unavailable rather than shown empty",
  );

  // 14: the model carries exactly the fields the page renders, and no others.
  assertEqual(
    Object.keys(empty).sort().join(","),
    [
      "consistencyDays",
      "date",
      "habits",
      "inventoryCount",
      "lowStock",
      "skillsAvailable",
      "sleep",
      "spend",
      "suggestedFirstAction",
      "taskCount",
      "tasks",
      "tomorrowPlanned",
    ].join(","),
    "14. the read model exposes no field the page does not need",
  );
}

{
  // 20-22: the future modules are absent from storage, and the model still answers.
  reset();
  assertEqual(
    row("SELECT COUNT(*) AS n FROM skill").n,
    0,
    "no skill rows exist",
  );
  assertEqual(
    row("SELECT COUNT(*) AS n FROM sleep_log").n,
    0,
    "no sleep rows exist",
  );

  const dashboard = readDashboard();

  assertEqual(dashboard.skillsAvailable, false, "20. Skills is not available");
  assertEqual(
    SKILLS_AVAILABLE,
    false,
    "20. and the flag says so, not a data-dependent guess",
  );
  assert(
    !Object.values(dashboard).some(
      (value) =>
        Array.isArray(value) &&
        value.length > 0 &&
        !(value[0] && "type" in value[0]),
    ),
    "14. no future module contributed a list to the model",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# the task area uses real plan_task rows and nothing else");

{
  reset();
  const empty = readDashboard();

  assertEqual(empty.tasks.length, 0, "an unplanned day has no tasks");
  assertEqual(
    empty.suggestedFirstAction,
    null,
    "and no suggested first action, because there is nothing to suggest from",
  );

  // Rows a future Routine phase would write. Nothing in src/ creates these; they are inserted
  // here the way that phase's command would, so the read model is tested against real data.
  for (const [date, title] of [
    ["1999-01-01", "not today"],
    [readDashboard().date, "read a book"],
    [readDashboard().date, "vibe code"],
    [readDashboard().date, "pushups"],
    [readDashboard().date, "research"],
  ]) {
    scratch
      .prepare("INSERT INTO plan_task (date, title, done) VALUES (?, ?, 0)")
      .run(date, title);
  }

  const planned = readDashboard();

  assertEqual(planned.taskCount, 4, "only today's tasks are counted");
  assertEqual(
    planned.tasks.length,
    TOP_TASK_LIMIT,
    "the PRD's top 3 is a display cap",
  );
  assertEqual(
    planned.tasks.map((task) => task.title).join(", "),
    "read a book, vibe code, pushups",
    "and the three shown are the first three written, in order",
  );
  assertEqual(
    planned.suggestedFirstAction,
    "read a book",
    "the suggested first action is the first task not yet done",
  );

  scratch
    .prepare("UPDATE plan_task SET done = 1 WHERE title = 'read a book'")
    .run();

  const afterOne = readDashboard();

  assertEqual(
    afterOne.suggestedFirstAction,
    "vibe code",
    "finishing the first task moves the suggestion to the next one",
  );
  assertEqual(
    afterOne.tasks[0].done,
    true,
    "a done task is still shown, marked — not hidden",
  );

  scratch.exec("UPDATE plan_task SET done = 1 WHERE date = plan_task.date");
  const allDone = readDashboard();

  assertEqual(allDone.taskCount, 4, "the count survives every task being done");
  assertEqual(
    allDone.suggestedFirstAction,
    null,
    "and a finished day has no suggestion, without one being invented",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# the habit area reports rows, and nothing but rows");

{
  reset();
  const today = readDashboard().date;

  assertEqual(
    readDashboard().habits.length,
    0,
    "nothing is claimed about laundry or dishes when no row exists",
  );

  scratch
    .prepare(
      "INSERT INTO habit_log (date, type, done, photo_url) VALUES (?, 'dishes', 1, NULL), (?, 'laundry', 1, '/tmp/x.jpg')",
    )
    .run(today, today);

  const logged = readDashboard();

  assertEqual(logged.habits.length, 2, "a recorded habit is read back");
  assertEqual(
    logged.habits.find((entry) => entry.type === "dishes").hasPhoto,
    false,
    "dishes has no photo attached",
  );
  assertEqual(
    logged.habits.find((entry) => entry.type === "laundry").hasPhoto,
    true,
    "laundry reports that a photo is attached, without exposing the path",
  );
  assertEqual(
    all("SELECT type FROM habit_log WHERE date = ?", "1999-01-01").length,
    0,
    "another day is not mixed in",
  );

  // The domain's closed set and the schema's CHECK must agree.
  const ddl = row(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'habit_log'",
  ).sql;

  assert(
    HABIT_TYPES.every((type) => ddl.includes(`'${type}'`)) &&
      !["sleeping", "exercise"].some((type) => ddl.includes(`'${type}'`)),
    "the domain's habit list matches the schema's CHECK",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 31. no second calculation of the day's money");

{
  const dashboardSource = fs.readFileSync(
    path.join(projectRoot, "src/features/dashboard/view.ts"),
    "utf8",
  );
  const pageSource = fs.readFileSync(
    path.join(projectRoot, "src/app/page.tsx"),
    "utf8",
  );

  assert(
    !dashboardSource.includes("spendForDate"),
    "31. the Dashboard does not use the SQL aggregate, so it cannot disagree with the bill",
  );
  assert(
    !/\.reduce\(|SUM\(/u.test(pageSource) &&
      !/\.reduce\(|SUM\(/u.test(dashboardSource),
    "31. neither the page nor the read model sums anything",
  );
  assert(
    pageSource.includes("@/features/dashboard/view"),
    "31. the page reads through the read model rather than the database",
  );
  assert(
    !/better-sqlite3|lib\/db|SELECT /u.test(pageSource),
    "31. the page contains no SQL and no driver import",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 37. the write guard is still in place around the pages");

{
  assertEqual(
    isSameOriginRequest(
      new Request("http://localhost:3000/api/commands", {
        headers: { origin: "http://localhost:3000", host: "localhost:3000" },
      }),
    ),
    true,
    "a same-origin request is allowed",
  );
  assertEqual(
    isSameOriginRequest(
      new Request("http://localhost:3000/api/commands", {
        headers: { origin: "https://evil.example", host: "localhost:3000" },
      }),
    ),
    false,
    "a cross-origin request is refused",
  );

  reset();
  const before = row("SELECT COUNT(*) AS n FROM expense").n;

  const refused = await POST_COMMANDS(
    new Request("http://localhost:3000/api/commands", {
      method: "POST",
      body: new URLSearchParams({
        kind: "expense.record",
        item: "attacker",
        amount: "10",
        accountName: "cash",
      }).toString(),
      headers: {
        origin: "https://evil.example",
        host: "localhost:3000",
        "content-type": "application/x-www-form-urlencoded",
      },
    }),
  );

  assertEqual(
    refused.status,
    403,
    "a cross-origin command is refused with 403",
  );
  assertEqual(
    row("SELECT COUNT(*) AS n FROM expense").n,
    before,
    "and no expense was recorded by the refused request",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# the development database is untouched");

assertEqual(
  fingerprint(developmentDatabase),
  developmentFingerprintBefore,
  "data/hari-os.db was not read-modified or written by any test in this file",
);

releaseDatabase();
if (scratch.open) {
  scratch.close();
}
fs.rmSync(scratchDir, { recursive: true, force: true });

assertEqual(
  fs.existsSync(scratchDir),
  false,
  "the disposable database and its directory were removed",
);

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
