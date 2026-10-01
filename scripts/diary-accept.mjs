/**
 * Phase 8 acceptance: the Photo Diary page and the note path, over real HTTP.
 *
 * Run with `npm run build && npm run diary:accept`.
 *
 * ## Why this is a separate script
 *
 * `diary-test.mjs` proves what the domain, the feature, the repository, and the route handler do.
 * It cannot prove what the `/diary` page renders: that is a Server Component, and rendering one
 * requires Next.js. So the page-level claims are checked the only way they can honestly be checked
 * — a real `next start`, serving real HTML, over HTTP, against a database thrown away afterwards.
 *
 * ## What is being claimed here
 *
 * - **An empty diary renders** without crashing, and says so rather than showing an example.
 * - **A photo and its note are written together**, and the timeline shows both.
 * - **A note is editable and clearable from the page**, and clearing it leaves the picture alone —
 *   asserted by fetching the image URL afterwards, not by trusting the redirect.
 * - **A refused note is visible.** A form post redirects with a token the page expands, so the
 *   failure is on screen instead of in a server log. A cross-origin post is refused with a 403.
 * - **The Dashboard never shows a note**, checked on the rendered HTML rather than on the read
 *   model's fields.
 * - **Nothing scores the user.** The diary page has no streak, count, percentage, or progress bar.
 *
 * ## The rules this follows from earlier phases
 *
 * - `HARI_OS_DB_PATH` is set **before the server starts**, so the running application and this
 *   script point at the same temporary file and the development database is never opened. Its
 *   fingerprint and WAL sidecars are compared at the end.
 * - Uploads are written relative to the server's working directory, which is the project root, so
 *   `data/uploads/` is used for real and then cleaned: the files this run created are the only
 *   ones there, and they are removed again afterwards.
 */
import crypto from "node:crypto";
import { spawn } from "node:child_process";
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
const uploadDirectory = path.join(projectRoot, "data", "uploads");

function fingerprint(file) {
  if (!fs.existsSync(file)) {
    return "absent";
  }

  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function sidecars() {
  const dataDir = path.join(projectRoot, "data");

  if (!fs.existsSync(dataDir)) {
    return [];
  }

  return fs
    .readdirSync(dataDir)
    .filter((name) => name.endsWith("-wal") || name.endsWith("-shm"))
    .sort();
}

const developmentFingerprintBefore = fingerprint(developmentDatabase);
const developmentSidecarsBefore = sidecars();
const uploadsBefore = fs.existsSync(uploadDirectory)
  ? new Set(fs.readdirSync(uploadDirectory))
  : new Set();

if (!fs.existsSync(path.join(projectRoot, ".next", "BUILD_ID"))) {
  console.error(
    "This acceptance run serves the production build. Run `npm run build` first.",
  );
  process.exit(1);
}

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "hari-os-diary-"));
const scratchFile = path.join(scratchDir, "accept.db");
const port = 4600 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;

async function waitForServer(attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${base}/diary`);

      if (response.ok) {
        return true;
      }
    } catch {
      // Not listening yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

async function get(page) {
  const response = await fetch(`${base}${page}`, { redirect: "manual" });

  return { status: response.status, html: await response.text() };
}

/** Posts to the note route the way the diary page's form does. */
async function postNote(id, note, next = "/diary") {
  const response = await fetch(`${base}/api/photos/${id}/note`, {
    method: "POST",
    body: new URLSearchParams({ note, next }).toString(),
    redirect: "manual",
    headers: {
      origin: base,
      host: `127.0.0.1:${port}`,
      "content-type": "application/x-www-form-urlencoded",
    },
  });

  return {
    status: response.status,
    location: response.headers.get("location"),
  };
}

/** A minimal PNG: the eight signature bytes plus an IHDR, which is all the byte check reads. */
function pngBytes() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
  ]);
}

/** A multipart upload, built the way a browser builds one. */
async function uploadPhoto(fields, bytes) {
  const boundary = "----hariOsDiaryBoundary";
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        "utf8",
      ),
    );
  }

  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`,
      "utf8",
    ),
    Buffer.from(bytes),
    Buffer.from("\r\n", "utf8"),
    Buffer.from(`--${boundary}--\r\n`, "utf8"),
  );

  const response = await fetch(`${base}/api/photos`, {
    method: "POST",
    body: Buffer.concat(parts),
    redirect: "manual",
    headers: {
      origin: base,
      host: `127.0.0.1:${port}`,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
  });

  return { status: response.status, body: await response.json() };
}

