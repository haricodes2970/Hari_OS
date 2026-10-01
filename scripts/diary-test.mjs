/**
 * Phase 8 tests: diary notes on laundry photos.
 *
 * Run with `npm run diary:test`.
 *
 * ## What this file is for
 *
 * The pure rules are in `domain-test.mjs`. What is only visible here is the set of claims Phase 8
 * is judged on, and half of them are claims about things that must **not** happen — the kind of
 * claim that passes silently the moment it stops being true:
 *
 * 1. **A note belongs to a real photo.** A note on a row with no picture is refused with
 *    `unknown_photo` and nothing is written.
 * 2. **A rejected note changes nothing.** Not the stored note, not the file, not the row. This is
 *    asserted after the fact by reading the database rather than by trusting the return value,
 *    because a function that returns a refusal and writes anyway would pass the first check.
 * 3. **Uploading a photo keeps the note it replaces.** A day is one row, so re-photographing
 *    deletes and reinserts — and a user who takes a better picture of the same shelf has not
 *    asked to lose what they wrote about the first one.
 * 4. **The diary is read in one place.** The Dashboard's projection is asserted by shape: no
 *    diary module is imported into it, and no field in it could hold a note.
 * 5. **The route is a route.** Cross-origin refused, a non-numeric id is a 404 rather than a
 *    lookup, an unreadable body cannot clear a stored note, and a form post redirects with a token
 *    rather than a page's worth of prose.
 *
 * ## The database, established first
 *
 * `HARI_OS_DB_PATH` is set before any storage-capable import, because the composition root caches
 * its connection on first use, and the process chdirs into a scratch directory so `savePhoto`
 * cannot write into the developer's `data/uploads`. The development database's fingerprint is
 * taken before any import and asserted at the end.
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
  if (Object.is(actual, expected)) {
    ok(message);
  } else {
    bad(
      `${message} (expected ${String(expected)}, received ${String(actual)})`,
    );
  }
}

/** A domain refusal, with its code. */
function assertRefused(result, code, message) {
  assertEqual(result.ok, false, `${message} — refused`);
  assertEqual(
    result.ok || result.kind !== "domain" ? null : result.error.code,
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
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "hari-os-diary-"));
const scratchFile = path.join(scratchDir, "diary.db");
process.env.HARI_OS_DB_PATH = scratchFile;

const realCwd = process.cwd();
process.chdir(scratchDir);

const { migrate } = await import("../src/lib/db/migrations.ts");
const { releaseDatabase } =
  await import("../src/features/shared/command-runtime.ts");
const { storeLaundryPhoto } = await import("../src/features/habits/photos.ts");
const { diarySummary, readDiary, readDiaryEntry, writeNote } =
  await import("../src/features/habits/diary.ts");
const { readDashboard } = await import("../src/features/dashboard/view.ts");
const { readHabits } = await import("../src/features/habits/view.ts");
const { POST: PHOTO_POST } = await import("../src/app/api/photos/route.ts");
const { executeCommand } = await import("../src/commands/executor.ts");
const { COMMAND_VERSION } = await import("../src/commands/contract.ts");
const { createRepositories } = await import("../src/lib/db/repositories.ts");
const { POST: NOTE_POST, GET: NOTE_GET } =
  await import("../src/app/api/photos/[id]/note/route.ts");

migrate(new Database(scratchFile));

const scratch = new Database(scratchFile);
scratch.pragma("foreign_keys = ON");
const repositories = createRepositories(scratch);

/** The same command path the endpoint uses, with the same clock. */
function runCommand(command, at = "2026-10-01T12:00:00.000Z") {
  return executeCommand(
    { version: COMMAND_VERSION, ...command },
    { repositories, now: () => at },
  );
}

const row = (sql, ...args) => scratch.prepare(sql).get(...args);
const count = (sql, ...args) => scratch.prepare(sql).get(...args).n;

/** How many files are in the scratch upload directory right now. */
function uploadCount() {
  return fs.readdirSync(path.join(scratchDir, "data", "uploads")).length;
}

/** The note as stored, read past every function that might have written it. */
function storedNote(id) {
  const found = row("SELECT photo_note FROM habit_log WHERE id = ?", id);

  return found === undefined ? "<no row>" : found.photo_note;
}

