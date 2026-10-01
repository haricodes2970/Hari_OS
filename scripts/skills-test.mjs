/**
 * Phase 7 tests: skills, habits, the private log, and photos.
 *
 * Run with `npm run skills:test`.
 *
 * ## What this file is for
 *
 * The pure rules are covered in `domain-test.mjs` and the command paths in `exec-test.mjs`. What
 * is only visible here is the set of claims this phase is actually judged on, and several of them
 * are claims about *absence* — which is exactly the kind of claim that passes silently when it
 * stops being true:
 *
 * 1. **The full skill list is shown, in stored order, and nothing is chosen.** Not "no
 *    auto-selection happens"; the stronger claim, that the read model has no field in which a
 *    recommendation could be expressed.
 * 2. **A private entry cannot become a number.** Asserted by shape: the read model exposes no
 *    count, and the command outcome carries no field a tally could be accumulated into.
 * 3. **Laundry needs a photo, from every direction** — a sentence, a form, and the domain's own
 *    `photo_required`. And a photo without a recording does not exist.
 * 4. **The photo path is real**: magic bytes decide the type, the name comes from the server, a
 *    refused file leaves nothing on disk, and the stored value is a URL rather than a path.
 * 5. **The Dashboard can see habits and cannot see the private log**, because the private log is
 *    reachable only through a module the Dashboard does not import.
 *
 * ## The database, established first
 *
 * `HARI_OS_DB_PATH` is set before any storage-capable import, as every other suite does, because
 * the composition root caches its connection on first use. The fingerprint of `data/hari-os.db` is
 * taken before any import and asserted at the end, so repeating that mistake fails the suite
 * instead of quietly passing.
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

/** A refusal from a `Result` carrying the domain's own code. */
function assertRefused(result, code, message) {
  assertEqual(result.ok, false, `${message} — refused`);
  assertEqual(
    result.ok ? null : result.error.code,
    code,
    `${message} — reported as ${code}`,
  );
}

/**
 * A refusal from the executor, whose failure is one of three kinds rather than a domain error.
 *
 * Both the kind and the code are asserted, for the reason `routine-test.mjs` asserts both: a
 * validation failure carries no domain code at all, so a test that read only the code would pass
 * against the wrong kind of refusal.
 */
function assertRefusedCommand(result, code, message) {
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
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "hari-os-skills-"));
const scratchFile = path.join(scratchDir, "skills.db");
process.env.HARI_OS_DB_PATH = scratchFile;

// The upload directory is resolved from the project root, so these tests chdir into the scratch
// directory before anything imports the storage module. Without that, `savePhoto` would write real
// files into the developer's `data/uploads`.
const realCwd = process.cwd();
process.chdir(scratchDir);

const { migrate } = await import("../src/lib/db/migrations.ts");
const { createRepositories } = await import("../src/lib/db/repositories.ts");
const { executeCommand } = await import("../src/commands/executor.ts");
const { COMMAND_VERSION } = await import("../src/commands/contract.ts");
const { releaseDatabase } =
  await import("../src/features/shared/command-runtime.ts");
const { readSkills } = await import("../src/features/skills/view.ts");
const { readHabits } = await import("../src/features/habits/view.ts");
const { readPrivateLog } =
  await import("../src/features/habits/private-log.ts");
const { storeLaundryPhoto, loadPhoto, photoUrl } =
  await import("../src/features/habits/photos.ts");
const { savePhoto, readPhoto, deletePhoto, photoPath } =
  await import("../src/lib/storage/photos.ts");
const { readDashboard } = await import("../src/features/dashboard/view.ts");
const { parseCommand } = await import("../src/lib/validation/command.ts");
const { POST: PHOTO_POST, GET: PHOTO_GET } =
  await import("../src/app/api/photos/route.ts");
const { GET: PHOTO_FILE_GET } =
  await import("../src/app/api/photos/[id]/[file]/route.ts");

migrate(new Database(scratchFile));

