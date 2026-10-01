/**
 * Phase 3 Kitchen tests: persistence, the feature boundary, the HTTP route, and end to end.
 *
 * Run with `npm run kitchen:test`.
 *
 * ## The database, established first
 *
 * `HARI_OS_DB_PATH` is set at module top level, and every module that can touch storage is
 * imported *afterwards* with `await import`. That ordering is the whole point of this file.
 *
 * Phase 2 shipped a test that created a fresh database per case while importing the engine
 * statically. The engine reaches storage through the composition root, which resolves the
 * path from `HARI_OS_DB_PATH` the first time it opens a connection and then caches the handle,
 * so that test wrote to the real `data/hari-os.db`. Nothing was written — every command failed
 * as `unknown_item`, because the development database has no inventory rows — but the test was
 * exercising the wrong database and passing for the wrong reason. Isolation has to be in place
 * before the first import, not added afterwards.
 *
 * The fingerprint of `data/hari-os.db` is captured before anything is imported and asserted at
 * the end, so a repeat of that mistake fails the suite instead of passing quietly.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

let passed = 0;
let failed = 0;

function ok(message) {
  passed += 1;
  console.log(`ok    ${message}`);
}

function bad(message) {
  failed += 1;
  console.log(`FAIL  ${message}`);
}

function assert(condition, message) {
  if (condition) {
    ok(message);
  } else {
    bad(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    ok(message);
  } else {
    bad(
      `${message} (expected ${String(expected)}, received ${String(actual)})`,
    );
  }
}

function assertRefused(result, code, message) {
  assertEqual(result.ok, false, `${message} — refused`);
  assertEqual(
    result.ok ? null : result.error.code,
    code,
    `${message} — reported as ${code}`,
  );
}

/**
 * For a route result, whose failure carries a closed-set token rather than a domain code.
 *
 * Separate from the helper above on purpose. The two are different vocabularies, and asserting
 * one against the other is how a refusal could start passing while saying nothing.
 */
function assertRefusedToken(result, token, message) {
  assertEqual(result.ok, false, `${message} — refused`);
  assertEqual(
    result.ok ? null : result.token,
    token,
    `${message} — reported as ${token}`,
  );
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
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "hari-os-kitchen-"));
const scratchFile = path.join(scratchDir, "kitchen.db");
process.env.HARI_OS_DB_PATH = scratchFile;

const { migrate } = await import("../src/lib/db/migrations.ts");
const { createRepositories } = await import("../src/lib/db/repositories.ts");
const { runCommand, getRepositories, releaseDatabase } =
  await import("../src/features/shared/command-runtime.ts");
const { correctInventoryEntry } =
  await import("../src/features/kitchen/correction.ts");
const { runKitchenOperation, POST, GET } =
  await import("../src/app/api/kitchen/route.ts");
const { parseCommand } = await import("../src/lib/validation/command.ts");
const { interpret } = await import("../src/commands/parser.ts");
const { COMMAND_VERSION } = await import("../src/commands/contract.ts");

migrate(new Database(scratchFile));

let scratch = new Database(scratchFile);
scratch.pragma("foreign_keys = ON");

const rows = (sql, ...args) => scratch.prepare(sql).all(...args);
const row = (sql, ...args) => scratch.prepare(sql).get(...args);

/** Clears every table and re-seeds the three PRD accounts, as `npm run db:setup` would. */
function reset() {
  scratch.exec(`
    DELETE FROM inventory_event;
    DELETE FROM expense;
    DELETE FROM inventory_item;
    DELETE FROM account;
  `);
  scratch
    .prepare(
      "INSERT INTO account (id, name, balance) VALUES (1, 'cash', 50000)",
    )
    .run();
  scratch
    .prepare(
      "INSERT INTO account (id, name, balance) VALUES (2, 'bank1', 100000)",
    )
    .run();
}

/** An operation result, run through the route's dispatch rather than called directly. */
function submit(fields) {
  return runKitchenOperation(new Map(Object.entries(fields)));
}

function readStock(name) {
  return row(
    "SELECT quantity, unit, low_threshold FROM inventory_item WHERE name = ?",
    name,
  );
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 16-19. inventory rows, quantities, thresholds, and events persist",
);

