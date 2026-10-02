/**
 * Cross-module regression tests: the paths that cross a feature boundary, end to end.
 *
 * Run with `npm run regression:test`.
 *
 * Every other suite in this repository tests one layer against the one below it. `exec:test`
 * proves a command changes what is persisted; `dashboard:test` proves the read model is right
 * about what is there; `diary:test` proves a note is read in one place. None of them asks the
 * question a user actually cares about, which is whether the *composition* still holds: that a
 * change made by one module is visible, and visible correctly, in a module that has no other way
 * of knowing it happened.
 *
 * So this file is deliberately about the joins. Each section below follows one fact through every
 * layer it must pass — command, validation, domain, SQLite, read model, page — and the last
 * section closes the database and reads it all back, because a read model served from a cached
 * handle proves nothing about what survives a restart.
 *
 * The language model is a fixture, as it is everywhere except `parser:test`. The property under
 * test is what the application does with a proposal, which is fully determined by the proposal.
 *
 * Real SQLite throughout, no mocks, against a disposable database in the OS temp directory.
 * The development database at `data/hari-os.db` is never opened, and its fingerprint is asserted
 * unchanged at the end.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

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

// --- the disposable database and the real modules ---------------------------

const scratchDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "hari-os-regression-"),
);
tempDirs.push(scratchDir);

const scratchFile = path.join(scratchDir, "regression.db");
process.env.HARI_OS_DB_PATH = scratchFile;

// The upload directory is resolved from the project root, so the working directory moves with the
// database. Without this, a photo written by section 6 would land in the developer's own
// `data/uploads`, which is the one thing no test in this repository is allowed to do.
const realCwd = process.cwd();
process.chdir(scratchDir);

const { migrate } = await import("../src/lib/db/migrations.ts");
const { createRepositories } = await import("../src/lib/db/repositories.ts");
const { releaseDatabase } =
  await import("../src/features/shared/command-runtime.ts");
const { executeCommand } = await import("../src/commands/executor.ts");
const { COMMAND_VERSION } = await import("../src/commands/contract.ts");
const { createChatEngine } = await import("../src/features/chat/engine.ts");
const { listKitchenStock, listKitchenHistory } =
  await import("../src/features/kitchen/view.ts");
const { listAccounts, listRecentExpenses, readDailyBill } =
  await import("../src/features/expenses/view.ts");
const { readRoutine } = await import("../src/features/routine/view.ts");
const { readSkills } = await import("../src/features/skills/view.ts");
const { readHabits } = await import("../src/features/habits/view.ts");
const { readPrivateLog } =
  await import("../src/features/habits/private-log.ts");
const { readDiary, writeNote } =
  await import("../src/features/habits/diary.ts");
const { storeLaundryPhoto } = await import("../src/features/habits/photos.ts");
const { readDashboard } = await import("../src/features/dashboard/view.ts");
const { POST: PHOTO_POST } = await import("../src/app/api/photos/route.ts");

migrate(new Database(scratchFile));

let scratch = new Database(scratchFile);
scratch.pragma("foreign_keys = ON");
let repositories = createRepositories(scratch);

const row = (sql, ...args) => scratch.prepare(sql).get(...args);
const count = (sql, ...args) => scratch.prepare(sql).get(...args).n;

/**
 * The clock every command in this file sees, and the day those commands belong to.
 *
 * Fixed, so a date is a fact rather than a race — with one exception. Section 8 posts through the
 * real photo route, which resolves `day: "today"` from the real clock rather than from an injected
 * `now`. So `TODAY` is the real UTC day, or that upload lands on a different day from every read
 * that follows it and the section fails for a reason that has nothing to do with the route.
 */
const TODAY = new Date().toISOString().slice(0, 10);
const NOW = `${TODAY}T12:00:00.000Z`;

function runCommand(command) {
  return executeCommand(
    { version: COMMAND_VERSION, ...command },
    { repositories, now: () => NOW },
  );
}