let scratch = new Database(scratchFile);
scratch.pragma("foreign_keys = ON");

const repositories = createRepositories(scratch);
const rows = (sql, ...args) => scratch.prepare(sql).all(...args);
const row = (sql, ...args) => scratch.prepare(sql).get(...args);

/** How many files are in the scratch upload directory right now. */
function uploadCount() {
  return fs.readdirSync(path.join(scratchDir, "data", "uploads")).length;
}

function reset() {
  scratch.exec(`
    DELETE FROM skill_log;
    DELETE FROM skill;
    DELETE FROM habit_log;
    DELETE FROM private_log;
  `);
}

/** Runs a command at a stated instant, so every case decides its own "today". */
function runCommand(command, at = "2026-10-01T12:00:00.000Z") {
  return executeCommand(
    { version: COMMAND_VERSION, ...command },
    { repositories, now: () => at },
  );
}

function createSkill(name) {
  return runCommand({ kind: "skill.create", name });
}

/** Writes a private entry on a stated calendar day, through the same clock. */
function privateEntry(type, happened, extra = {}, day = "2026-10-01") {
  return runCommand(
    { kind: "private.log", type, happened, ...extra },
    `${day}T12:00:00.000Z`,
  );
}

function logSkill(skillName, minutes = null, at = undefined) {
  return runCommand(
    { kind: "skill.log", skillName, ...(minutes === null ? {} : { minutes }) },
    at,
  );
}

/**
 * Records a habit on a stated calendar day.
 *
 * The day is given as the clock, not as a `day` reference, because a command may only name one
 * of three words — which is itself worth noting: the suite cannot file a habit on an arbitrary
 * day without going through the application clock, exactly as a caller cannot.
 */
function recordHabit(type, done, extra = {}, day = "2026-10-01") {
  return runCommand(
    { kind: "habit.record", type, done, ...extra },
    `${day}T12:00:00.000Z`,
  );
}

/**
 * A minimal valid PNG: the eight signature bytes, then an IHDR that is long enough for the
 * signature check and nothing else. It is never decoded — the storage module reads bytes, not
 * images — so this is a file with the right magic number and no picture in it.
 */
function pngBytes(extra = 0) {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
  ]);

  return extra === 0
    ? bytes
    : new Uint8Array([...bytes, ...new Array(extra).fill(0)]);
}

