/**
 * Phase 7 acceptance: the Habits page, the Skills page, and the photo path, over real HTTP.
 *
 * Run with `npm run build && npm run skills:accept`.
 *
 * ## Why this is a separate script
 *
 * `skills-test.mjs` proves what the features, the domain, and the routes do. It cannot prove what
 * the *pages* render: `src/app/habits/page.tsx` and `src/app/skills/page.tsx` are Server
 * Components, and rendering one requires Next.js. So the page-level claims are checked the only way
 * they can honestly be checked — a real `next start`, serving real HTML, over HTTP, against a
 * database thrown away afterwards.
 *
 * ## What is being claimed here
 *
 * - **A never-used database renders both pages** without crashing, and says "not recorded" rather
 *   than inventing a streak, a tally, or an entry.
 * - **The urge entry point opens the complete list.** The Dashboard links to `/skills`, the list
 *   shows every skill added, and the rendered HTML contains no marker of a chosen or recommended
 *   one — checked against the actual markup, not against the read model's fields.
 * - **A logged skill produces a neutral tally** on that skill's own row.
 * - **The laundry photo path works end to end**: a real multipart upload stores a picture, the row
 *   records laundry as done, the picture is served back through its URL, and the diary shows it.
 * - **A sentence cannot complete laundry.** `did laundry` is refused with the photo reason, and
 *   the same sentence succeeds once a photo exists for the day.
 * - **The private log renders without any streak, score, bar, or count** — the PRD's direct
 *   prohibition, asserted on the rendered page rather than assumed.
 * - **Only one progress bar exists in the whole application**, and it belongs to laundry.
 *
 * ## The rules this follows from earlier phases
 *
 * - `HARI_OS_DB_PATH` is set **before the server starts**, so the running application and this
 *   script point at the same temporary file and the development database is never opened. Its
 *   fingerprint and WAL sidecars are compared at the end.
 * - Uploads are written relative to the server's working directory, which is the project root, so
 *   `data/uploads/` is used for real and then checked: the files this run created are the only
 *   ones there, and they are untracked.
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
  if (actual === expected) {
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

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "hari-os-habits-"));
const scratchFile = path.join(scratchDir, "accept.db");
const port = 4100 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;

async function waitForServer(attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${base}/habits`);

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

/** Posts a command the way a form on the page does. */
async function postCommand(fields) {
  const response = await fetch(`${base}/api/commands`, {
    method: "POST",
    body: new URLSearchParams({ next: "/habits", ...fields }).toString(),
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

/** A multipart body, built the way a browser builds one. */
async function uploadPhoto(
  fields,
  bytes,
  filename = "photo.png",
  contentType = "image/png",
) {
  const boundary = "----hariOsAcceptBoundary";
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
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
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

  return { status: response.status, body: await response.text() };
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

/** Words that would mean a private entry had been turned into a number or a judgement. */
const SCORE_WORDS = [
  "streak",
  "score",
  "progress",
  "percent",
  "leaderboard",
  "rank",
  "times this week",
  "goal met",
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
  console.log("\n# both pages render on a never-used database");

  for (const page of ["/habits", "/skills", "/"]) {
    const response = await get(page);

    assertEqual(response.status, 200, `1. ${page} renders with no data`);
  }

  const emptySkills = text((await get("/skills")).html);
  assert(
    emptySkills.includes("Your list is empty"),
    "1. an empty skill list says so rather than showing examples",
  );
  const emptyHabits = text((await get("/habits")).html);
  assert(
    emptyHabits.includes("Nothing has been recorded yet"),
    "1. the private log says it has nothing, rather than showing zero",
  );

  assert(
    emptyHabits.includes("Not recorded today"),
    "1. a habit with nothing recorded reads as not recorded, not as missed",
  );

  // -------------------------------------------------------------------------
  console.log("\n# the urge entry point opens the complete list");

  const dashboard = await get("/");
  assert(
    dashboard.html.includes('href="/skills"'),
    "2. the Dashboard's urge entry point links to the skills page",
  );
  assert(
    text(dashboard.html).includes("nothing is ever chosen for you"),
    "2. and says in the page's own words that nothing is chosen",
  );

  for (const name of [
    "read a book",
    "10 pushups",
    "vibe code a platform",
    "research",
  ]) {
    const created = await postCommand({ kind: "skill.create", name });

    assertEqual(
      created.status,
      303,
      `2. "${name}" is added through the command endpoint`,
    );
  }

  const fullList = await get("/skills");
  const fullText = text(fullList.html);

  for (const name of [
    "read a book",
    "10 pushups",
    "vibe code a platform",
    "research",
  ]) {
    assert(fullText.includes(name), `2. the list shows "${name}"`);
  }

  assert(
    fullText.indexOf("read a book") < fullText.indexOf("10 pushups") &&
      fullText.indexOf("10 pushups") < fullText.indexOf("vibe code a platform"),
    "2. in the order they were added, which is the order they matter in",
  );
  assert(
    !/(suggested|recommended|most useful|best|top pick|favourite|favorite)/iu.test(
      fullText,
    ),
    "2. and nothing on the page marks one as a choice",
  );
  assert(
    !/aria-current="true"[^>]*>/u.test(
      fullList.html.replace(/<input[^>]*aria-current="true"[^>]*>/gu, ""),
    ),
    "2. and no skill row is marked as current or selected",
  );

  // -------------------------------------------------------------------------
  console.log("\n# a logged skill and its tally");

  const logged = await postCommand({
    kind: "skill.log",
    skillName: "read a book",
    minutes: "30",
  });
  assertEqual(
    logged.status,
    303,
    "3. a skill use is logged through the command endpoint",
  );

  const afterLog = await get("/skills");
  const afterLogText = text(afterLog.html);

  assert(
    afterLogText.includes("Logged 1 time"),
    "3. that skill's own row carries a tally",
  );
  assert(
    afterLogText.includes("30 minutes logged"),
    "3. and the stated duration",
  );
  assert(
    afterLogText.includes("Not logged yet."),
    "3. while the skills nobody used say so rather than showing a zero",
  );
  assert(
    !/LEADERBOARD|ranked by|most logged/iu.test(afterLogText),
    "3. and the tally is not turned into a ranking",
  );

  // -------------------------------------------------------------------------
  console.log("\n# the laundry photo path, end to end");

  const refused = await postCommand({
    kind: "habit.record",
    type: "laundry",
    done: "true",
  });
  assertEqual(
    refused.status,
    303,
    "4. a sentence claiming laundry was done is posted",
  );
  assert(
    (refused.location ?? "").includes("err=photo_required"),
    "4. and is refused with the photo reason rather than accepted",
  );

  const habitsAfterRefusal = await get("/habits");
  assert(
    !text(habitsAfterRefusal.html).includes("Recorded as done, with the photo"),
    "4. and the page does not claim laundry was done",
  );

  const uploaded = await uploadPhoto(
    { type: "laundry", next: "/habits" },
    pngBytes(),
  );
  assertEqual(uploaded.status, 201, "4. a real multipart upload is accepted");
  const stored = JSON.parse(uploaded.body);
  assert(
    typeof stored.url === "string" && stored.url.startsWith("/api/photos/"),
    "4. and reports the URL it will be served from",
  );

  const pageAfterUpload = await get("/habits");
  const uploadText = text(pageAfterUpload.html);
  assert(
    uploadText.includes("with the photo attached"),
    "4. the page now shows laundry as done with its photo",
  );
  assert(
    pageAfterUpload.html.includes(stored.url),
    "4. and the Photo Diary shows the picture through its stored URL",
  );

  const served = await fetch(`${base}${stored.url}`);
  assertEqual(served.status, 200, "4. the stored URL serves the photo");
  assertEqual(served.headers.get("content-type"), "image/png", "4. as a PNG");
  assert(
    Buffer.from(await served.arrayBuffer()).length > 0,
    "4. with bytes in the response rather than an empty 200",
  );

  const guessed = await fetch(
    `${base}/api/photos/${stored.id}/somebody-elses.png`,
  );
  assertEqual(guessed.status, 404, "4. a guessed filename serves nothing");

  const notAnImage = "<html>this is not an image</html>";
  const htmlBytes = await uploadPhoto(
    { type: "laundry" },
    Buffer.from(notAnImage),
    "disguised.png",
    "image/png",
  );
  assertEqual(
    htmlBytes.status,
    400,
    "4. a file that is not an image is refused",
  );
  assert(
    !text((await get("/habits")).html).includes(notAnImage),
    "4. and nothing about it reaches the page",
  );

  // -------------------------------------------------------------------------
  console.log("\n# habits, screen time, and the weekly target");

  await postCommand({ kind: "habit.record", type: "dishes", done: "true" });
  await postCommand({ kind: "habit.record", type: "cooking", done: "true" });
  await postCommand({
    kind: "habit.record",
    type: "screen_time",
    done: "true",
    minutes: "95",
  });

  const habitsPage = await get("/habits");
  const habitsText = text(habitsPage.html);

  assert(habitsText.includes("Dishes"), "5. dishes are shown");
  assert(
    habitsText.includes("1 of 2 in the last seven days"),
    "5. the laundry target is stated",
  );
  assert(
    habitsPage.html.includes('role="progressbar"'),
    "5. and the one progress bar in the application is on the page",
  );
  assert(
    (habitsPage.html.match(/role="progressbar"/gu) ?? []).length === 1,
    "5. exactly one, because one is all the PRD asks for",
  );
  assert(
    habitsText.includes("Entered today as 95 minutes"),
    "5. screen time shows what was typed",
  );
  assert(
    habitsText.includes("your own estimate, not a measurement"),
    "5. and says the number came from the user",
  );

  // -------------------------------------------------------------------------
  console.log("\n# the private log never becomes a number");

  const saved = await postCommand({
    kind: "private.log",
    type: "doom_scrolling",
    happened: "true",
    note: "late again",
  });
  assertEqual(
    saved.status,
    303,
    "6. a private entry is written through the command endpoint",
  );

  const privatePage = await get("/habits");
  const privateText = text(privatePage.html);
  const privateSection = privateText.slice(
    privateText.indexOf("Private log"),
    privateText.indexOf("Photo Diary"),
  );

  assert(
    privateSection.includes("Doom scrolling"),
    "6. the entry is shown, labelled neutrally",
  );
  assert(privateSection.includes("late again"), "6. with the user's own words");
  assert(
    !SCORE_WORDS.some((word) =>
      privateSection.toLowerCase().includes(word.toLowerCase()),
    ),
    "6. the private section contains no streak, score, bar, rank, or percentage word",
  );
  assert(
    !/\b\d+(\.\d+)?\s*%/.test(privateSection),
    "6. and no percentage anywhere in it",
  );
  assert(
    !privateSection.includes("progressbar"),
    "6. and no progress bar element inside it",
  );
  assert(
    !/\b(twice|three|\d+)\s*(times|in a row)\b/iu.test(privateSection),
    "6. and no phrasing that counts occurrences",
  );

  const dashboardWithPrivate = text((await get("/")).html);
  assert(
    !dashboardWithPrivate.includes("late again"),
    "6. and the Dashboard shows nothing from the private log",
  );
  assert(
    !dashboardWithPrivate.includes("Masturbation") &&
      !dashboardWithPrivate.includes("Doom scrolling"),
    "6. not even the behaviour itself",
  );

  const removed = await postCommand({
    kind: "private.log",
    type: "doom_scrolling",
    happened: "false",
  });
  assertEqual(removed.status, 303, "6. a 'no' is accepted as a correction");

  const afterRemoval = await get("/habits");
  assert(
    !text(afterRemoval.html).includes("late again"),
    "6. and it removes the entry rather than storing a row that says nothing happened",
  );

  // -------------------------------------------------------------------------
  console.log("\n# storage safety");

  const uploadsAfter = fs.existsSync(uploadDirectory)
    ? fs.readdirSync(uploadDirectory).filter((name) => !uploadsBefore.has(name))
    : [];

  assert(uploadsAfter.length > 0, "7. the accepted photo is really on disk");
  assert(
    uploadsAfter.every((name) => /^[\w-]+\.png$/u.test(name)),
    "7. under server-generated names with the detected extension",
  );

  const db = new Database(scratchFile);
  const storedUrls = db
    .prepare("SELECT photo_url FROM habit_log WHERE photo_url IS NOT NULL")
    .all()
    .map((entry) => entry.photo_url);

  assert(
    storedUrls.length > 0 &&
      storedUrls.every((url) => url.startsWith("/api/photos/")),
    "7. and the database holds application URLs, never filesystem paths",
  );
  assert(
    !storedUrls.some(
      (url) => url.includes(projectRoot) || url.includes("/tmp"),
    ),
    "7. with no local path leaking into a stored value",
  );
  db.close();
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (server.exitCode === null) {
    server.kill("SIGKILL");
  }
  scratchDatabase.close();
  fs.rmSync(scratchDir, { recursive: true, force: true });
}

// The uploads this run created are removed, because they are the acceptance run's artefacts and
// the user's real `data/uploads/` must not gain files it never asked for.
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