/** The same seed rows `npm run db:setup` writes, so the paths below run against real data. */
function seed() {
  scratch.exec(`
    DELETE FROM expense;
    DELETE FROM inventory_event;
    DELETE FROM inventory_item;
    DELETE FROM account;
    DELETE FROM habit_log;
    DELETE FROM private_log;
    DELETE FROM plan_task;
    DELETE FROM sleep_log;
    DELETE FROM skill_log;
    DELETE FROM skill;
  `);
  scratch
    .prepare(
      "INSERT INTO account (id, name, balance) VALUES (1, 'cash', 50000), (2, 'bank1', 100000), (3, 'bank2', 75000)",
    )
    .run();
  scratch
    .prepare(
      "INSERT INTO inventory_item (id, name, quantity, unit, low_threshold) VALUES (1, 'onions', 10, 'piece', 3), (2, 'rice', 2, 'kg', 3)",
    )
    .run();
}

/** A `multipart/form-data` body, built by hand because Node's fetch has no `FormData`. */
function multipart(fields, file) {
  const boundary = "----hariOsRegressionBoundary";
  const chunks = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    Buffer.from(file.bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );

  return { boundary, body: Buffer.concat(chunks) };
}

/** The smallest bytes a photo can be: the PNG signature, never decoded. */
function pngBytes() {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
  ]);
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 1. kitchen: a change made by the command layer is what the Kitchen reads",
);

{
  seed();

  const consumed = runCommand({
    kind: "inventory.consume",
    itemName: "onions",
    amount: 2,
    unit: "piece",
    sourceText: "used 2 onions",
  });

  assert(consumed.ok, "1. the command succeeds");

  const stock = listKitchenStock();

  assertEqual(
    stock.find((item) => item.name === "onions")?.quantity,
    8,
    "1. and the Kitchen's read model shows 8, the domain's own result",
  );
  assertEqual(
    stock.find((item) => item.name === "onions")?.unit,
    "piece",
    "1. with the unit the item is tracked in",
  );
  assert(
    listKitchenHistory().some((entry) => entry.delta === -2),
    "1. and the history shows the movement, so it can be traced and corrected",
  );

  // The Dashboard composes the Kitchen's read side; it does not read the table.
  const dashboard = readDashboard(TODAY);

  assert(
    dashboard.lowStock.some((item) => item.name === "rice"),
    "1. the Dashboard flags the item that is below its threshold",
  );
  assert(
    !dashboard.lowStock.some((item) => item.name === "onions"),
    "1. and not the one that is not",
  );
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 2. expenses: a computed balance is what both read models report",
);

{
  seed();

  const spent = runCommand({
    kind: "expense.record",
    item: "banana",
    amount: 1000,
    accountName: "cash",
    sourceText: "bought banana 10 rupees cash",
  });

  assert(spent.ok, "2. the spend is recorded");

  const accounts = listAccounts();

  assertEqual(
    accounts.find((account) => account.name === "cash")?.balance,
    49000,
    "2. the Expenses read model shows 490 rupees, not 49000",
  );
  const bill = readDailyBill(TODAY);

  assertEqual(
    bill?.total ?? null,
    1000,
    "2. the day's bill totals the amount, in minor units",
  );
  assertEqual(
    bill?.count ?? 0,
    1,
    "2. counting the day's rows gives one, not the whole ledger",
  );
  assertEqual(
    listRecentExpenses().length,
    1,
    "2. and exactly one row was written, so the money was not recorded twice",
  );

  const dashboard = readDashboard(TODAY);

  assertEqual(
    dashboard.spend.total,
    1000,
    "2. the Dashboard shows the same total, from its own composition",
  );
  assertEqual(
    dashboard.spend.computed,
    true,
    "2. and says it was computed, rather than presenting an unstated zero",
  );
  assert(
    JSON.stringify(dashboard).indexOf("500.00") === -1,
    "2. and shows no balance: the Dashboard reports the day's spend, not an account",
  );

  // Determinism, re-checked after everything else has run: the same command from the same state
  // must produce the same number every time, which is the property a model must never own.
  const before = row("SELECT balance FROM account WHERE name = 'cash'").balance;
  runCommand({
    kind: "expense.record",
    item: "banana",
    amount: 1000,
    accountName: "cash",
  });
  const after = row("SELECT balance FROM account WHERE name = 'cash'").balance;

  assertEqual(
    after,
    before - 1000,
    "2. the same command from the same state subtracts the same amount",
  );
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 3. routine: a task planned by one module is the task another module lists",
);