/** A real `multipart/form-data` body, built the way a browser builds one. */
function multipart(fields, file) {
  const boundary = "----hariOsTestBoundary";
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        "utf8",
      ),
    );
  }

  if (file !== undefined) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`,
        "utf8",
      ),
      Buffer.from(file.bytes),
      Buffer.from("\r\n", "utf8"),
    );
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));

  return {
    boundary,
    body: Buffer.concat(parts),
  };
}

/** A request carrying a multipart body, with the headers a browser would send. */
function uploadRequest(fields, file) {
  const { boundary, body } = multipart(fields, file);

  return new Request("http://localhost:3000/api/photos", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      origin: "http://localhost:3000",
    },
    body,
  });
}

// =============================================================================
// 1. The skills list: complete, ordered, and unchosen
// =============================================================================

console.log(`\n--- the replacement skill list`);

reset();

assertEqual(
  readSkills().count,
  0,
  "1. an empty list is an empty list, not a failure",
);
assertEqual(
  readSkills().skills.length,
  0,
  "1. and it renders nothing rather than examples",
);

for (const name of [
  "read a book",
  "10 pushups",
  "vibe code a platform",
  "research",
]) {
  createSkill(name);
}

const full = readSkills();

assertEqual(full.count, 4, "2. every added skill is in the read model");
assertEqual(
  full.skills.map((entry) => entry.skill.name).join(" | "),
  "read a book | 10 pushups | vibe code a platform | research",
  "2. and they are in the order they were added, not sorted or ranked",
);
assertEqual(
  full.swap.map((skill) => skill.name).join(" | "),
  full.skills.map((entry) => entry.skill.name).join(" | "),
  "2. the swap list is the same list: full, unfiltered, untruncated",
);
assert(
  !Object.keys(full.skills[0].skill).some((field) =>
    /suggest|recommend|rank|score|priority|favourite|favorite|star/i.test(
      field,
    ),
  ),
  "2. no field exists in which a recommendation could be expressed",
);
assert(
  !Object.keys(full).some((field) =>
    /suggest|recommend|rank|favourite|favorite/i.test(field),
  ),
  "2. and none exists on the view either",
);
assertEqual(
  full.remaining,
  6,
  "3. the PRD's cap is ten and six slots are left",
);
assertEqual(full.atLimit, false, "3. and the list is not at the limit");

for (let index = 0; index < 6; index += 1) {
  createSkill(`filler ${index + 1}`);
}

assertEqual(readSkills().count, 10, "4. ten skills is allowed");
assertRefusedCommand(
  createSkill("one too many"),
  "skill_limit_reached",
  "4. an eleventh is refused",
);
assertEqual(readSkills().count, 10, "4. and the refusal wrote nothing");

// Duplicates are checked on a short list, because a full list is refused for a different and
// more useful reason: being full. Asserting them here would be testing the limit twice.
reset();
createSkill("read a book");
assertRefusedCommand(
  createSkill("READ A BOOK"),
  "duplicate_skill",
  "5. a duplicate name is refused",
);
assertRefusedCommand(
  createSkill("read a book"),
  "duplicate_skill",
  "5. by exact name too",
);
assertRefusedCommand(
  createSkill(`read${String.fromCharCode(7)}a book`),
  "invalid_skill_name",
  "5. a name with a control character is refused",
);
assertRefusedCommand(
  createSkill("x".repeat(81)),
  "invalid_skill_name",
  "5. and a name over 80 characters",
);

const blank = parseCommand({
  version: COMMAND_VERSION,
  kind: "skill.create",
  name: "   ",
});
assertEqual(
  blank.ok,
  false,
  "5. a blank name is refused by the validation boundary, before the domain is reached",
);

// --- the tally -------------------------------------------------------------

console.log(`\n--- the per-skill tally`);

reset();
createSkill("reading");
createSkill("pushups");

logSkill("reading", 30, "2026-10-01T09:00:00.000Z");
logSkill("reading", 20, "2026-10-01T20:00:00.000Z");
logSkill("reading", null, "2026-10-02T09:00:00.000Z");
logSkill("pushups", 10, "2026-10-01T07:00:00.000Z");

const tallied = readSkills();

assertEqual(
  tallied.skills.find((entry) => entry.skill.name === "reading").times,
  3,
  "6. a tally counts uses of that skill and no other",
);
assertEqual(
  tallied.skills.find((entry) => entry.skill.name === "reading").minutes,
  50,
  "6. and sums only the durations the user stated",
);
assertEqual(
  tallied.skills.find((entry) => entry.skill.name === "pushups").minutes,
  10,
  "6. one skill's total says nothing about another's",
);
assertEqual(
  tallied.skills.find((entry) => entry.skill.name === "pushups").times,
  1,
  "6. and neither does one skill's count",
);
assertEqual(
  tallied.skills.map((entry) => entry.skill.name).join(" | "),
  "reading | pushups",
  "6. the list is still in stored order, so the tally is not a ranking",
);

assertRefusedCommand(
  logSkill("pushupz", 10),
  "unknown_skill",
  "7. an unknown skill is refused",
);
assertRefusedCommand(
  logSkill("pushups", -1),
  "invalid_skill_minutes",
  "7. a negative duration is refused",
);
// A fractional value never reaches the domain: the validation boundary refuses it as not a whole
// number of minutes, naming the field. Both refusals matter, and each is asserted where it
// happens rather than folded into one expectation.
assertEqual(
  parseCommand({
    version: COMMAND_VERSION,
    kind: "skill.log",
    skillName: "pushups",
    minutes: 1.5,
  }).ok,
  false,
  "7. a fractional duration is refused by validation",
);

assertRefusedCommand(
  logSkill("pushups", 1441),
  "invalid_skill_minutes",
  "7. and one over 24 hours is refused",
);
assertEqual(
  row("SELECT COUNT(*) AS n FROM skill_log").n,
  4,
  "7. none of those refusals wrote a log entry",
);

// =============================================================================
// 2. Habits: streaks, the laundry target, and screen time
// =============================================================================

console.log(`\n--- habits`);

reset();

assertEqual(
  readHabits("2026-10-01").today.length,
  0,
  "8. a day with nothing recorded reads empty",
);
assertEqual(
  readHabits("2026-10-01").streaks.length,
  3,
  "8. and every neutral habit still has a row to show",
);
assertEqual(
  readHabits("2026-10-01").laundry.percent,
  0,
  "8. the laundry bar starts at nothing, not at a failure",
);

recordHabit("cooking", true, {}, "2026-09-28");
recordHabit("cooking", true, {}, "2026-09-29");
recordHabit("cooking", true, {}, "2026-09-30");
recordHabit("cooking", true, {}, "2026-10-01");

assertEqual(
  readHabits("2026-10-01").streaks.find((entry) => entry.type === "cooking")
    .days,
  4,
  "9. a streak counts consecutive days recorded as done",
);

recordHabit("cooking", false, {}, "2026-10-02");
assertEqual(
  readHabits("2026-10-02").streaks.find((entry) => entry.type === "cooking")
    .days,
  0,
  "9. a day recorded as not done ends it, because that is a statement",
);
assertEqual(
  readHabits("2026-10-02").streaks.find((entry) => entry.type === "cooking")
    .recorded,
  true,
  "9. and the day is still recorded, so it is not 'not recorded'",
);
assertEqual(
  readHabits("2026-10-03").streaks.find((entry) => entry.type === "cooking")
    .recorded,
  false,
  "9. a day with no row is not recorded, which is not the same as not done",
);

reset();
recordHabit("laundry", true, {}, "2026-10-01");
assertRefusedCommand(
  recordHabit("laundry", true, {}, "2026-10-01"),
  "photo_required",
  "10. laundry cannot be completed on a text claim alone",
);
assertEqual(
  row("SELECT COUNT(*) AS n FROM habit_log WHERE type = 'laundry'").n,
  0,
  "10. and the refusal wrote nothing",
);
recordHabit("laundry", false, {}, "2026-10-01");
assertEqual(
  row("SELECT COUNT(*) AS n FROM habit_log WHERE type = 'laundry' AND done = 0")
    .n,
  1,
  "10. recording it as not done is allowed: the photo rule governs completion",
);

reset();
recordHabit("screen_time", true, { minutes: 90 }, "2026-10-01");
assertEqual(
  readHabits("2026-10-01").screenTimeMinutes,
  90,
  "11. screen time is stored as stated",
);
assertRefusedCommand(
  recordHabit("screen_time", true, {}, "2026-10-01"),
  "invalid_habit_minutes",
  "11. and it cannot be entered without a number",
);
assertRefusedCommand(
  recordHabit("screen_time", true, { minutes: -5 }, "2026-10-01"),
  "invalid_habit_minutes",
  "11. a negative number of minutes is refused",
);
// A measurement is an assertion that the user made the entry, so the domain forces it done
// rather than refusing: "I did not screen time" is not a fact anyone has.
const notDone = recordHabit(
  "screen_time",
  false,
  { minutes: 30 },
  "2026-10-01",
);
assert(
  notDone.ok,
  "11. screen time is stored as done whatever the sentence said",
);
assertEqual(
  row("SELECT done FROM habit_log WHERE type = 'screen_time'").done,
  1,
  "11. because the number is the statement, and the number is what was stored",
);
assertRefusedCommand(
  recordHabit("screen_time", false, {}, "2026-10-01"),
  "invalid_habit_minutes",
  "11. while screen time without a number is still refused",
);
assertRefusedCommand(
  recordHabit("dishes", true, { minutes: 30 }, "2026-10-01"),
  "invalid_habit_minutes",
  "11. a habit that was done has no duration to store",
);

reset();
await storeLaundryPhoto(pngBytes(64), "2026-10-01");
await storeLaundryPhoto(pngBytes(64), "2026-10-03");
assertEqual(
  readHabits("2026-10-05").laundry.doneThisWeek,
  2,
  "12. the laundry target counts done days in the trailing seven days",
);
assertEqual(
  readHabits("2026-10-05").laundry.target,
  2,
  "12. against the PRD's twice a week",
);
assertEqual(
  readHabits("2026-10-05").laundry.met,
  true,
  "12. and reports the target as met",
);
assertEqual(
  readHabits("2026-10-05").laundry.percent,
  100,
  "12. as a bar of 100",
);
assertEqual(
  readHabits("2026-10-12").laundry.doneThisWeek,
  0,
  "12. a week later the same two days no longer count",
);

reset();
assertEqual(
  readHabits("2026-10-01").timeline.length,
  0,
  "13. an empty diary is empty",
);

// =============================================================================
// 3. Photos: the real path
// =============================================================================

console.log(`\n--- photos`);

reset();

const before = uploadCount();
const stored = await savePhoto(pngBytes());

assert(stored.ok, "14. a file with a real image signature is stored");
assert(
  !stored.ok ? false : /^[\w-]+\.png$/.test(stored.value.filename),
  "14. under a server-generated name with the detected extension",
);
assert(
  !stored.ok
    ? false
    : !stored.value.filename.includes("data") &&
        !stored.value.filename.includes("/"),
  "14. and nothing from the caller reaches the path",
);
assertEqual(
  uploadCount(),
  before + 1,
  "14. exactly one file exists, and it is inside the scratch directory",
);

const jpegAsPng = await savePhoto(
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
);
assert(
  jpegAsPng.ok && jpegAsPng.value.filename.endsWith(".jpg"),
  "15. the extension comes from the bytes, not from a claimed name",
);

const disguised = await savePhoto(
  new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x00, 0x00]), // "<html>"
);
assertRefused(
  disguised,
  "invalid_photo",
  "15. HTML is refused, whatever it was named",
);

const empty = await savePhoto(new Uint8Array());
assertRefused(empty, "invalid_photo", "15. an empty file is refused");

const svg = await savePhoto(
  new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20, 0x78, 0x6d, 0x6c, 0x6e, 0x73]),
);
assertRefused(
  svg,
  "invalid_photo",
  "16. SVG is refused: it can carry script on our own origin",
);

const tooLarge = await savePhoto(pngBytes(10 * 1024 * 1024 + 32));
assertRefused(tooLarge, "photo_too_large", "16. a file over 10 MB is refused");

assertEqual(
  uploadCount(),
  before + 2,
  "16. and no refused upload left a file behind",
);

// --- storing a photo against a day ----------------------------------------

const upload = await storeLaundryPhoto(pngBytes(64), "2026-10-01");

assert(upload.ok, "17. a photo can be stored against a day");
assertEqual(
  row("SELECT done FROM habit_log WHERE type = 'laundry'").done,
  1,
  "17. and it records laundry as done, because uploading is the completion",
);
assert(
  upload.ok &&
    upload.value.url ===
      photoUrl(upload.value.id, path.basename(upload.value.url)),
  "17. the stored value is the application's own URL for it",
);
const storedUrl = row("SELECT photo_url AS url FROM habit_log").url;
assert(
  storedUrl.startsWith("/api/photos/") && !storedUrl.includes(scratchDir),
  "17. and the row holds that URL and never the path",
);
assertEqual(
  readHabits("2026-10-01").timeline.length,
  1,
  "17. the photo appears in the Photo Diary",
);
assertEqual(
  readHabits("2026-10-01").timeline[0].label,
  "Laundry",
  "17. labelled by the habit it proves",
);

const loaded = await loadPhoto(upload.value.id, path.basename(storedUrl));

assert(
  loaded.ok && loaded.value !== null,
  "18. the photo can be read back by its stored name",
);
assertEqual(
  loaded.ok && loaded.value ? loaded.value.contentType : null,
  "image/png",
  "18. served as the type its bytes say",
);

const guessed = await loadPhoto(upload.value.id, "someone-elses-photo.png");
assert(
  guessed.ok && guessed.value === null,
  "19. a guessed filename reads nothing",
);

const absent = await loadPhoto(9999, "anything.png");
assert(
  absent.ok && absent.value === null,
  "19. an id with no row reads nothing",
);

// --- the same day twice ----------------------------------------------------

const second = await storeLaundryPhoto(pngBytes(96), "2026-10-01");

assert(second.ok, "20. a second photo for the same day is accepted");
assertEqual(
  row("SELECT COUNT(*) AS n FROM habit_log WHERE type = 'laundry'").n,
  1,
  "20. and replaces the earlier entry rather than adding a second row",
);
assertEqual(
  readHabits("2026-10-01").timeline.length,
  1,
  "20. so the diary shows the photo that is current",
);
assertEqual(
  uploadCount(),
  before + 4,
  "20. the earlier file is left on disk rather than deleted, so nothing is silently destroyed",
);

// Phase 9: the upload directory boundary, enforced by the module that owns it rather than by every
// caller. A name that this module could not have written names no file, and must not reach `join`.
console.log(`\n--- a name from outside the upload directory`);

for (const name of [
  "../hari-os.db",
  "../../etc/passwd",
  "nested/photo.png",
  "./stored.png",
  "not-a-uuid.png",
  "stored.png",
  "\\u002e\\u002e\\u002e\\u002e\\u002e/x.png",
]) {
  const read = await readPhoto(name);

  assertEqual(
    read,
    null,
    `a name this module never wrote reads nothing: ${JSON.stringify(name)}`,
  );

  const removed = await deletePhoto(name);

  assertEqual(
    removed.ok,
    true,
    `and deleting it is a no-op rather than an error: ${JSON.stringify(name)}`,
  );
}

const real = await savePhoto(pngBytes());
assert(
  real.ok,
  "the real file is still stored, so the refusals above were not blanket refusals",
);
const realName = real.ok ? real.value.filename : "";

assert(
  (await readPhoto(realName)) !== null,
  "a generated name is read back, so the guard accepts what savePhoto writes",
);
assert(
  path.resolve(photoPath(realName)) ===
    path.resolve(path.join(scratchDir, "data", "uploads", realName)),
  "and photoPath resolves inside the upload directory",
);

// =============================================================================
// 4. The private log
// =============================================================================

console.log(`\n--- the private log`);

reset();

assertEqual(
  readPrivateLog("2026-10-01").entries.length,
  0,
  "21. an empty log reads empty",
);
assertEqual(
  readPrivateLog("2026-10-01").types.length,
  2,
  "21. and both behaviours still have a row to show",
);

privateEntry("doom_scrolling", true, { note: "late again" });

const privates = readPrivateLog("2026-10-01");

assertEqual(privates.entries.length, 1, "22. an entry is stored and listed");
assertEqual(
  privates.entries[0].note,
  "late again",
  "22. with the user's own words",
);
assertEqual(
  privates.entries[0].label,
  "Doom scrolling",
  "22. labelled neutrally",
);
assertEqual(
  privates.types.find((entry) => entry.type === "doom_scrolling").recordedToday,
  true,
  "22. and the type's row knows it was recorded",
);
assert(
  !Object.keys(privates).some((field) =>
    /count|total|streak|score|percent|rate/i.test(field),
  ),
  "23. the private view exposes no field that holds a number",
);
assert(
  !Object.keys(privates.entries[0]).some((field) =>
    /count|total|streak|score|percent|rate/i.test(field),
  ),
  "23. and no field on an entry either",
);
assert(
  !Object.values(readPrivateLog("2026-10-01")).some(
    (value) => typeof value === "number",
  ),
  "23. nothing in the whole view is a number",
);

const outcome = privateEntry("masturbation", true);

assert(outcome.ok, "24. the command outcome carries the entry");
assert(
  outcome.ok &&
    !Object.values(outcome.value.change).some(
      (value) => typeof value === "number",
    ),
  "24. and the only non-string field is the row id, not a tally",
);

privateEntry("doom_scrolling", false);
assertEqual(
  row("SELECT COUNT(*) AS n FROM private_log").n,
  1,
  "25. a 'no' removes the entry rather than storing a row that says it did not happen",
);

assertRefusedCommand(
  privateEntry("doom_scrolling", true, { note: "x".repeat(501) }),
  "invalid_private_note",
  "25. a note over 500 characters is refused",
);

assertEqual(
  parseCommand({
    version: COMMAND_VERSION,
    kind: "private.log",
    type: "doom_scrolling",
    happened: true,
    count: 3,
  }).ok,
  false,
  "26. the command has no field for a count, so a proposed one is refused by name",
);

// =============================================================================
// 5. The Dashboard sees habits and cannot see the private log
// =============================================================================

console.log(`\n--- the Dashboard's reach`);