function reset() {
  scratch.exec("DELETE FROM habit_log;");
}

async function uploadPhoto(day, note = null) {
  return storeLaundryPhoto(pngBytes(64), day, note);
}

/**
 * A minimal valid PNG: the eight signature bytes, then an IHDR long enough for the signature
 * check and nothing else. Never decoded — storage reads bytes, not images.
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

/** A `multipart/form-data` body, built by hand because there is no `FormData` in Node's fetch. */
function multipart(fields, file) {
  const boundary = `----haritos${Math.random().toString(16).slice(2)}`;
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
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`,
        "utf8",
      ),
      file,
      Buffer.from("\r\n", "utf8"),
    );
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));

  return { boundary, body: Buffer.concat(parts) };
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

/** A form post to the note route, as the diary page's form sends one. */
function noteRequest(id, note, extra = {}) {
  const fields = { note, next: "/diary", ...extra };
  const { boundary, body } = multipart(fields);

  return {
    url: `http://localhost:3000/api/photos/${id}/note`,
    request: new Request(`http://localhost:3000/api/photos/${id}/note`, {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        origin: "http://localhost:3000",
      },
      body,
    }),
  };
}

function noteContext(id) {
  return { params: Promise.resolve({ id: String(id) }) };
}

// =============================================================================
// 1. A note is written beside a photo, and only beside a photo
// =============================================================================

console.log(`\n--- a note belongs to a photo`);

reset();

const emptyDiary = readDiary();

assertEqual(
  emptyDiary.length,
  0,
  "1. an empty diary reads as empty rather than crashing",
);
assertEqual(
  readDiaryEntry(999),
  null,
  "1. and an entry that does not exist reads as null, not as an error",
);

const firstUpload = await uploadPhoto("2026-10-01", "shelves are clean");

assert(firstUpload.ok, "2. a photo and a note can be uploaded as one moment");

const firstId = firstUpload.ok ? firstUpload.value.id : 0;

assertEqual(
  storedNote(firstId),
  "shelves are clean",
  "2. and the note is stored on the row that owns the photo",
);

const written = writeNote(firstId, "  towels folded too  ");

assert(
  written.ok && written.value.entry.note === "towels folded too",
  "3. a note can be changed afterwards",
);
assertEqual(
  written.ok ? written.value.cleared : null,
  false,
  "3. and changing one is not reported as clearing one",
);
assertEqual(
  storedNote(firstId),
  "towels folded too",
  "3. the change reached the database",
);

const cleared = writeNote(firstId, "   ");

assert(
  cleared.ok && cleared.value.entry.note === null && cleared.value.cleared,
  "4. whitespace clears the note, because it is what 'no note' means",
);
assertEqual(
  storedNote(firstId),
  null,
  "4. and the stored note is null rather than an empty string",
);

const noPhotoRow = row(
  "INSERT INTO habit_log (date, type, done) VALUES ('2026-10-02', 'cooking', 1) RETURNING id",
);

assertRefused(
  writeNote(noPhotoRow.id, "a note with no picture"),
  "unknown_photo",
  "5. a note on a row with no photo is refused",
);
assertEqual(
  storedNote(noPhotoRow.id),
  null,
  "5. and nothing was written: the refusal is not a write that stored nothing",
);

const unknownId = writeNote(424242, "a note about a photo that is not there");

assertRefused(
  unknownId,
  "unknown_photo",
  "6. an unknown entry is the same refusal",
);

const tooLong = writeNote(firstId, "x".repeat(501));

assertRefused(tooLong, "invalid_diary_note", "7. an over-long note is refused");
assertEqual(
  storedNote(firstId),
  null,
  "7. and the stored note is untouched, so a rejected edit cannot lose words",
);

const withControl = writeNote(firstId, "bad\u0000note");

assertRefused(
  withControl,
  "invalid_diary_note",
  "8. so is a control character",
);

// =============================================================================
// 2. The timeline, and what it leaves out
// =============================================================================

console.log(`\n--- the timeline`);

reset();

await uploadPhoto("2026-10-01", "first");
await uploadPhoto("2026-10-03");
const newest = await uploadPhoto("2026-10-05", "newest");

assert(newest.ok, "9. three entries on three days");

const diary = readDiary();

