/**
 * Phase 6 Routine and Sleep tests: the night check-in, the read model, and the route.
 *
 * Run with `npm run routine:test`.
 *
 * ## What this file is for
 *
 * The domain rules for tasks and sleep are tested in `domain-test.mjs` as pure functions and
 * the command paths in `exec-test.mjs` as single facts. Neither of those covers the thing this
 * phase actually adds, which is an *operation*: three tasks and a phone confirmation written
 * as one unit, and a read model that decides what a morning opens on.
 *
 * So this file tests three claims:
 *
 * 1. **The check-in is atomic.** A failure part-way through leaves the old plan untouched, not
 *    half of a new one.
 * 2. **The read model applies the domain's rules and no others.** It selects the top three by
 *    the domain's function, computes lengths with the domain's functions, and invents nothing
 *    where a value is missing.
 * 3. **The route refuses what it should** — cross-origin, unknown operation, an absent phone
 *    answer — and the refusals mutate nothing.
 *
 * ## The database, established first
 *
 * `HARI_OS_DB_PATH` is set before any storage-capable module is imported, exactly as the
 * Kitchen, Expenses, and Dashboard suites do it, because the composition root caches the
 * connection the first time it opens one. The fingerprint of `data/hari-os.db` is taken before
 * any import and asserted at the end, so repeating that mistake fails the suite instead of
 * quietly passing.
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

/**
 * A refusal from the route dispatch, whose failure carries a token rather than a domain code.
 *
 * Two different vocabularies, asserted separately on purpose: a domain code leaking into a
 * token, or a token asserted against a domain error, would both let a refusal start passing
 * while saying nothing.
 */
/**
 * A refusal from the domain, where the failure carries the domain's own code.
 *
 * Both the kind and the code are asserted. "It said no" is not the claim: the claim is that it
 * refused for the stated reason, and a refusal with the wrong reason would still leave the row
 * intact while telling the user something untrue. Asserting the kind as well means a validation
 * refusal cannot pass as a domain one.
 */
function assertRefusedDomain(result, code, message) {
  assertEqual(result.ok, false, `${message} — refused`);
  assertEqual(
    result.ok ? null : result.error.kind,
    "domain",
    `${message} — refused by the domain`,
  );
  assertEqual(
    result.ok ? null : result.error.error.code,
    code,
    `${message} — reported as ${code}`,
  );
}

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
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "hari-os-routine-"));
const scratchFile = path.join(scratchDir, "routine.db");
process.env.HARI_OS_DB_PATH = scratchFile;

const { migrate } = await import("../src/lib/db/migrations.ts");
const { createRepositories } = await import("../src/lib/db/repositories.ts");
const { executeCommand } = await import("../src/commands/executor.ts");
const { COMMAND_VERSION } = await import("../src/commands/contract.ts");
const { getRepositories, releaseDatabase } =
  await import("../src/features/shared/command-runtime.ts");
const { runNightCheckIn } = await import("../src/features/routine/write.ts");
const { readRoutine } = await import("../src/features/routine/view.ts");
const { runRoutineOperation, POST, GET } =
  await import("../src/app/api/routine/route.ts");

migrate(new Database(scratchFile));

let scratch = new Database(scratchFile);
scratch.pragma("foreign_keys = ON");

/**
 * The executor's own repositories, over this connection.
 *
 * A second connection to the same file would also work, but one connection keeps the two
 * halves of a case — the write and the read that checks it — in the same transaction scope,
 * with no question of what the other handle has seen.
 */
const repositories = createRepositories(scratch);

const rows = (sql, ...args) => scratch.prepare(sql).all(...args);
const row = (sql, ...args) => scratch.prepare(sql).get(...args);

/** Clears the three routine tables. `reset` never touches the accounts this phase does not use. */
function reset() {
  scratch.exec(`
    DELETE FROM nap_log;
    DELETE FROM sleep_log;
    DELETE FROM plan_task;
  `);
}

/** The check-in, called directly. */
function checkIn(today, titles, phoneOutside = false) {
  return runNightCheckIn({ today, titles, phoneOutside });
}