reset();
recordHabit("dishes", true, {}, "2026-10-01");
recordHabit("laundry", false, {}, "2026-10-01");
recordHabit("screen_time", true, { minutes: 120 }, "2026-10-01");
privateEntry("masturbation", true, {
  note: "a note the dashboard must never show",
});

const dashboard = readDashboard();

assertEqual(
  dashboard.habits.map((entry) => entry.type).join(" | "),
  "dishes | laundry",
  "27. the Dashboard shows the two neutral habits PRD 6.1 names",
);
assert(
  !dashboard.habits.some((entry) => entry.type === "screen_time"),
  "27. and does not present a measurement as a habit",
);
assertEqual(dashboard.habits[0].done, true, "27. with the stored completion");
assertEqual(
  dashboard.habits[1].done,
  false,
  "27. and the stored one for laundry too",
);
assertEqual(
  dashboard.skillsAvailable,
  true,
  "28. the urge entry point is available",
);
assert(
  !JSON.stringify(dashboard).includes("a note the dashboard must never show"),
  "28. no private note reaches the Dashboard model",
);
assert(
  !JSON.stringify(dashboard).includes("masturbation"),
  "28. and neither does the behaviour itself",
);

// =============================================================================
// 6. The photo route
// =============================================================================

console.log(`\n--- the photo route`);