assertEqual(
  diary.map((entry) => entry.date).join(","),
  "2026-10-05,2026-10-03,2026-10-01",
  "10. newest first",
);
assertEqual(diary[0].note, "newest", "11. each entry carries its own note");
assertEqual(
  diary[1].note,
  null,
  "11. an entry with no note reports null rather than an empty string",
);
assert(
  diary.every((entry) => entry.photoUrl.startsWith("/api/photos/")),
  "12. and every entry's photo is an application URL, never a filesystem path",
);
assert(
  !JSON.stringify(diary).includes(scratchDir),
  "12. no entry leaks the upload directory",
);

const twoOnOneDay = await uploadPhoto("2026-10-03");

assert(twoOnOneDay.ok, "13. re-photographing a day replaces that day's row");
assertEqual(
  count("SELECT COUNT(*) AS n FROM habit_log WHERE date = '2026-10-03'"),
  1,
  "13. and a day is still one row",
);

const sameDayOrder = readDiary()
  .filter((entry) => entry.date === "2026-10-03")
  .map((entry) => entry.id);

assertEqual(
  sameDayOrder.length,
  1,
  "14. so the diary shows the entry that exists, not a duplicate",
);

// =============================================================================
// 3. A note is never lost to a better photograph
// =============================================================================

console.log(`\n--- a re-upload keeps the words`);

reset();

const beforeReupload = await uploadPhoto("2026-10-01", "the words I wrote");

assert(beforeReupload.ok, "15. a photo with a note");

const oldId = beforeReupload.ok ? beforeReupload.value.id : 0;

await uploadPhoto("2026-10-01", null);

const afterReupload = readDiary();

assertEqual(
  afterReupload.length,
  1,
  "16. re-uploading the same day leaves one entry, not two",
);
assertEqual(
  afterReupload[0].note,
  "the words I wrote",
  "16. and the note survives, because replacing a photo is not forgetting it",
);
assertEqual(
  afterReupload[0].id,
  oldId,
  "16. and it is the same row: an entry's id stays with its entry, so a note addressed to this id cannot land on another day's photo",
);

await uploadPhoto("2026-10-02", "written today");

await uploadPhoto("2026-10-02", "written again");

const secondDay = readDiary().find((entry) => entry.date === "2026-10-02");

assertEqual(
  secondDay?.note,
  "written again",
  "17. and a note typed with the new upload wins over the carried one",
);

await uploadPhoto("2026-10-03", "keep me");

await uploadPhoto("2026-10-03", "");

const thirdDay = readDiary().find((entry) => entry.date === "2026-10-03");

assertEqual(
  thirdDay?.note,
  "keep me",
  "18. an empty box means 'the user said nothing', not 'delete what was written'",
);

// =============================================================================
// 4. The diary is not on the Dashboard
// =============================================================================

console.log(`\n--- the diary is read in one place`);

reset();

await uploadPhoto("2026-10-01", "a note the dashboard must not receive");
await uploadPhoto("2026-10-02", "another one");

const dashboard = readDashboard("2026-10-01");

assert(
  !JSON.stringify(dashboard).includes("a note the dashboard must not receive"),
  "19. the Dashboard does not contain a diary note",
);
assert(
  !JSON.stringify(dashboard).toLowerCase().includes("photo_note") &&
    !JSON.stringify(dashboard).toLowerCase().includes("photonote"),
  "19. and no field in it could hold one",
);

const habitsView = readHabits("2026-10-01");

assert(
  !JSON.stringify(habitsView).includes("a note the dashboard must not receive"),
  "20. the Habits read model does not carry notes either: the diary page reads them itself",
);

const dashboardSource = fs.readFileSync(
  path.join(projectRoot, "src", "features", "dashboard", "view.ts"),
  "utf8",
);

assert(
  !dashboardSource.includes("habits/diary"),
  "20. and the Dashboard does not import the diary module, so there is no path to audit",
);