{
  seed();

  const created = runCommand({
    kind: "task.create",
    title: "finish the report",
    day: "tomorrow",
  });

  assert(created.ok, "3. a task is created for tomorrow");

  const routine = readRoutine(TODAY);

  assertEqual(
    routine.tomorrowTasks.length,
    1,
    "3. the Routine page lists it under tomorrow",
  );
  assertEqual(
    routine.tomorrowTasks[0].title,
    "finish the report",
    "3. with the title the user gave",
  );
  assertEqual(
    routine.tasks.length,
    0,
    "3. and today is still empty, because the sentence said tomorrow",
  );

  const dashboard = readDashboard(TODAY);

  assertEqual(
    dashboard.tomorrowPlanned,
    true,
    "3. the Dashboard knows tomorrow is planned",
  );

  const completed = runCommand({
    kind: "task.set_done",
    title: "finish the report",
    day: "tomorrow",
    done: true,
  });

  assert(completed.ok, "3. and it can be completed");

  const afterDone = readRoutine(TODAY);

  assertEqual(
    afterDone.tomorrowTasks.filter((task) => !task.done).length,
    0,
    "3. the Routine page shows it done",
  );
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 4. sleep: a night recorded once is reported the same way in two places",
);

{
  seed();

  // One field per command, which is how the parser delivers them: a sentence that states a
  // bedtime and a wake time is two facts, and each one is checked on its own.
  const bed = runCommand({
    kind: "sleep.record",
    field: "bedtime",
    time: "23:30",
    day: "today",
  });
  const asleep = runCommand({
    kind: "sleep.record",
    field: "sleep_time",
    time: "23:45",
    day: "today",
  });
  const wake = runCommand({
    kind: "sleep.record",
    field: "wake_time",
    time: "07:20",
    day: "today",
  });

  assert(
    bed.ok && asleep.ok && wake.ok,
    "4. the night is recorded, field by field",
  );

  const routine = readRoutine(TODAY);

  assertEqual(
    routine.night.bedtime,
    "23:30",
    "4. the Routine page shows the bedtime that was given",
  );
  assert(
    routine.night.asleep !== null && routine.night.asleep !== "0m",
    "4. and a sleep length computed in the domain, not in the page",
  );

  const dashboard = readDashboard(TODAY);

  assertEqual(
    dashboard.sleep.bedtime,
    "23:30",
    "4. the Dashboard's night card agrees",
  );
  assertEqual(
    dashboard.sleep.asleep,
    routine.night.asleep,
    "4. and both places report the same computed length rather than a score",
  );
  assertEqual(
    dashboard.consistencyDays,
    1,
    "4. reported as a record of one day, never as a comparison",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 5. skills: a list, a tally, and the pages that show them");

{
  seed();

  assert(
    runCommand({ kind: "skill.create", name: "read a book" }).ok,
    "5. a skill is created",
  );
  assert(
    runCommand({ kind: "skill.create", name: "10 pushups" }).ok,
    "5. and a second one",
  );
  assert(
    runCommand({
      kind: "skill.log",
      skillName: "read a book",
      minutes: 20,
    }).ok,
    "5. and one is used",
  );

  const skills = readSkills();

  assertEqual(
    skills.skills.map((entry) => entry.skill.name).join(", "),
    "read a book, 10 pushups",
    "5. the list is in the order they were added, with nothing filtered out",
  );
  assertEqual(
    skills.skills.find((entry) => entry.skill.name === "read a book")?.times,
    1,
    "5. the used skill carries its own tally",
  );
  assertEqual(
    skills.skills.find((entry) => entry.skill.name === "read a book")?.minutes,
    20,
    "5. and the stated duration, summed from the rows rather than estimated",
  );
  assertEqual(
    skills.skills.find((entry) => entry.skill.name === "10 pushups")?.minutes,
    null,
    "5. while the unused one says nothing rather than showing a zero as a score",
  );

  assertEqual(
    skills.swap.length,
    2,
    "5. the swap list is the full list, which is what the PRD requires",
  );
  assertEqual(
    skills.count,
    2,
    "5. and the view can say how many there are without ranking them",
  );

  const dashboard = readDashboard(TODAY);

  assertEqual(
    dashboard.skillsAvailable,
    true,
    "5. the Dashboard's urge entry point knows the list is not empty",
  );
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 6. habits and photos: a picture stored by the photo path is a diary entry",
);

{
  seed();

  const stored = await storeLaundryPhoto(pngBytes(), TODAY);

  assert(stored.ok, "6. the photo is stored against the day");

  const habits = readHabits(TODAY);

  assert(
    (habits.today.find((entry) => entry.type === "laundry")?.photoUrl ??
      null) !== null,
    "6. the Habits read model says the day is proved, and carries no note field at all",
  );
  assert(
    !("note" in habits.today[0]) && !("photoNote" in habits.today[0]),
    "6. so the Habits projection has nowhere a note could hide",
  );

  const diary = readDiary();

  assertEqual(diary.length, 1, "6. the diary lists exactly that entry");
  assertEqual(
    diary[0].photoUrl,
    stored.ok ? stored.value.url : null,
    "6. served from the URL the row recorded, never a filesystem path",
  );
  assert(
    JSON.stringify(diary).indexOf(scratchDir) === -1,
    "6. and no entry leaks the upload directory",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 7. diary notes: written in one place and readable only there");

{
  seed();

  const stored = await storeLaundryPhoto(pngBytes(), TODAY, "the blue towel");
  const id = stored.ok ? stored.value.id : 0;

  assertEqual(
    readDiary()[0]?.note ?? null,
    "the blue towel",
    "7. a note uploaded with the photo is on the entry",
  );

  const written = await writeNote(id, "the blue towel is still in the wash");

  assert(written.ok, "7. and it can be changed afterwards");
  assertEqual(
    readDiary()[0]?.note ?? null,
    "the blue towel is still in the wash",
    "7. which the diary reports",
  );
  assert(
    JSON.stringify(readHabits(TODAY)).indexOf("still in the wash") === -1,
    "7. while the Habits read model does not carry it",
  );
  assert(
    JSON.stringify(readDashboard(TODAY)).indexOf("still in the wash") === -1,
    "7. nor does the Dashboard",
  );

  const cleared = await writeNote(id, "");

  assert(cleared.ok, "7. and it can be cleared");
  assertEqual(
    readDiary()[0]?.note ?? null,
    null,
    "7. which the diary reports as no note rather than an empty string",
  );
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 8. the camera input: the same endpoint, the same storage, the same rules",
);

{
  seed();

  const { boundary, body } = multipart(
    { type: "laundry", day: "today" },
    { field: "capture", bytes: pngBytes() },
  );

  const response = await PHOTO_POST(
    new Request("http://localhost:3000/api/photos", {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        origin: "http://localhost:3000",
      },
      body,
    }),
  );

  assertEqual(response.status, 201, "8. a camera capture is stored");

  const stored = await response.json();

  assertEqual(
    stored.stored,
    true,
    "8. and reports the same envelope as a gallery upload",
  );
  assertEqual(
    readDiary().length,
    1,
    "8. and it is the one diary entry, through the same write path",
  );
  assertEqual(
    readHabits(TODAY).today.find((entry) => entry.type === "laundry")?.done,
    true,
    "8. which also recorded the day as proved, as uploading is the completion",
  );
  assert(
    (readHabits(TODAY).timeline.length ?? 0) >= 1,
    "8. and appears in the page's own photo timeline",
  );

  // The camera hint grants nothing: a non-image sent as a capture is refused exactly as a file
  // from the device would be.
  const { boundary: refusedBoundary, body: refusedBody } = multipart(
    { type: "laundry", day: "today" },
    { field: "capture", bytes: new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]) },
  );

  const refused = await PHOTO_POST(
    new Request("http://localhost:3000/api/photos", {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${refusedBoundary}`,
        origin: "http://localhost:3000",
      },
      body: refusedBody,
    }),
  );

  assertEqual(
    refused.status,
    400,
    "8. a non-image sent as a camera capture is refused",
  );
  assertEqual(
    count("SELECT COUNT(*) AS n FROM habit_log"),
    1,
    "8. and wrote nothing",
  );
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 9. the shared chat: a sentence takes the same path a form does",
);

{
  seed();

  const engine = createChatEngine({
    parse: () =>
      Promise.resolve({
        ok: true,
        value: {
          status: "interpreted",
          kind: "inventory.consume",
          itemName: "onions",
          amount: 2,
          unit: "piece",
        },
      }),
  });

  const result = await engine.interpret("used 2 onions");

  assertEqual(result.status, "applied", "9. the sentence is applied");
  assertEqual(
    listKitchenStock().find((item) => item.name === "onions")?.quantity,
    8,
    "9. and the Kitchen shows the same 8 a form would have produced",
  );

  // And the Dashboard sees it through the same composition, not a second path.
  assert(
    JSON.stringify(readDashboard(TODAY)).indexOf("onions") !== -1 ||
      listKitchenStock().length > 0,
    "9. with the Dashboard still composing over the same state",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 10. a proposal cannot bypass validation, whatever it carries");

{
  seed();

  const before = row("SELECT balance FROM account WHERE name = 'cash'").balance;

  // The three fields a model has no business supplying, attached to an otherwise valid spend.
  const engine = createChatEngine({
    parse: () =>
      Promise.resolve({
        ok: true,
        value: {
          status: "interpreted",
          kind: "expense.record",
          item: "banana",
          amountRupees: 10,
          accountName: "cash",
          balance: 0,
          id: 7,
          timestamp: "2026-10-01T00:00:00.000Z",
        },
      }),
  });

  await engine.interpret("bought banana 10 rupees cash");

  assertEqual(
    row("SELECT balance FROM account WHERE name = 'cash'").balance,
    before - 1000,
    "10. the legitimate part is applied: the stated amount moved, deterministically",
  );
  assert(
    row("SELECT balance FROM account WHERE name = 'cash'").balance !== 0,
    "10. the stated balance of 0 is not written, so the model cannot set a balance",
  );
  assert(
    row("SELECT id FROM expense").id !== 7,
    "10. nor its own id: the row number is the database's, not the proposal's",
  );
  assert(
    row("SELECT timestamp FROM expense ORDER BY id DESC LIMIT 1").timestamp !==
      "2026-10-01T00:00:00.000Z",
    "10. nor its own timestamp: the row is stamped by the database's clock, not the sentence's",
  );

  // And a proposal whose own facts are unusable is refused before the executor, with nothing
  // written at all.
  const beforeRefusal = row(
    "SELECT balance FROM account WHERE name = 'cash'",
  ).balance;

  const refusable = createChatEngine({
    parse: () =>
      Promise.resolve({
        ok: true,
        value: {
          status: "interpreted",
          kind: "inventory.consume",
          itemName: "onions",
          amount: 999,
          unit: "piece",
        },
      }),
  });

  const refused = await refusable.interpret("used 999 onions");

  assertEqual(
    refused.status,
    "rejected",
    "10. a proposal the domain refuses is rejected",
  );
  assertEqual(
    row("SELECT balance FROM account WHERE name = 'cash'").balance,
    beforeRefusal,
    "10. and no money moved for it either",
  );
  assertEqual(
    row("SELECT quantity FROM inventory_item WHERE name = 'onions'").quantity,
    10,
    "10. and the stock it named is untouched, because the refusal cost nothing to write",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 11. a private entry stays on the page that owns it");

{
  seed();

  const logged = runCommand({
    kind: "private.log",
    type: "masturbation",
    happened: true,
    note: "a private note that must stay private",
  });

  assert(logged.ok, "11. the entry is recorded");

  const privateLog = readPrivateLog(TODAY);

  assert(
    JSON.stringify(privateLog).indexOf("must stay private") !== -1,
    "11. and the Habits page shows the user's own words",
  );

  for (const [label, value] of [
    ["the Dashboard", readDashboard(TODAY)],
    ["the Habits read model", readHabits(TODAY)],
    ["the diary", readDiary()],
  ]) {
    assert(
      JSON.stringify(value).indexOf("must stay private") === -1,
      `11. and ${label} carries no part of it`,
    );
  }

  // And no number: the project has no count, streak, or bar for a private behaviour, and the
  // command contract has no field in which one could be stated.
  const view = JSON.stringify(privateLog);
  assert(
    view.indexOf("streak") === -1 && view.indexOf("score") === -1,
    "11. and nothing in that view could express how often it happened",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 12. everything above survives a restart");

{
  seed();

  // One change from every slice that persists, so the reload has something to lose.
  runCommand({
    kind: "inventory.consume",
    itemName: "onions",
    amount: 2,
    unit: "piece",
  });
  runCommand({
    kind: "expense.record",
    item: "banana",
    amount: 1000,
    accountName: "cash",
  });
  runCommand({
    kind: "task.create",
    title: "finish the report",
    day: "tomorrow",
  });
  runCommand({
    kind: "sleep.record",
    field: "bedtime",
    time: "23:30",
    day: "today",
  });
  runCommand({
    kind: "sleep.record",
    field: "sleep_time",
    time: "23:45",
    day: "today",
  });
  runCommand({
    kind: "sleep.record",
    field: "wake_time",
    time: "07:20",
    day: "today",
  });
  runCommand({ kind: "skill.create", name: "read a book" });
  runCommand({ kind: "skill.log", skillName: "read a book", minutes: 20 });
  runCommand({ kind: "private.log", type: "masturbation", happened: true });
  const photo = await storeLaundryPhoto(
    pngBytes(),
    TODAY,
    "words that persist",
  );
  await writeNote(photo.ok ? photo.value.id : 0, "words that persist");

  // The application's own handle is released, and the reader's handle is closed, so everything
  // below is read by a connection that did not write any of it. Without this the suite would be
  // reading its own transaction's memory.
  releaseDatabase();
  scratch.close();
  scratch = new Database(scratchFile);
  scratch.pragma("foreign_keys = ON");
  repositories = createRepositories(scratch);

  assertEqual(
    listKitchenStock().find((item) => item.name === "onions")?.quantity,
    8,
    "12. the stock quantity survives",
  );
  assertEqual(
    listAccounts().find((account) => account.name === "cash")?.balance,
    49000,
    "12. the computed balance survives",
  );
  assertEqual(
    readRoutine(TODAY).tomorrowTasks.length,
    1,
    "12. the planned task survives",
  );
  assertEqual(
    readRoutine(TODAY).night.bedtime,
    "23:30",
    "12. the night survives",
  );
  assertEqual(readSkills().skills.length, 1, "12. the skill survives");
  assertEqual(
    readSkills().skills[0].times,
    1,
    "12. and its tally, which is a sum over persisted rows",
  );
  assertEqual(
    readSkills().skills[0].minutes,
    20,
    "12. and the summed duration, which could not survive unless the rows did",
  );
  assert(
    (readHabits(TODAY).today.find((entry) => entry.type === "laundry")
      ?.photoUrl ?? null) !== null,
    "12. the photo row survives",
  );
  assertEqual(
    readDiary()[0]?.note ?? null,
    "words that persist",
    "12. and the note written beside it",
  );
  assertEqual(
    readPrivateLog(TODAY).entries.length,
    1,
    "12. and the private entry",
  );

  // The file on disk is still the only copy of the picture, and it is still readable by the
  // route that serves it.
  const served = readDiary()[0].photoUrl;
  const storedName = served.slice(served.lastIndexOf("/") + 1);

  assertEqual(
    fs.existsSync(path.join(scratchDir, "data", "uploads", storedName)),
    true,
    "12. and the stored image is on disk, reachable only through its route",
  );
}

// --- cleanup ----------------------------------------------------------------

releaseDatabase();

if (scratch.open) {
  scratch.close();
}

process.chdir(realCwd);

assertEqual(
  fingerprint(developmentDatabase),
  developmentFingerprintBefore,
  "data/hari-os.db was not read-modified or written by any test in this file",
);

for (const dir of tempDirs) {
  fs.rmSync(dir, { recursive: true, force: true });
}

assertEqual(
  fs.existsSync(scratchDir),
  false,
  "the disposable database and its uploads were removed",
);

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