reset();

const { boundary: crossBoundary, body: crossBody } = multipart(
  {},
  { name: "photo", filename: "a.png", type: "image/png", bytes: pngBytes() },
);
const crossOrigin = await PHOTO_POST(
  new Request("http://localhost:3000/api/photos", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${crossBoundary}`,
      origin: "https://example.invalid",
    },
    body: crossBody,
  }),
);

assertEqual(crossOrigin.status, 403, "29. a cross-origin upload is refused");
assertEqual(
  row("SELECT COUNT(*) AS n FROM habit_log").n,
  0,
  "29. and it wrote nothing",
);

const noFile = await PHOTO_POST(uploadRequest({ next: "/habits" }, undefined));
assertEqual(noFile.status, 400, "30. an upload with no file is refused");

const wrongType = await PHOTO_POST(
  uploadRequest(
    { type: "cooking", next: "/habits" },
    { name: "photo", filename: "a.png", type: "image/png", bytes: pngBytes() },
  ),
);
assertEqual(
  wrongType.status,
  400,
  "30. a photo that proves nothing is refused: laundry is the only thing that needs one",
);

const wrongDay = await PHOTO_POST(
  uploadRequest(
    { type: "laundry", day: "2026-10-01" },
    { name: "photo", filename: "a.png", type: "image/png", bytes: pngBytes() },
  ),
);
assertEqual(
  wrongDay.status,
  400,
  "30. and a calendar date is refused where a day word is required",
);

const good = await PHOTO_POST(
  uploadRequest(
    { type: "laundry", next: "/habits" },
    { name: "photo", filename: "a.png", type: "image/png", bytes: pngBytes() },
  ),
);
assertEqual(
  good.status,
  201,
  "31. a laundry photo with a picture in it is accepted",
);
const accepted = await good.json();
assertEqual(accepted.stored, true, "31. and reports that it was stored");
assert(
  typeof accepted.url === "string" && accepted.url.startsWith("/api/photos/"),
  "31. with the URL it will be served from",
);
assertEqual(
  row("SELECT done FROM habit_log WHERE type = 'laundry'").done,
  1,
  "31. and the day's laundry is recorded as done",
);

const serving = await PHOTO_FILE_GET(new Request("http://localhost/api"), {
  params: Promise.resolve({
    id: String(accepted.id),
    file: path.basename(accepted.url),
  }),
});
assertEqual(serving.status, 200, "32. the stored URL serves the bytes");
assertEqual(
  serving.headers.get("content-type"),
  "image/png",
  "32. with the type the bytes say, not one a caller sent",
);
assertEqual(
  serving.headers.get("x-content-type-options"),
  "nosniff",
  "32. and nosniff, because this is the one route that serves user bytes",
);

const notFound = await PHOTO_FILE_GET(new Request("http://localhost/api"), {
  params: Promise.resolve({
    id: String(accepted.id),
    file: "somebody-elses.png",
  }),
});
assertEqual(
  notFound.status,
  404,
  "33. a different filename for a real id reads nothing",
);

const badId = await PHOTO_FILE_GET(new Request("http://localhost/api"), {
  params: Promise.resolve({ id: "12abc", file: "a.png" }),
});
assertEqual(
  badId.status,
  404,
  "33. and a non-numeric id is a 404, not a lookup that guesses",
);

const wrongMethod = await PHOTO_GET();
assertEqual(
  wrongMethod.status,
  405,
  "34. the upload route refuses a read and names the URL that serves one",
);

// =============================================================================
// 7. A sentence is never proof
// =============================================================================

console.log(`\n--- a sentence is not a photo`);

reset();

const viaSentence = runCommand(
  { kind: "habit.record", type: "laundry", done: true },
  "2026-10-01T12:00:00.000Z",
);

assertRefusedCommand(
  viaSentence,
  "photo_required",
  "35. \'did laundry\' is refused without a photo",
);

const afterUpload = await storeLaundryPhoto(pngBytes(64), "2026-10-01");
const withPhoto = runCommand(
  { kind: "habit.record", type: "laundry", done: true },
  "2026-10-01T12:00:00.000Z",
);

assert(
  withPhoto.ok,
  "36. with a photo already stored for the day, the same sentence is accepted",
);
assertEqual(
  rows("SELECT photo_url FROM habit_log").length,
  1,
  "36. and it replaces the row rather than adding one",
);
assert(
  rows("SELECT photo_url FROM habit_log")[0].photo_url !== null,
  "36. keeping the photo already attached, so the replacement is not a deletion",
);
assert(afterUpload.ok, "36. the stored photo is untouched");

// =============================================================================
// 8. Nothing leaked, and the development database was not touched
// =============================================================================
console.log(`\n--- hygiene`);

assertEqual(
  fingerprint(developmentDatabase),
  developmentFingerprintBefore,
  "37. the development database was not opened by this suite",
);

releaseDatabase();
fs.rmSync(scratchDir, { recursive: true, force: true });
process.chdir(realCwd);

console.log(`\ntemporary database and uploads removed: ${scratchDir}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