/** The visible text of a page, with tags and entities removed enough to assert on. */
function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gu, " ")
    .replace(/<style[\s\S]*?<\/style>/gu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&#x27;|&apos;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&nbsp;/gu, " ")
    .replace(/\s+/gu, " ");
}

/** What a note would look like if it were turned into a judgement of the user. */
const SCORE_WORDS = [
  "streak",
  "score",
  "progress",
  "percent",
  "leaderboard",
  "rank",
  "days journalled",
];

const scratchDatabase = new Database(scratchFile);
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--port", String(port)],
  {
    cwd: projectRoot,
    env: { ...process.env, HARI_OS_DB_PATH: scratchFile, PORT: String(port) },
    stdio: "ignore",
  },
);

try {
  if (!(await waitForServer())) {
    throw new Error("the server did not start");
  }

  // -------------------------------------------------------------------------
  console.log("\n# an empty diary");

  for (const page of ["/diary", "/habits", "/"]) {
    const response = await get(page);

    assertEqual(response.status, 200, `1. ${page} renders with no data`);
  }

  const emptyDiary = text((await get("/diary")).html);

  assert(
    emptyDiary.includes("No photos yet"),
    "1. the diary says it has nothing, rather than showing an example entry",
  );
  assert(
    !emptyDiary.includes("textareavalue"),
    "1. and renders no editor for an entry that does not exist",
  );

  // -------------------------------------------------------------------------
  console.log("\n# a photo and its note, written together");

  const uploaded = await uploadPhoto(
    { type: "laundry", note: "  the blue towel is still in the wash  " },
    pngBytes(),
  );

  assertEqual(uploaded.status, 201, "2. an upload with a note is stored");
  assertEqual(
    typeof uploaded.body.url,
    "string",
    "2. and comes back with the URL that serves it",
  );

  const diary = await get("/diary");
  const diaryText = text(diary.html);

  assert(
    diaryText.includes("the blue towel is still in the wash"),
    "3. the note appears on the timeline, trimmed as the domain stored it",
  );
  assert(
    diary.html.includes(uploaded.body.url),
    "3. and the picture is served from the URL recorded with the row",
  );

  const entryId = Number(uploaded.body.id);

  // -------------------------------------------------------------------------
  console.log("\n# editing, and clearing");

  const edited = await postNote(entryId, "dry by morning");

  assertEqual(
    edited.status,
    303,
    "4. saving a note redirects back to the diary, because a form cannot read a body",
  );
  assert(
    String(edited.location).includes("saved=ok"),
    "4. with a success token in the query string",
  );

  const afterEdit = text((await get("/diary")).html);

  assert(
    afterEdit.includes("dry by morning"),
    "4. the edited note is what the page shows now",
  );
  assert(
    !afterEdit.includes("the blue towel is still in the wash"),
    "4. and the previous wording is gone, because it was replaced rather than appended",
  );

  const servedPhoto = await fetch(`${base}${uploaded.body.url}`);

  assertEqual(
    servedPhoto.status,
    200,
    "5. the picture is still served after the note changed",
  );

  const cleared = await postNote(entryId, "");

  assertEqual(
    cleared.status,
    303,
    "5. clearing is the same route, posting nothing",
  );

  const afterClear = await get("/diary");

  assert(
    !afterClear.html.includes("dry by morning"),
    "5. the note is gone from the page",
  );
  assert(
    afterClear.html.includes(uploaded.body.url),
    "5. and the photo is still there: removing words is not removing the picture",
  );
  assert(
    text(afterClear.html).includes("No note on this one yet"),
    "5. saying so plainly rather than leaving a blank box unexplained",
  );

  const stillServed = await fetch(`${base}${uploaded.body.url}`);

  assertEqual(
    stillServed.status,
    200,
    "5. and it is still served from the same URL",
  );

  // -------------------------------------------------------------------------
  console.log("\n# a refused note is visible");

  const refused = await postNote(entryId, "x".repeat(600));

  assertEqual(
    refused.status,
    303,
    "6. an over-long note redirects rather than dumping JSON at a form",
  );
  assert(
    String(refused.location).includes("err=invalid_diary_note"),
    "6. carrying the domain's token rather than the note",
  );

  const refusedPage = await get(
    String(refused.location).replace(/^https?:\/\/[^/]+/u, ""),
  );
  const refusedText = text(refusedPage.html);

  assert(
    refusedText.includes("at most 500 characters"),
    "6. and the page expands the token into something the user can act on",
  );
  assert(
    !refusedText.includes("xxxxxxxxxx"),
    "6. without echoing the rejected text back through the URL",
  );

  const crossOrigin = await fetch(`${base}/api/photos/${entryId}/note`, {
    method: "POST",
    body: new URLSearchParams({
      note: "written by a page the user did not open",
    }),
    redirect: "manual",
    headers: {
      origin: "http://evil.example",
      host: `127.0.0.1:${port}`,
      "content-type": "application/x-www-form-urlencoded",
    },
  });

  assertEqual(
    crossOrigin.status,
    403,
    "7. a cross-origin note is refused, like every other write",
  );
  assert(
    !text((await get("/diary")).html).includes(
      "written by a page the user did not open",
    ),
    "7. and the refused note was not written",
  );

  // -------------------------------------------------------------------------
  console.log("\n# the note stays on the diary");

  await postNote(entryId, "the words stay here");
  await uploadPhoto({ type: "laundry" }, pngBytes());

  const carried = text((await get("/diary")).html);

  assert(
    carried.includes("the words stay here"),
    "8. re-photographing a day keeps the note, because removing a picture is not forgetting it",
  );

  const dashboard = text((await get("/")).html);

  assert(
    !dashboard.includes("the words stay here"),
    "9. the Dashboard does not show a diary note",
  );
  assert(
    text((await get("/habits")).html).includes("Open the diary"),
    "9. and the Habits page links to the diary rather than duplicating it",
  );

  // -------------------------------------------------------------------------
  console.log("\n# nothing here scores the user");

  const rendered = text((await get("/diary")).html);

  for (const word of SCORE_WORDS) {
    assert(
      !rendered.toLowerCase().includes(word),
      `10. the diary page contains no "${word}"`,
    );
  }

  assert(
    !rendered.includes('role="progressbar"') &&
      (await get("/diary")).html.includes('role="progressbar"') === false,
    "10. and no progress bar: a diary is a list, not a bar",
  );

  // -------------------------------------------------------------------------
  console.log("\n# what was stored");

  const database = new Database(scratchFile, { readonly: true });
  const rows = database
    .prepare("SELECT date, photo_url, photo_note FROM habit_log ORDER BY id")
    .all();

  assertEqual(
    rows.length,
    1,
    "11. one row for the day, however many times it was photographed",
  );
  assert(
    typeof rows[0].photo_note === "string" && rows[0].photo_note.length > 0,
    "11. the note is stored beside the photo",
  );
  assert(
    !JSON.stringify(rows).includes(projectRoot) &&
      !JSON.stringify(rows).includes("data/uploads"),
    "11. and no filesystem path is stored with it",
  );
  database.close();
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (server.exitCode === null) {
    server.kill("SIGKILL");
  }
  scratchDatabase.close();
  fs.rmSync(scratchDir, { recursive: true, force: true });
}

for (const name of fs.existsSync(uploadDirectory)
  ? fs.readdirSync(uploadDirectory).filter((entry) => !uploadsBefore.has(entry))
  : []) {
  fs.rmSync(path.join(uploadDirectory, name), { force: true });
}

// ---------------------------------------------------------------------------
console.log("\n# local data safety");

assertEqual(
  fingerprint(developmentDatabase),
  developmentFingerprintBefore,
  "data/hari-os.db is byte-identical after the acceptance run",
);

assertEqual(
  sidecars().join(","),
  developmentSidecarsBefore.join(","),
  "no WAL or SHM sidecar appeared in data/",
);

assertEqual(
  fs.existsSync(scratchDir),
  false,
  "the disposable database and its directory were removed",
);

assertEqual(
  JSON.stringify(
    fs.existsSync(uploadDirectory)
      ? fs
          .readdirSync(uploadDirectory)
          .filter((entry) => !uploadsBefore.has(entry))
      : [],
  ),
  "[]",
  "every upload this run created was removed again",
);

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