{
  reset();

  const added = submit({
    operation: "add_item",
    name: "onions",
    quantity: "10",
    unit: "pieces",
    lowThreshold: "3",
  });
  assert(added.ok, "16. an item can be started");
  assertEqual(
    added.ok ? added.message : null,
    "Now tracking onions, starting at 10 pieces.",
    "16. and the opening quantity is confirmed",
  );

  const stored = readStock("onions");
  assertEqual(stored.quantity, 10, "16. the quantity is persisted");
  assertEqual(stored.unit, "pieces", "16. the unit is persisted");
  assertEqual(stored.low_threshold, 3, "19. the threshold is persisted");

  // The opening quantity is logged, so the number is explainable from the log alone.
  const opening = row("SELECT delta FROM inventory_event WHERE item = 1");
  assertEqual(
    opening.delta,
    10,
    "18. the opening quantity is an event, not a bare number",
  );

  // 17: a movement persists its quantity and its event together.
  const used = runCommand({
    version: COMMAND_VERSION,
    kind: "inventory.consume",
    itemName: "onions",
    amount: 2,
    unit: "pieces",
    sourceText: "used 2 onions",
  });
  assert(used.ok, "17. a consumption executes");
  assertEqual(readStock("onions").quantity, 8, "17. the quantity is persisted");
  assertEqual(
    row("SELECT COUNT(*) AS n FROM inventory_event").n,
    2,
    "18. one event per change, including this one",
  );
  assertEqual(
    row("SELECT source_text FROM inventory_event ORDER BY id DESC LIMIT 1")
      .source_text,
    "used 2 onions",
    "18. the sentence is stored with the change, so it can be traced and corrected",
  );

  // 19: a threshold change persists and moves nothing.
  const threshold = submit({
    operation: "set_threshold",
    itemId: "1",
    lowThreshold: "5",
  });
  assert(threshold.ok, "19. a threshold can be changed");
  assertEqual(
    readStock("onions").low_threshold,
    5,
    "19. the new threshold is persisted",
  );
  assertEqual(
    readStock("onions").quantity,
    8,
    "19. and the quantity did not move",
  );
  assertEqual(
    row("SELECT COUNT(*) AS n FROM inventory_event").n,
    2,
    "19. a threshold is not a movement, so it writes no event",
  );

  const cleared = submit({
    operation: "set_threshold",
    itemId: "1",
    lowThreshold: "",
  });
  assert(cleared.ok, "19. a threshold can be cleared");
  assertEqual(
    readStock("onions").low_threshold,
    null,
    "19. and clearing is persisted",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 20-21. lookups resolve, and a wrong name resolves nothing");

{
  reset();
  submit({
    operation: "add_item",
    name: "onions",
    quantity: "10",
    unit: "pieces",
    lowThreshold: "",
  });
  submit({
    operation: "add_item",
    name: "rice",
    quantity: "2",
    unit: "kg",
    lowThreshold: "",
  });

  const repositories = createRepositories(new Database(scratchFile));
  assertEqual(
    repositories.inventory.findByName("onions").ok,
    true,
    "20. a tracked name resolves",
  );
  assertEqual(
    repositories.inventory.findByName("ONIONS").ok
      ? repositories.inventory.findByName("ONIONS").value.id
      : null,
    1,
    "20. and matching stays case-insensitive",
  );
  assertRefused(
    repositories.inventory.findByName("basil"),
    "unknown_item",
    "21. an untracked name",
  );
  // Trimming is deliberate, so "rice " is the same name. What must not resolve is a
  // *different* name a fuzzy match could plausibly reach: a prefix, and a plural.
  assertRefused(
    repositories.inventory.findByName("ric"),
    "unknown_item",
    "21. a prefix does not resolve the full name",
  );
  assertRefused(
    repositories.inventory.findByName("rices"),
    "unknown_item",
    "21. nor does a plural",
  );
  assertEqual(
    repositories.inventory.findByName(" rice ").ok,
    true,
    "21. but surrounding space is the same name",
  );
  assertRefused(
    repositories.inventory.findByName(""),
    "unknown_item",
    "21. an empty name",
  );
  assertRefused(
    repositories.inventory.findById(99),
    "unknown_item",
    "21. an unknown id resolves nothing",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 22-23. a change is atomic: both halves or neither");

{
  reset();
  submit({
    operation: "add_item",
    name: "onions",
    quantity: "10",
    unit: "pieces",
    lowThreshold: "",
  });
  const eventsBefore = row("SELECT COUNT(*) AS n FROM inventory_event").n;

  // The event half fails. The quantity must not survive on its own.
  scratch.exec(`
    CREATE TRIGGER block_events BEFORE INSERT ON inventory_event
    BEGIN SELECT RAISE(ABORT, 'events are blocked'); END;
  `);
  const blocked = runCommand({
    version: COMMAND_VERSION,
    kind: "inventory.consume",
    itemName: "onions",
    amount: 2,
    unit: "pieces",
    sourceText: "used 2 onions",
  });
  assertEqual(
    blocked.ok,
    false,
    "23. a failure to store the event fails the command",
  );
  assertEqual(
    blocked.ok ? null : blocked.error.kind,
    "persistence",
    "23. and is reported as a storage failure, not a domain one",
  );
  assertEqual(readStock("onions").quantity, 10, "23. the quantity rolled back");
  assertEqual(
    row("SELECT COUNT(*) AS n FROM inventory_event").n,
    eventsBefore,
    "23. and no event was left behind",
  );
  scratch.exec("DROP TRIGGER block_events");

  // The quantity half fails. The event must not survive on its own either.
  scratch.exec(`
    CREATE TRIGGER block_quantity BEFORE UPDATE OF quantity ON inventory_item
    BEGIN SELECT RAISE(ABORT, 'quantity is blocked'); END;
  `);
  const alsoBlocked = runCommand({
    version: COMMAND_VERSION,
    kind: "inventory.consume",
    itemName: "onions",
    amount: 3,
    unit: "pieces",
    sourceText: "used 3 onions",
  });
  assertEqual(
    alsoBlocked.ok,
    false,
    "22. a failure to store the quantity fails the command",
  );
  assertEqual(
    readStock("onions").quantity,
    10,
    "22. the quantity is unchanged",
  );
  assertEqual(
    row("SELECT COUNT(*) AS n FROM inventory_event").n,
    eventsBefore,
    "22. and the event rolled back with it",
  );
  scratch.exec("DROP TRIGGER block_quantity");

  // And the refusal path never opened a transaction at all: a domain failure must not have
  // touched anything, which is why the count is still what it was before the two attempts.
  const tooMany = runCommand({
    version: COMMAND_VERSION,
    kind: "inventory.consume",
    itemName: "onions",
    amount: 999,
    unit: "pieces",
  });
  assertRefused(
    { ok: tooMany.ok, error: tooMany.ok ? null : tooMany.error.error },
    "insufficient_inventory",
    "a domain refusal",
  );
  assertEqual(readStock("onions").quantity, 10, "and a refusal wrote nothing");
  assertEqual(
    row("SELECT COUNT(*) AS n FROM inventory_event").n,
    eventsBefore,
    "and logged nothing",
  );
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 24-25. state survives a reload, and history has a stable order",
);

{
  reset();
  submit({
    operation: "add_item",
    name: "onions",
    quantity: "10",
    unit: "pieces",
    lowThreshold: "3",
  });
  runCommand({
    version: COMMAND_VERSION,
    kind: "inventory.consume",
    itemName: "onions",
    amount: 2,
    unit: "pieces",
    sourceText: "used 2 onions",
  });
  runCommand({
    version: COMMAND_VERSION,
    kind: "inventory.restock",
    itemName: "onions",
    amount: 5,
    unit: "pieces",
    sourceText: "restocked 5 onions",
  });

  // 24: close every handle and read from disk.
  releaseDatabase();
  scratch.close();

  const reopened = new Database(scratchFile);
  const afterReload = reopened
    .prepare(
      "SELECT quantity, unit, low_threshold FROM inventory_item WHERE name = ?",
    )
    .get("onions");
  assertEqual(afterReload.quantity, 13, "24. the quantity survives a reload");
  assertEqual(afterReload.unit, "pieces", "24. and the unit");
  assertEqual(afterReload.low_threshold, 3, "24. and the threshold");

  // 25: two events sharing a timestamp must still come back in insertion order. The query
  // orders by `timestamp DESC, id DESC` precisely so this does not depend on the query plan.
  const fixed = "2026-01-01T00:00:00.000Z";
  reopened
    .prepare(
      "INSERT INTO inventory_event (item, delta, timestamp, source_text) VALUES (1, -1, ?, ?)",
    )
    .run(fixed, "first of the same moment");
  reopened
    .prepare(
      "INSERT INTO inventory_event (item, delta, timestamp, source_text) VALUES (1, -1, ?, ?)",
    )
    .run(fixed, "second of the same moment");

  const ordered = reopened
    .prepare(
      `SELECT e.source_text FROM inventory_event e JOIN inventory_item i ON i.id = e.item
       WHERE e.timestamp = ? ORDER BY e.timestamp DESC, e.id DESC`,
    )
    .all(fixed)
    .map((r) => r.source_text);
  assertEqual(
    ordered[0],
    "second of the same moment",
    "25. newest first, with a deterministic tie-break",
  );
  assertEqual(
    ordered[1],
    "first of the same moment",
    "25. and the order does not depend on insertion luck",
  );

  reopened.close();
  // Reopen the shared handle the runtime caches.
  scratch = new Database(scratchFile);
  scratch.pragma("foreign_keys = ON");
}

// ---------------------------------------------------------------------------
console.log("\n# 26-36. the sentences the PRD names, parsed and executed");

{
  reset();
  submit({
    operation: "add_item",
    name: "onions",
    quantity: "10",
    unit: "pieces",
    lowThreshold: "3",
  });

  // A proposal of the shape the parser emits is interpreted, validated, and executed. The
  // parser itself is covered in parser-test; this checks the whole path from a proposal to a
  // stored quantity.
  const run = async (proposal, sentence) => {
    const read = interpret(proposal, sentence);
    assertEqual(
      read.kind,
      "command",
      `"${sentence}" is understood as a command`,
    );

    if (read.kind !== "command") {
      return null;
    }

    const validated = parseCommand(read.command);
    assertEqual(validated.ok, true, `"${sentence}" passes validation`);

    return runCommand(read.command);
  };

  const used = await run(
    {
      status: "interpreted",
      kind: "inventory.consume",
      itemName: "onions",
      amount: 2,
      unit: "pieces",
    },
    "used 2 onions",
  );
  assert(used !== null && used.ok, "26. 'used 2 onions' executes");
  assertEqual(readStock("onions").quantity, 8, "26. and leaves 8");

  const restocked = await run(
    {
      status: "interpreted",
      kind: "inventory.restock",
      itemName: "onions",
      amount: 5,
      unit: "pieces",
    },
    "restocked 5 onions",
  );
  assert(
    restocked !== null && restocked.ok,
    "27. 'restocked 5 onions' executes",
  );
  assertEqual(readStock("onions").quantity, 13, "27. and adds 5");

  const counted = await run(
    {
      status: "interpreted",
      kind: "inventory.set_quantity",
      itemName: "onions",
      quantity: 8,
    },
    "set onions to 8",
  );
  assert(counted !== null && counted.ok, "28. 'set onions to 8' executes");
  assertEqual(
    readStock("onions").quantity,
    8,
    "28. and stores 8, as an absolute count",
  );

  // The PRD's compound sentence. Both facts are reported; the difference is computed.
  submit({ operation: "set_threshold", itemId: "1", lowThreshold: "" });
  scratch
    .prepare("UPDATE inventory_item SET quantity = 0 WHERE name = ?")
    .run("onions");
  const compound = await run(
    {
      status: "interpreted",
      kind: "inventory.recount_after_use",
      itemName: "onions",
      countedQuantity: 10,
      usedAmount: 2,
      unit: "pieces",
    },
    "I had 10 onions, used 2",
  );
  assert(
    compound !== null && compound.ok,
    "29. 'I had 10 onions, used 2' executes",
  );
  assertEqual(
    readStock("onions").quantity,
    8,
    "29. and leaves 8, the PRD's answer",
  );

  // The result was computed, not stated. A proposal that tries to carry the answer is refused
  // by the allowlist before validation ever sees it.
  const forgedResult = interpret(
    {
      status: "interpreted",
      kind: "inventory.recount_after_use",
      itemName: "onions",
      countedQuantity: 10,
      usedAmount: 2,
      unit: "pieces",
      after: 999,
    },
    "I had 10 onions, used 2",
  );
  assertEqual(
    forgedResult.kind,
    "command",
    "36. the legitimate facts survive a forged result",
  );
  assertEqual(
    "after" in forgedResult.command,
    false,
    "36. and the forged result is dropped by the allowlist",
  );
  scratch
    .prepare("UPDATE inventory_item SET quantity = 8 WHERE name = ?")
    .run("onions");

  // 30: an unknown item is a domain refusal, and creates nothing.
  const unknown = await run(
    {
      status: "interpreted",
      kind: "inventory.consume",
      itemName: "basil",
      amount: 1,
      unit: "pieces",
    },
    "used 1 basil",
  );
  assertEqual(
    unknown !== null && unknown.ok,
    false,
    "30. an untracked item is refused",
  );
  assertEqual(
    unknown !== null && !unknown.ok ? unknown.error.error.code : null,
    "unknown_item",
    "30. and never silently becomes a new item",
  );

  // 31: insufficient stock.
  const tooMany = await run(
    {
      status: "interpreted",
      kind: "inventory.consume",
      itemName: "onions",
      amount: 999,
      unit: "pieces",
    },
    "used 999 onions",
  );
  assertRefused(
    tooMany !== null && !tooMany.ok
      ? { ok: false, error: tooMany.error.error }
      : { ok: false, error: { code: "none" } },
    "insufficient_inventory",
    "31. using more than exists",
  );
  assertEqual(
    readStock("onions").quantity,
    8,
    "31. and the quantity is unchanged",
  );

  // 34: a unit that is not the item's own.
  const wrongUnit = await run(
    {
      status: "interpreted",
      kind: "inventory.consume",
      itemName: "onions",
      amount: 1,
      unit: "kg",
    },
    "used 1 kg onions",
  );
  assertRefused(
    wrongUnit !== null && !wrongUnit.ok
      ? { ok: false, error: wrongUnit.error.error }
      : { ok: false, error: { code: "none" } },
    "invalid_unit",
    "34. a unit the item is not tracked in",
  );
  assertEqual(
    readStock("onions").quantity,
    8,
    "34. and nothing was converted or moved",
  );

  // 32-33: ambiguity and malformed output are refusals, not guesses.
  assertEqual(
    interpret(
      { status: "needs_clarification", missing: ["amount", "accountName"] },
      "spent 50",
    ).kind,
    "clarification",
    "33. a sentence missing facts asks instead of guessing",
  );
  for (const [label, proposal] of [
    ["prose", "Sure, I added that"],
    ["a fenced block", "```json\n{}\n```"],
    ["an array", [1, 2]],
    ["null", null],
    ["an invented kind", { status: "interpreted", kind: "inventory.teleport" }],
  ]) {
    assertEqual(
      interpret(proposal, "used 2 onions").kind,
      "unreadable",
      `32. ${label} is refused, not partially executed`,
    );
  }

  // 35: prompt injection inside an item name is just a name. It resolves to nothing and the
  // sentence is never executed as an instruction.
  const injected = await run(
    {
      status: "interpreted",
      kind: "inventory.consume",
      itemName: "onions; DROP TABLE inventory_item",
      amount: 1,
      unit: "pieces",
    },
    "onions; DROP TABLE inventory_item",
  );
  assertEqual(
    injected !== null && injected.ok,
    false,
    "35. an injected command in an item name is refused",
  );
  assertEqual(
    row("SELECT COUNT(*) AS n FROM inventory_item").n > 0,
    true,
    "35. and the table is untouched",
  );

  // 36: identity, time, and results never come from the proposal.
  const forgedIds = interpret(
    {
      status: "interpreted",
      kind: "inventory.consume",
      itemName: "onions",
      amount: 1,
      unit: "pieces",
      id: 99,
      itemId: 99,
      timestamp: "1999-01-01T00:00:00.000Z",
      balance: 100,
      confidence: 0.9,
      sql: "DELETE FROM inventory_item",
    },
    "used 1 onions",
  );
  const command = forgedIds.kind === "command" ? forgedIds.command : {};
  assertEqual("id" in command, false, "36. an invented id is dropped");
  assertEqual(
    "balance" in command,
    false,
    "36. an invented balance is dropped",
  );
  assertEqual(
    "confidence" in command,
    false,
    "36. an invented confidence is dropped",
  );
  assertEqual("sql" in command, false, "36. an invented sql field is dropped");
  assertEqual(
    command.sourceText,
    "used 1 onions",
    "36. and the sentence comes from the application, not the model",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 37-43. empty states, duplicates, renames, and refusals");

{
  reset();

  // 43: an empty kitchen is not an error.
  const repositories = getRepositories();
  assertEqual(
    repositories.display.listInventory().length,
    0,
    "43. an empty kitchen reads as empty",
  );
  assertEqual(
    repositories.display.recentInventoryEvents(10).length,
    0,
    "43. and so does an empty history",
  );

  const noThreshold = submit({
    operation: "add_item",
    name: "onions",
    quantity: "5",
    unit: "pieces",
    lowThreshold: "",
  });
  assert(noThreshold.ok, "37. an item with no threshold is created");
  assertEqual(
    readStock("onions").low_threshold,
    null,
    "37. storing no threshold",
  );

  // A duplicate must not overwrite the item the user already tracks.
  const eventsBefore = row("SELECT COUNT(*) AS n FROM inventory_event").n;
  const duplicate = submit({
    operation: "add_item",
    name: "onions",
    quantity: "99",
    unit: "kg",
    lowThreshold: "",
  });
  assertEqual(duplicate.ok, false, "a duplicate name is refused");
  assertEqual(
    readStock("onions").quantity,
    5,
    "and the original quantity is untouched",
  );
  assertEqual(
    readStock("onions").unit,
    "pieces",
    "and the original unit is untouched",
  );
  assertEqual(
    row("SELECT COUNT(*) AS n FROM inventory_event").n,
    eventsBefore,
    "and nothing was logged",
  );

  // Renaming, and refusing to reinterpret a stored number in another unit.
  const renamed = submit({
    operation: "rename",
    itemId: "1",
    name: "Red onions",
    unit: "pieces",
  });
  assert(renamed.ok, "an item can be renamed");
  assertEqual(
    row("SELECT name FROM inventory_item WHERE id = 1").name,
    "Red onions",
    "and the new name is persisted",
  );
  assertEqual(
    readStock("Red onions").quantity,
    5,
    "and the quantity came with it",
  );

  const unitRefused = submit({
    operation: "rename",
    itemId: "1",
    name: "Red onions",
    unit: "kg",
  });
  assertRefusedToken(
    unitRefused,
    "invalid_unit",
    "changing the unit while stock remains",
  );

  scratch.prepare("UPDATE inventory_item SET quantity = 0 WHERE id = 1").run();
  const unitAllowed = submit({
    operation: "rename",
    itemId: "1",
    name: "Red onions",
    unit: "kg",
  });
  assert(unitAllowed.ok, "changing the unit once the item is empty");
  assertEqual(
    row("SELECT unit FROM inventory_item WHERE id = 1").unit,
    "kg",
    "and the new unit is persisted",
  );

  // Refusals stay structured and specific.
  assertRefusedToken(
    submit({ operation: "set_threshold", itemId: "999", lowThreshold: "2" }),
    "unknown_item",
    "a threshold for an item that does not exist",
  );
  assertRefusedToken(
    submit({ operation: "set_threshold", itemId: "1", lowThreshold: "abc" }),
    "invalid_quantity",
    "a threshold that is not a number",
  );
  assertRefusedToken(
    submit({ operation: "add_item", name: "rice", quantity: "", unit: "kg" }),
    "invalid_quantity",
    "an empty quantity",
  );
  assertRefusedToken(
    submit({ operation: "add_item", name: "rice", quantity: "-2", unit: "kg" }),
    "invalid_quantity",
    "a negative quantity",
  );
  assertRefusedToken(
    submit({ operation: "add_item", name: "rice", quantity: "1", unit: "" }),
    "invalid_unit",
    "an empty unit",
  );
  assertRefusedToken(
    submit({ operation: "set_threshold", itemId: "1", lowThreshold: "-1" }),
    "invalid_quantity",
    "a negative threshold",
  );
  assertRefusedToken(
    submit({ operation: "nonsense" }),
    "invalid_command",
    "an operation that is not one of the four",
  );
  assertRefusedToken(
    submit({ operation: "correct", eventId: "abc" }),
    "unknown_item",
    "a correction with no usable entry id",
  );

  // Phase 9. The entry id was read with `Number`, which is a reader that guesses: `1e3` is 1000,
  // `0x1f` is 31, an empty field is 0, and surrounding spaces are ignored. A correction reverses a
  // movement, so being addressed at the wrong entry is the one outcome that cannot be undone by
  // re-reading the page. Every other id reader in this codebase is digits-only; this one now is too.
  for (const [submitted, description] of [
    ["1e3", "scientific notation, which Number accepts as 1000"],
    ["0x1f", "a hexadecimal literal, which Number accepts as 31"],
    ["", "an absent field, which Number accepted as 0"],
    [" 1 ", "surrounding spaces, which Number ignores"],
    ["-1", "a negative id, which Number accepts as a number"],
    ["1.0", "a decimal id, which Number accepts as 1"],
  ]) {
    assertRefusedToken(
      submit({ operation: "correct", eventId: submitted }),
      "unknown_item",
      `a correction id of ${JSON.stringify(submitted)} is refused: ${description}`,
    );
  }
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 46-47. a correction uses the reversal model and leaves the log intact",
);

{
  reset();
  submit({
    operation: "add_item",
    name: "onions",
    quantity: "10",
    unit: "pieces",
    lowThreshold: "3",
  });
  runCommand({
    version: COMMAND_VERSION,
    kind: "inventory.consume",
    itemName: "onions",
    amount: 2,
    unit: "pieces",
    sourceText: "used 2 onions",
  });
  assertEqual(readStock("onions").quantity, 8, "the starting state is 8");

  const originalEvent = row(
    "SELECT id FROM inventory_event WHERE source_text = 'used 2 onions'",
  );

  // The same entry id, read the way the route now reads it: digits only. A padded id is refused
  // here, so this is also the proof that the stricter reader still addresses a real entry.
  assertRefusedToken(
    submit({ operation: "correct", eventId: `${originalEvent.id} ` }),
    "unknown_item",
    "46. a padded id is refused before anything is reversed",
  );

  const corrected = correctInventoryEntry(originalEvent.id);
  assert(corrected.ok, "46. a mistaken entry can be corrected");
  assertEqual(
    corrected.ok ? corrected.after : null,
    10,
    "46. and the quantity is restored exactly",
  );
  assertEqual(readStock("onions").quantity, 10, "46. in the database");

  // 15: the original entry is still there, and the correction sits beside it.
  const log = rows(
    "SELECT delta, source_text FROM inventory_event WHERE item = 1 ORDER BY id",
  );
  assert(
    log.some((r) => r.source_text === "used 2 onions"),
    "15. the original entry is preserved",
  );
  assert(
    log.some((r) => (r.source_text ?? "").startsWith("correction of entry #")),
    "15. and the correction is recorded beside it",
  );
  assertEqual(
    log.reduce((sum, r) => sum + r.delta, 0),
    readStock("onions").quantity,
    "15. the stored quantity equals the sum of the log — nothing was overwritten",
  );

  // 47: and it survives a reload, because it was never only in memory.
  releaseDatabase();
  scratch.close();
  const reloaded = new Database(scratchFile, { readonly: true });
  assertEqual(
    reloaded
      .prepare("SELECT quantity FROM inventory_item WHERE name = ?")
      .get("onions").quantity,
    10,
    "47. the corrected quantity persists after a reload",
  );
  assertEqual(
    reloaded.prepare("SELECT COUNT(*) AS n FROM inventory_event").get().n,
    3,
    "47. and the correction was persisted as an event of its own",
  );

  // The positive direction: a plain digits id is still read. It is checked after the assertions
  // above rather than before them because it is a real correction — correcting the same entry
  // twice reverses it twice, which is correct and would have made every assertion above a test of
  // something else. The reversal itself is not re-asserted here; the section above already covers
  // one, and `exec:test` covers two.
  const secondCorrection = submit({
    operation: "correct",
    eventId: `${originalEvent.id}`,
  });
  assert(
    secondCorrection.ok,
    "47. a plain digits entry id is still read, so the stricter reader is not a blanket refusal",
  );
  reloaded.close();

  scratch = new Database(scratchFile);
  scratch.pragma("foreign_keys = ON");

  // A correction that cannot be valid is refused rather than applied.
  assertEqual(
    correctInventoryEntry(9999).ok,
    false,
    "a correction of a missing entry is refused",
  );
  const zeroEvent = row(
    "INSERT INTO inventory_event (item, delta, timestamp) VALUES (1, 0, '2026-01-01') RETURNING id",
  );
  assertEqual(
    correctInventoryEntry(zeroEvent.id).ok,
    false,
    "a correction of an entry that changed nothing is refused",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 42. the Dashboard projection follows real Kitchen state");

{
  // The Dashboard's own read model lives in its feature now; this section asserts that its
  // low-stock projection is the Kitchen's state, not a second opinion about it.
  const { readDashboard } = await import("../src/features/dashboard/view.ts");

  reset();
  submit({
    operation: "add_item",
    name: "onions",
    quantity: "10",
    unit: "pieces",
    lowThreshold: "3",
  });
  submit({
    operation: "add_item",
    name: "rice",
    quantity: "2",
    unit: "kg",
    lowThreshold: "",
  });

  let dashboard = readDashboard();
  assertEqual(
    dashboard.lowStock.length,
    0,
    "42. nothing is low above its threshold",
  );
  assertEqual(dashboard.inventoryCount, 2, "42. both items are counted");

  // Down to exactly the threshold, which counts as low.
  runCommand({
    version: COMMAND_VERSION,
    kind: "inventory.consume",
    itemName: "onions",
    amount: 7,
    unit: "pieces",
    sourceText: "used 7 onions",
  });
  dashboard = readDashboard();
  assertEqual(
    dashboard.lowStock.length,
    1,
    "42. an item exactly on its threshold is low",
  );
  assertEqual(
    dashboard.lowStock[0].name,
    "onions",
    "42. and it is the right item",
  );

  // Above the threshold again, without any change to the threshold.
  runCommand({
    version: COMMAND_VERSION,
    kind: "inventory.restock",
    itemName: "onions",
    amount: 5,
    unit: "pieces",
    sourceText: "restocked 5 onions",
  });
  dashboard = readDashboard();
  assertEqual(
    dashboard.lowStock.length,
    0,
    "42. and it stops being low once restocked past it",
  );

  // An empty kitchen must not break the summary.
  reset();
  dashboard = readDashboard();
  assertEqual(
    dashboard.lowStock.length,
    0,
    "42. an empty inventory produces no low-stock items and no crash",
  );
  assertEqual(dashboard.inventoryCount, 0, "42. and counts nothing");
}

// ---------------------------------------------------------------------------
console.log("\n# the HTTP surface");

{
  const ORIGIN = "http://localhost:3000";
  const form = (body, headers = {}) =>
    new Request(`${ORIGIN}/api/kitchen`, {
      method: "POST",
      body,
      headers: {
        origin: ORIGIN,
        host: "localhost:3000",
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
    });

  const get = await GET();
  assertEqual(get.status, 405, "GET is refused");
  assertEqual(get.headers.get("allow"), "POST", "and it advertises POST");

  const foreign = await POST(
    form("operation=add_item&name=x&quantity=1&unit=kg", {
      origin: "https://evil.example",
    }),
  );
  assertEqual(foreign.status, 403, "a cross-origin submission is refused");

  const unreadable = await POST(
    new Request(`${ORIGIN}/api/kitchen`, {
      method: "POST",
      body: "not a form",
      headers: { origin: ORIGIN, "content-type": "text/plain" },
    }),
  );
  assertEqual(unreadable.status, 400, "an unreadable body is a bad request");

  reset();
  const created = await POST(
    form(
      "operation=add_item&name=onions&quantity=10&unit=pieces&lowThreshold=3",
    ),
  );
  assertEqual(created.status, 303, "a valid submission redirects");
  assert(
    (created.headers.get("location") ?? "").startsWith(`${ORIGIN}/kitchen?`),
    "and it redirects to the Kitchen page",
  );
  assertEqual(
    readStock("onions").quantity,
    10,
    "44. the submission really persisted",
  );

  // A failure carries a token, never the domain's prose. The domain's message quotes the name
  // the user typed, and a redirect ends up in history and in referrers.
  const refused = await POST(
    form("operation=add_item&name=onions&quantity=1&unit=kg"),
  );
  const location = refused.headers.get("location") ?? "";
  assert(location.includes("err="), "a refusal carries an error token");
  assertEqual(
    location.includes("pieces"),
    false,
    "and no user text is reflected into the URL",
  );
  assertEqual(
    readStock("onions").quantity,
    10,
    "45. a refused submission mutates nothing",
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