// Phase 9. A third reader appeared without anyone adding a reader: `executeCommand` re-reads the
// row it wrote, and the command endpoint answers a JSON caller with that result verbatim. A diary
// note on a re-recorded day was therefore in the body of a command response. The row is now
// projected, and these two assertions are the ones that would catch it coming back.
{
  // The clock is the 1st, so "today" is the day this section photographed and gave a note to.
  const executed = runCommand({
    kind: "habit.record",
    type: "laundry",
    done: true,
  });

  assert(
    executed.ok,
    "20. a habit command on a day that has a note still succeeds",
  );

  const change = executed.ok ? JSON.stringify(executed.value) : "";

  assert(
    executed.ok &&
      executed.value.change !== undefined &&
      !change.includes("a note the dashboard must not receive"),
    "20. and its result carries no diary note, so the note is readable only from the diary",
  );
  assert(
    executed.ok &&
      !change.toLowerCase().includes("photonote") &&
      !change.toLowerCase().includes("photo_note"),
    "20. and no field in it could hold one either",
  );
}

const summary = diarySummary(readDiary());

assert(
  typeof summary === "string" && !/\d+\s*(notes? written|score)/i.test(summary),
  "21. the summary is a sentence about entries, not a score of the user",
);

// =============================================================================
// 5. The note route
// =============================================================================

console.log(`\n--- the note route`);

reset();

const routed = await uploadPhoto("2026-10-01");

assert(routed.ok, "22. a photo to write about");

const routeId = routed.ok ? routed.value.id : 0;

const crossOrigin = await NOTE_POST(
  new Request(`http://localhost:3000/api/photos/${routeId}/note`, {
    method: "POST",
    headers: { origin: "http://evil.example" },
    body: new URLSearchParams({ note: "written by another page" }),
  }),
  noteContext(routeId),
);

assertEqual(
  crossOrigin.status,
  403,
  "23. a cross-origin note is refused, like every other write",
);
assertEqual(
  storedNote(routeId),
  null,
  "23. and nothing was written by the page that was refused",
);

const goodPost = noteRequest(routeId, "wrote it in the diary");

const saved = await NOTE_POST(goodPost.request, noteContext(routeId));

assertEqual(
  saved.status,
  303,
  "24. a form post redirects, because a form cannot read a response body",
);
assert(
  /\/diary\?saved=ok&msg=/u.test(String(saved.headers.get("location"))),
  "24. back to the diary with an outcome token, not with the note in the URL",
);
assertEqual(
  storedNote(routeId),
  "wrote it in the diary",
  "24. and the note was written",
);

const clearPost = noteRequest(routeId, "");

const clearedResponse = await NOTE_POST(
  clearPost.request,
  noteContext(routeId),
);

assertEqual(
  clearedResponse.status,
  303,
  "25. clearing is the same route posting the same field empty",
);
assertEqual(storedNote(routeId), null, "25. and it clears the note");

// Phase 9. An absent `note` field and an empty one used to be the same request, so a form with a
// misspelled field name deleted what the user had written. The clear button posts an empty field
// deliberately; a broken form must not be able to do the same by accident.
{
  const withWords = await uploadPhoto(
    "2026-10-06",
    "words that must survive a broken form",
  );
  const id = withWords.ok ? withWords.value.id : 0;
  const { boundary, body } = multipart({ notnote: "a typo", next: "/diary" });

  const response = await NOTE_POST(
    new Request(`http://localhost:3000/api/photos/${id}/note`, {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        origin: "http://localhost:3000",
      },
      body,
    }),
    noteContext(id),
  );

  assert(
    response.status === 400 ||
      !String(response.headers.get("location") ?? "").includes("saved=ok"),
    "25. and the broken form was refused rather than reported as a clear",
  );

  assertEqual(
    storedNote(id),
    "words that must survive a broken form",
    "25. a note written before a broken form is still there afterwards",
  );
}

const refusedPost = noteRequest(routeId, "x".repeat(501));

const refusedResponse = await NOTE_POST(
  refusedPost.request,
  noteContext(routeId),
);

assertEqual(
  refusedResponse.status,
  303,
  "26. a refused note redirects rather than dumping JSON at a form",
);
assert(
  String(refusedResponse.headers.get("location")).includes(
    "err=invalid_diary_note",
  ),
  "26. carrying the domain's own token",
);

const jsonPost = await NOTE_POST(
  new Request(`http://localhost:3000/api/photos/${routeId}/note`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({ note: "through the API" }),
  }),
  noteContext(routeId),
);