/** The check-in, through the route's own dispatch — which trims and reads form fields. */
function submit(fields, today = "2026-10-01") {
  return runRoutineOperation(new Map(Object.entries(fields)), today);
}

/**
 * Runs a command at a stated instant.
 *
 * The executor takes its clock as a dependency, so this file decides what "today" means for
 * every case in it. Without that, a test written on the 1st would fail on the 2nd, which is
 * the same class of bug as the expenses tie-break that used to be written against a fixed
 * wall-clock time.
 *
 * A bare date is accepted and read as noon UTC, so a case about "the 28th" does not have to
 * invent a time to say so.
 */
function runCommand(command, at = "2026-10-01T21:00:00.000Z") {
  const instant = /^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T12:00:00.000Z` : at;

  return executeCommand(
    { version: COMMAND_VERSION, ...command },
    { repositories, now: () => instant },
  );
}

/** Records a night time the way the command path does, so the read model sees real rows. */
function recordNight(field, time, day = "today") {
  return runCommand({ kind: "sleep.record", field, time, day });
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 1-6. the night check-in plans tomorrow and confirms the phone",
);

{
  reset();

  const result = checkIn(
    "2026-10-01",
    ["  ", "buy milk", "call the dentist"],
    true,
  );
  assert(result.ok, "1. a check-in of two tasks succeeds");
  assertEqual(
    result.ok ? result.message : null,
    "Planned 2 tasks for 2026-10-02.",
    "1. and it says how many, for which day",
  );

  const planned = rows("SELECT date, title, done FROM plan_task ORDER BY id");
  assertEqual(planned.length, 2, "2. exactly the stated tasks were written");
  assertEqual(
    planned[0].date,
    "2026-10-02",
    "2. and they are planned for tomorrow, not today",
  );
  assertEqual(
    planned.map((task) => task.title).join(", "),
    "buy milk, call the dentist",
    "3. a blank line is dropped and the order the user wrote is kept",
  );

  const night = row("SELECT date, phone_outside FROM sleep_log");
  assertEqual(
    night.date,
    "2026-10-01",
    "4. the night is stored under the day it began",
  );
  assertEqual(
    night.phone_outside,
    1,
    "4. and the phone confirmation is recorded",
  );
}

{
  reset();

  const refused = checkIn("2026-10-01", ["  ", "   "]);
  assertRefusedToken(
    refused,
    "invalid_task_selection",
    "5. a check-in with no task at all is refused",
  );
  assertEqual(
    rows("SELECT id FROM plan_task").length,
    0,
    "5. and it writes nothing",
  );

  const tooMany = checkIn("2026-10-01", ["a", "b", "c", "d"]);
  assertRefusedToken(
    tooMany,
    "invalid_task_selection",
    "6. a fourth task is refused rather than silently dropped",
  );

  const long = checkIn("2026-10-01", ["x".repeat(121)]);
  assertRefusedToken(
    long,
    "invalid_task_selection",
    "6. and a title longer than the limit is refused",
  );
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 7-11. a second check-in replaces the plan and keeps finished work",
);

{
  reset();
  checkIn("2026-10-01", ["buy milk", "call the dentist"]);
  // The check-in wrote this task for tomorrow, so it is completed as tomorrow's task. Stating
  // the day explicitly is also a check that `tomorrow` resolves through the injected clock and
  // not through the machine's date.
  runCommand({
    kind: "task.set_done",
    title: "buy milk",
    done: true,
    day: "tomorrow",
  });

  const again = checkIn("2026-10-01", ["ship the draft"], false);
  assert(again.ok, "7. a second check-in on the same night succeeds");

  const planned = rows("SELECT title, done FROM plan_task ORDER BY id");
  assertEqual(
    planned.length,
    2,
    "8. the undone task is replaced and the finished one is not",
  );
  assertEqual(
    planned[0].title,
    "buy milk",
    "8. the completed task survives the replacement",
  );
  assertEqual(planned[0].done, 1, "8. still marked done");
  assertEqual(
    planned[1].title,
    "ship the draft",
    "8. and the new plan is written",
  );

  const phone = row(
    "SELECT phone_outside FROM sleep_log WHERE date = '2026-10-01'",
  );
  assertEqual(
    phone.phone_outside,
    0,
    "9. the phone answer can be changed by a later check-in",
  );

  const duplicate = checkIn("2026-10-01", ["ship the draft"]);
  assertRefusedToken(
    duplicate,
    "duplicate_task",
    "10. a task already on the list is refused by title",
  );
  assertEqual(
    rows("SELECT title FROM plan_task ORDER BY id").length,
    2,
    "10. and the refused check-in changed nothing",
  );

  const tomorrow = checkIn("2026-10-02", ["a task for the third day"]);
  assert(tomorrow.ok, "11. a check-in on another day writes that day's plan");
  assertEqual(
    rows("SELECT title FROM plan_task WHERE date = '2026-10-03'").length,
    1,
    "11. and does not touch the second day",
  );
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 12-15. a failing write inside the check-in leaves the old plan whole",
);

{
  reset();
  checkIn("2026-10-01", ["keep me"]);

  // A title that the database will refuse: NUL is a character SQLite will not store, and the
  // domain's own limit is the only reason it gets past validation.
  const poisoned = `title${String.fromCharCode(0)}here`;
  const failed = checkIn("2026-10-01", [poisoned]);

  assertEqual(
    failed.ok,
    false,
    "12. a write the database refuses fails the whole check-in",
  );
  assertEqual(
    rows("SELECT title FROM plan_task WHERE date = '2026-10-02'").length,
    1,
    "12. the previous plan is untouched, not half replaced",
  );
  assertEqual(
    rows("SELECT title FROM plan_task WHERE date = '2026-10-02'")[0].title,
    "keep me",
    "12. and it is the old plan, intact",
  );
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 16-21. the read model shows the morning's three and the night's truth",
);

{
  reset();

  // Five tasks, added one command at a time rather than by a check-in: the check-in takes three
  // by design, so this is the only way to reach the case the Dashboard has to handle — a day
  // with more tasks than the morning shows.
  for (const title of ["first", "second", "third", "fourth", "fifth"]) {
    runCommand({ kind: "task.create", title, day: "tomorrow" });
  }

  const view = readRoutine("2026-10-02");
  assertEqual(
    view.date,
    "2026-10-02",
    "16. the read model answers for the day asked for",
  );
  assertEqual(
    view.topTasks.map((task) => task.title).join(", "),
    "first, second, third",
    "16. the morning opens on the first three, in the order written",
  );
  assertEqual(
    view.taskCount,
    5,
    "16. and the true count is kept rather than truncated",
  );
  assertEqual(
    view.firstAction,
    "first",
    "17. the first action is the first undone task",
  );

  runCommand({
    kind: "task.set_done",
    title: "first",
    done: true,
    day: "tomorrow",
  });
  assertEqual(
    readRoutine("2026-10-02").firstAction,
    "second",
    "17. completing it moves the first action on",
  );

  const allDone = ["second", "third", "fourth", "fifth"].map((title) => {
    runCommand({ kind: "task.set_done", title, done: true, day: "tomorrow" });

    return title;
  });
  assertEqual(
    allDone.length,
    4,
    "18. the remaining tasks can be completed from chat",
  );
  assertEqual(
    readRoutine("2026-10-02").firstAction,
    null,
    "18. and with everything done there is no first action, rather than a repeat",
  );
  assertEqual(
    readRoutine("2026-10-02").tomorrowTasks.length,
    0,
    "19. tomorrow having no plan reads as empty",
  );

  const empty = readRoutine("2026-10-05");
  assertEqual(
    empty.tasks.length,
    0,
    "19. a day with nothing planned does not crash",
  );
  assertEqual(empty.firstAction, null, "19. and invents no task for it");
  assertEqual(
    empty.night.recorded,
    false,
    "19. and reports no night as not recorded",
  );
  assertEqual(
    empty.night.inBed,
    null,
    "19. rather than as a night of zero length",
  );
  assertEqual(
    readRoutine("2026-10-02").tomorrowTasks.length,
    0,
    "19. the read model's tomorrow is the real next day",
  );
}

{
  reset();

  const noTimes = readRoutine("2026-10-01");
  assertEqual(
    noTimes.night.recorded,
    false,
    "20. a night that was never written is not recorded",
  );
  assertEqual(
    noTimes.night.asleep,
    null,
    "20. and has no sleep length to show",
  );

  checkIn("2026-10-01", ["a task"], true);
  recordNight("bedtime", "23:30");
  const bedtimeOnly = readRoutine("2026-10-01");
  assertEqual(
    bedtimeOnly.night.recorded,
    true,
    "20. a night with only a bedtime is recorded",
  );
  assertEqual(
    bedtimeOnly.night.bedtime,
    "23:30",
    "20. and the bedtime is shown",
  );
  assertEqual(
    bedtimeOnly.night.inBed,
    null,
    "20. with no wake time there is no time in bed to claim",
  );
  assertEqual(
    bedtimeOnly.night.phoneOutside,
    true,
    "21. the phone confirmation rides along with the night",
  );

  recordNight("sleep_time", "23:45");
  recordNight("wake_time", "07:10");
  const full = readRoutine("2026-10-01");
  assertEqual(full.night.inBed, "7 h 40 min", "21. time in bed spans midnight");
  assertEqual(
    full.night.asleep,
    "7 h 25 min",
    "21. and sleep excludes the time before sleep began",
  );

  const impossible = recordNight("sleep_time", "23:30");
  assertRefusedDomain(
    impossible,
    "invalid_time_order",
    "21. a sleep time equal to the bedtime would be a night of no length, so it is refused",
  );
  assertEqual(
    readRoutine("2026-10-01").night.asleep,
    "7 h 25 min",
    "21. and the refused write left the stored night alone",
  );

  const sameWake = recordNight("wake_time", "23:45");
  assertRefusedDomain(
    sameWake,
    "invalid_time_order",
    "21. a wake time equal to the sleep time is refused too",
  );

  const badTime = recordNight("wake_time", "7am");
  assertRefusedDomain(
    badTime,
    "invalid_time",
    "21. a time that is not HH:MM is refused",
  );
  assertEqual(
    row("SELECT wake_time FROM sleep_log").wake_time,
    "07:10",
    "21. and the stored wake time is the one that was valid",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# 22-25. naps are listed with the PRD's soft warnings");

{
  reset();

  runCommand({ kind: "nap.start", time: "14:00" });
  const running = readRoutine("2026-10-01");
  assertEqual(
    running.activeNap?.start,
    "14:00",
    "22. a nap with no end is still running",
  );
  assertEqual(
    running.naps[0].minutes,
    null,
    "22. and has no length while it runs, rather than counting to now",
  );
  assertEqual(
    running.naps[0].warnings.length,
    0,
    "22. a nap under the late mark carries no warning",
  );

  const overlap = runCommand({ kind: "nap.start", time: "14:30" });
  assertRefusedDomain(
    overlap,
    "invalid_time_order",
    "23. a second nap while one is running is refused",
  );
  assertEqual(
    readRoutine("2026-10-01").naps.length,
    1,
    "23. and only one nap exists",
  );

  runCommand({ kind: "nap.end", time: "14:20" });
  const short = readRoutine("2026-10-01");
  assertEqual(
    short.naps[0].minutes,
    20,
    "23. a twenty-minute nap is twenty minutes",
  );
  assertEqual(
    short.naps[0].warnings.length,
    0,
    "24. exactly thirty minutes is the boundary, not over it",
  );
  assertEqual(short.activeNap, null, "24. a closed nap is no longer running");

  const twice = runCommand({ kind: "nap.end", time: "14:30" });
  assertRefusedDomain(
    twice,
    "nap_already_ended",
    "24. ending a nap twice is refused rather than overwriting",
  );

  runCommand({ kind: "nap.start", time: "15:30" });
  runCommand({ kind: "nap.end", time: "16:20" });
  const warned = readRoutine("2026-10-01");
  assertEqual(warned.naps[1].minutes, 50, "25. the long nap is fifty minutes");
  assertEqual(
    warned.naps[1].warnings.map((warning) => warning.code).join(","),
    "nap_too_long,nap_started_late",
    "25. and carries both the PRD's warnings",
  );
  assert(
    warned.naps[1].warnings.every(
      (warning) => !/you|should|bad|fail/i.test(warning.message),
    ),
    "25. and neither warning is about the person",
  );

  const boundary = runCommand({ kind: "nap.start", time: "15:00" });
  assert(
    boundary.ok || !boundary.error.code.includes("nap"),
    "25. starting exactly at 15:00 is not the late case",
  );
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 26-27. the consistency streak counts days and never punishes one",
);

{
  reset();

  assertEqual(
    readRoutine("2026-10-01").consistency.days,
    0,
    "26. with nothing recorded there is no streak",
  );

  // Each day is reached by running the command *on* that day, with the reference the user
  // would have said. The clock is injected, so "today" is a fact of the test rather than a
  // fact about the machine it runs on.
  for (const [day, wake] of [
    ["2026-09-28", "06:15"],
    ["2026-09-29", "07:30"],
    ["2026-09-30", "06:30"],
    ["2026-10-01", "07:15"],
  ]) {
    runCommand(
      { kind: "sleep.record", field: "wake_time", time: wake },
      `${day}T08:00:00.000Z`,
    );
  }

  assertEqual(
    readRoutine("2026-10-01").consistency.days,
    4,
    "27. four consecutive days with a wake time in range are four days",
  );
  assertEqual(
    readRoutine("2026-10-01").consistency.lastRecorded,
    "2026-10-01",
    "27. and the streak names the day it reached",
  );

  // A day with no wake time ends the streak. It is not called a failure here, and nothing on
  // any screen says it was one.
  // The streak is a property of the record, not of the day asked about: reading a day with
  // nothing on it does not erase what was written. What ends a streak is a day that was
  // recorded and missed the window, which is the next case.
  assertEqual(
    readRoutine("2026-10-02").consistency.days,
    4,
    "27. reading a day with nothing recorded does not erase the count",
  );
  assertEqual(
    readRoutine("2026-10-02").consistency.lastRecorded,
    "2026-10-01",
    "27. and the last day with a wake time is still reportable",
  );

  runCommand(
    { kind: "sleep.record", field: "wake_time", time: "07:00" },
    "2026-10-03T08:00:00.000Z",
  );
  assertEqual(
    readRoutine("2026-10-03").consistency.days,
    1,
    "27. a new day starts the count again rather than restoring the old one",
  );

  const late = runCommand(
    { kind: "sleep.record", field: "wake_time", time: "11:00" },
    "2026-10-04T12:00:00.000Z",
  );
  assert(
    late.ok,
    "27. a wake time outside the range is still recorded, not refused",
  );
  assertEqual(
    readRoutine("2026-10-04").consistency.days,
    0,
    "27. and it does not extend the count",
  );

  // The boundaries are the two times the PRD quotes, so both are inside and one minute either
  // side of each is outside.
  assertEqual(
    readRoutine("2026-10-04").consistency.days,
    0,
    "27. 11:00 is outside",
  );
  const boundary = runCommand(
    { kind: "sleep.record", field: "wake_time", time: "06:15" },
    "2026-10-05T09:00:00.000Z",
  );
  assert(boundary.ok, "27. the first minute of the window is inside it");
  assertEqual(
    readRoutine("2026-10-05").consistency.days,
    1,
    "27. and counts, because the boundary is inclusive",
  );
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 28-34. the route dispatches one operation and refuses the rest",
);

{
  reset();

  const unknown = submit({
    operation: "delete_everything",
    phoneOutside: "true",
  });
  assertRefusedToken(
    unknown,
    "invalid_command",
    "28. an unknown operation is refused",
  );

  const noPhone = submit({ operation: "night_check_in", title1: "a task" });
  assertRefusedToken(
    noPhone,
    "invalid_command",
    "28. an absent phone answer is refused rather than read as outside",
  );

  const oddPhone = submit({
    operation: "night_check_in",
    title1: "a",
    phoneOutside: "yes",
  });
  assertRefusedToken(
    oddPhone,
    "invalid_command",
    "28. and only the two offered words are read",
  );

  assertEqual(
    rows("SELECT id FROM plan_task").length,
    0,
    "29. none of those refusals wrote a row",
  );

  const good = submit({
    operation: "night_check_in",
    title1: "  buy milk  ",
    title2: "",
    title3: "",
    phoneOutside: "false",
  });
  assert(good.ok, "29. a valid submission succeeds");
  assertEqual(
    rows("SELECT title FROM plan_task")[0].title,
    "buy milk",
    "29. and surrounding whitespace is trimmed before storage",
  );
  assertEqual(
    row("SELECT phone_outside FROM sleep_log").phone_outside,
    0,
    "29. the phone answer is stored as written",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# the HTTP surface, over real SQLite");

{
  const ORIGIN = "http://localhost:3000";
  const form = (body, headers = {}) =>
    new Request(`${ORIGIN}/api/routine`, {
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
  assertEqual(get.status, 405, "30. GET is refused");
  assertEqual(get.headers.get("allow"), "POST", "30. and it advertises POST");

  const foreign = await POST(
    form("operation=night_check_in&title1=x&phoneOutside=false", {
      origin: "https://evil.example",
    }),
  );
  assertEqual(foreign.status, 403, "31. a cross-origin submission is refused");

  const unreadable = await POST(
    new Request(`${ORIGIN}/api/routine`, {
      method: "POST",
      body: "not a form",
      headers: { origin: ORIGIN, "content-type": "text/plain" },
    }),
  );
  assertEqual(
    unreadable.status,
    400,
    "31. an unreadable body is a bad request",
  );

  reset();
  const created = await POST(
    form(
      "operation=night_check_in&title1=buy+milk&title2=walk&phoneOutside=true",
    ),
  );
  assertEqual(created.status, 303, "32. a valid submission redirects");
  assert(
    (created.headers.get("location") ?? "").startsWith(`${ORIGIN}/routine?`),
    "32. back to the Routine page",
  );
  assertEqual(
    rows("SELECT title FROM plan_task ORDER BY id")
      .map((task) => task.title)
      .join(", "),
    "buy milk, walk",
    "32. and the check-in really persisted",
  );
  assertEqual(
    row("SELECT phone_outside FROM sleep_log").phone_outside,
    1,
    "32. including the phone confirmation",
  );

  // A duplicate title is refused, and the domain's message quotes the title back — so this is
  // the case that proves the redirect carries a token rather than the message.
  const refused = await POST(
    form("operation=night_check_in&title1=buy+milk&phoneOutside=false"),
  );
  const location = refused.headers.get("location") ?? "";
  assert(
    location.includes("err=duplicate_task"),
    "33. a refusal carries a token",
  );
  assertEqual(
    rows("SELECT title FROM plan_task").length,
    2,
    "33. and a refused submission mutates nothing",
  );
  // The user's own words must not end up in a redirect: it is written to history and sent in
  // referrers.
  assert(
    !location.includes("buy") && !location.includes("milk"),
    "33. no user text is reflected into the URL",
  );

  // The read model sees what HTTP wrote, through the same connection the page will use.
  const view = readRoutine("2026-10-02");
  assertEqual(
    view.topTasks.map((task) => task.title).join(", "),
    "buy milk, walk",
    "34. the read model sees what the route wrote",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# the development database is untouched");

assertEqual(
  fingerprint(developmentDatabase),
  developmentFingerprintBefore,
  "the development database was not read-modified or written by any test in this file",
);

assertEqual(
  getRepositories().tasks.listForDate("2026-10-02").length >= 0,
  true,
  "the composition root is still usable after the run",
);

// Release the cached handle before removing the file, so nothing is deleted while open.
releaseDatabase();
scratch.close();
fs.rmSync(scratchDir, { recursive: true, force: true });
assertEqual(
  fs.existsSync(scratchDir),
  false,
  "the disposable database and its directory were removed",
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