assertEqual(
  jsonPost.status,
  201,
  "27. a JSON caller gets JSON, not a redirect",
);
assertEqual(
  storedNote(routeId),
  "through the API",
  "27. and the note was written",
);

const jsonCleared = await NOTE_POST(
  new Request(`http://localhost:3000/api/photos/${routeId}/note`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({ note: "" }),
  }),
  noteContext(routeId),
);

assertEqual(jsonCleared.status, 201, "28. and an empty JSON note clears it");
assertEqual(storedNote(routeId), null, "28. cleared");

const badId = await NOTE_POST(
  noteRequest("12abc", "a note about a URL that is not an id").request,
  noteContext("12abc"),
);

assertEqual(
  badId.status,
  404,
  "29. a non-numeric id is a 404, not a lookup that guesses",
);

const unknown = await NOTE_POST(
  noteRequest(987654, "a note about an entry that does not exist").request,
  noteContext(987654),
);

assertEqual(
  unknown.status,
  303,
  "30. a form post to an entry that does not exist redirects rather than showing JSON",
);
assert(
  String(unknown.headers.get("location")).includes("err=unknown_photo"),
  "30. carrying the token that says why",
);

const unknownJson = await NOTE_POST(
  new Request("http://localhost:3000/api/photos/987654/note", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({ note: "a note about an entry that is not there" }),
  }),
  noteContext(987654),
);

assertEqual(
  unknownJson.status,
  400,
  "30. while a JSON caller is told outright",
);

const unreadable = await NOTE_POST(
  new Request(`http://localhost:3000/api/photos/${routeId}/note`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      origin: "http://localhost:3000",
    },
    body: "{not json",
  }),
  noteContext(routeId),
);

assertEqual(unreadable.status, 400, "31. an unreadable body is refused");
assertEqual(
  storedNote(routeId),
  null,
  "31. and cannot be used to delete a note: a malformed request writes nothing",
);

const wrongMethod = await NOTE_GET();

assertEqual(
  wrongMethod.status,
  405,
  "32. the note route refuses a read and names the page that shows notes",
);

// =============================================================================
// 6. The upload route takes a note, and validates it before the file
// =============================================================================

console.log(`\n--- uploading with a note`);

reset();

const uploadWithNote = await PHOTO_POST(
  uploadRequest(
    { type: "laundry", next: "/habits", note: "  both loads in  " },
    pngBytes(64),
  ),
);

assertEqual(
  uploadWithNote.status,
  201,
  "33. an upload carrying a note is stored",
);

const uploadedEntry = readDiary()[0];

assertEqual(
  uploadedEntry?.note,
  "both loads in",
  "33. and the note is stored beside the photo, trimmed",
);

const filesBefore = uploadCount();
const tooLongUpload = await PHOTO_POST(
  uploadRequest({ type: "laundry", note: "x".repeat(501) }, pngBytes(64)),
);

assertEqual(
  tooLongUpload.status,
  400,
  "34. an upload whose note cannot be stored is refused",
);
assertEqual(
  uploadCount(),
  filesBefore,
  "34. before the file is written, so a bad note never costs the user their photo",
);
assertEqual(
  count("SELECT COUNT(*) AS n FROM habit_log WHERE photo_url IS NOT NULL"),
  1,
  "34. and before any row is replaced, so the earlier entry is still there",
);

const uploadWithoutNote = await PHOTO_POST(
  uploadRequest({ type: "laundry" }, pngBytes(64)),
);

assertEqual(
  uploadWithoutNote.status,
  201,
  "35. an upload with no note field at all still works",
);
assertEqual(
  readDiary()[0].note,
  "both loads in",
  "35. and the note written with the first upload is carried onto the new one",
);

// =============================================================================
// 7. Hygiene
// =============================================================================

console.log(`\n--- hygiene`);

assertEqual(
  fingerprint(developmentDatabase),
  developmentFingerprintBefore,
  "36. the development database was not opened by this suite",
);

assert(
  !fs
    .readdirSync(path.join(projectRoot, "data", "uploads"))
    .some((name) => name.endsWith(".jpg")),
  "36. and nothing was written into the real upload directory",
);

releaseDatabase();
fs.rmSync(scratchDir, { recursive: true, force: true });
process.chdir(realCwd);

console.log(`\ntemporary database and uploads removed: ${scratchDir}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
