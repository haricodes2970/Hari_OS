/**
 * Phase 6 acceptance: the Routine page and the Dashboard's morning view, over real HTTP.
 *
 * Run with `npm run build && npm run routine:accept`.
 *
 * ## Why this is a separate script
 *
 * `routine:test` proves what the feature and the route do. It cannot prove what the *page*
 * renders, because `src/app/routine/page.tsx` is a Server Component and rendering it requires
 * Next.js — a Server Component cannot be rendered by `react-dom/server` in a bare Node process.
 * So the page-level claims are checked the only way they can be honestly checked: a real
 * `next start` serving real HTML, over HTTP, against a database thrown away afterwards.
 *
 * ## What is being claimed here
 *
 * The claims are the ones a unit test cannot make and a user would notice immediately:
 *
 * - A **never-used database** renders the Routine page and the Dashboard without crashing, and
 *   says "not recorded" rather than inventing a night, a nap, or a task.
 * - A **check-in submitted as a form** plans tomorrow and the morning view then opens on exactly
 *   those tasks, in the order they were written.
 * - **Completing a task** from the page moves the first action on.
 * - **Nap warnings** are visible as warnings and the nap is still stored — a warning never blocks
 *   and never turns a row into a failure.
 * - **No shaming language** is rendered anywhere: no score, no grade, no punishment, no streak
 *   for a private behaviour.
 *
 * ## The rules this follows from earlier phases
 *
 * - `HARI_OS_DB_PATH` is set **before the server starts**, so the running application and this
 *   script's own inspection point at the temporary file. The development database is never
 *   opened, and its fingerprint and WAL sidecars are compared at the end.
 * - The flow starts on a completely fresh database, so "does not crash with no data" is tested
 *   before anything is created.
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
const dataDir = path.join(projectRoot, "data");
const developmentDatabase = path.join(dataDir, "hari-os.db");

function fingerprint(file) {
  return fs.existsSync(file)
    ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
    : "absent";
}

function sidecars() {
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

if (!fs.existsSync(path.join(projectRoot, ".next", "BUILD_ID"))) {
  console.error(
    "This acceptance run serves the production build. Run `npm run build` first.",
  );
  process.exit(1);
}

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "hari-os-routine-"));
const scratchFile = path.join(scratchDir, "accept.db");
const port = 3600 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;

/** Today, as the application will compute it, so the checks below can name the day. */
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

async function waitForServer(attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${base}/routine`);

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

const form = (fields) => new URLSearchParams(fields).toString();

async function get(page) {
  const response = await fetch(`${base}${page}`, { redirect: "manual" });

  return { status: response.status, html: await response.text() };
}

async function post(pathname, fields, headers = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    body: form(fields),
    redirect: "manual",
    headers: {
      origin: base,
      host: `127.0.0.1:${port}`,
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
  });

  return {
    status: response.status,
    location: response.headers.get("location"),
  };
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

/**
 * Constructs that would mean the page had started judging the user.
 *
 * Deliberately **not** a list of words. The pages say "not a score" and "an empty day is not a
 * failed day", so a word list flags its own disclaimers and would have been quietly deleted to
 * make a check pass. What is banned instead is the shape a judgement takes: a progress bar, a
 * percentage standing in for a score, and the phrases a streak turns into when it stops being
 * neutral.
 */
const JUDGEMENT = [
  "<progress",
  "progressbar",
  "aria-valuenow",
  "your score",
  "score:",
  "grade",
  "penalty",
  "punish",
  "shame",
  "behind schedule",
  "you failed",
  "you should",
  "bad night",
  "poor night",
  "streak: ",
  "streak of ",
];

const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--port", String(port)],
  {
    cwd: projectRoot,
    env: { ...process.env, HARI_OS_DB_PATH: scratchFile, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk));
server.stderr.on("data", (chunk) => (serverOutput += chunk));

try {
  assert(
    await waitForServer(),
    `the production server starts and answers (${serverOutput.slice(0, 120)})`,
  );

  // -------------------------------------------------------------------------
  console.log("\n# a never-used database renders both pages");

  {
    const routine = await get("/routine");
    const page = text(routine.html);

    assertEqual(
      routine.status,
      200,
      "1. the Routine page renders on a fresh database",
    );
    assert(page.includes("Routine"), "1. it is the Routine page");
    assert(
      page.includes("Nothing is planned for today"),
      "1. an unplanned day says so instead of inventing tasks",
    );
    assert(
      page.includes("Nothing is planned for tomorrow yet"),
      "1. and tomorrow is empty rather than pre-filled",
    );
    assert(
      page.includes("Nothing is recorded for the night beginning"),
      "1. a night with no entries reports not recorded",
    );
    assert(
      !page.includes("0 min"),
      "1. and reports no sleep length rather than a zero",
    );
    assert(
      page.includes("An empty day is not a failed day"),
      "1. and states that an empty day is not a judgement",
    );

    const dashboard = await get("/");
    const dashText = text(dashboard.html);
    assertEqual(
      dashboard.status,
      200,
      "1. the Dashboard also renders without data",
    );
    assert(
      dashText.includes("Nothing is planned for today"),
      "1. and says the same thing about today",
    );
    assert(
      dashText.includes("No sleep has been recorded"),
      "1. its sleep card says the night is not recorded",
    );
    assert(
      dashText.includes("Tomorrow has no plan yet"),
      "1. and points at the check-in that plans it",
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n# the check-in is a form submission that plans tomorrow");

  {
    const saved = await post("/api/routine", {
      operation: "night_check_in",
      title1: "  wash the car  ",
      title2: "email the landlord",
      title3: "",
      phoneOutside: "true",
    });

    assertEqual(
      saved.status,
      303,
      "2. the check-in redirects back to the page",
    );
    assert(
      (saved.location ?? "").includes("/routine?") &&
        (saved.location ?? "").includes("saved=ok"),
      "2. carrying the outcome as a query value",
    );

    const database = new Database(scratchFile, { readonly: true });
    const planned = database
      .prepare("SELECT date, title, done FROM plan_task ORDER BY id")
      .all();
    const night = database
      .prepare("SELECT date, phone_outside FROM sleep_log")
      .get();

    assertEqual(planned.length, 2, "2. exactly the stated tasks were stored");
    assertEqual(
      planned.map((task) => task.title).join(", "),
      "wash the car, email the landlord",
      "2. trimmed, in the order they were written",
    );
    assert(
      planned.every((task) => task.date === tomorrow),
      `2. and planned for tomorrow (${tomorrow})`,
    );
    assertEqual(night.phone_outside, 1, "2. the phone confirmation was stored");
    database.close();

    const page = text((await get("/routine")).html);
    assert(
      page.includes("wash the car"),
      "3. the morning view shows the first task",
    );
    assert(page.includes("email the landlord"), "3. and the second");
    assert(page.includes(tomorrow), "3. under tomorrow's date, not today's");
    assert(
      page.includes("Confirmed outside the bedroom"),
      "3. and the phone confirmation is reported as a fact",
    );

    const dashboard = text((await get("/")).html);
    assert(
      dashboard.includes("Tomorrow already has a plan"),
      "3. the Dashboard says tomorrow is planned",
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n# a day's tasks, and completing one from the page");

  {
    for (const title of ["write the invoice", "water the plants"]) {
      const created = await post("/api/commands", {
        kind: "task.create",
        next: "/routine",
        title,
      });

      assertEqual(created.status, 303, "4. a task can be added for today");
      assert(
        (created.location ?? "").includes("saved=ok"),
        "4. with an outcome, not an error",
      );
    }

    const withTasks = text((await get("/routine")).html);
    assert(
      withTasks.includes("Next: write the invoice"),
      "4. the morning view names the first undone task",
    );

    const done = await post("/api/commands", {
      kind: "task.set_done",
      next: "/routine",
      title: "write the invoice",
      done: "true",
      day: "today",
    });

    assertEqual(done.status, 303, "4. completing a task redirects");
    assert(
      (done.location ?? "").includes("saved=ok"),
      "4. with an outcome, not an error",
    );

    const page = text((await get("/routine")).html);
    assert(
      page.includes("Next: water the plants"),
      "4. the first action moves to the next undone task",
    );

    const unknown = await post("/api/commands", {
      kind: "task.set_done",
      next: "/routine",
      title: "a task nobody wrote",
      done: "true",
      day: "today",
    });
    assert(
      (unknown.location ?? "").includes("err=unknown_task"),
      "4. completing a task that does not exist is refused by name",
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n# the night's times, and the lengths they produce");

  {
    for (const [field, time] of [
      ["bedtime", "23:30"],
      ["sleep_time", "23:45"],
      ["wake_time", "07:20"],
    ]) {
      const saved = await post("/api/commands", {
        kind: "sleep.record",
        next: "/routine",
        field,
        time,
      });

      assertEqual(saved.status, 303, `5. ${field} at ${time} is accepted`);
    }

    const page = text((await get("/routine")).html);
    assert(page.includes("23:30"), "5. the bedtime is shown");
    assert(page.includes("7 h 50 min"), "5. time in bed spans midnight");
    assert(
      page.includes("7 h"),
      "5. and sleep excludes the time before sleep began",
    );

    // 07:20 is inside the domain's 06:15–07:30 window, so the streak counts this night and the
    // wording the PRD requires it to carry is on the page.
    assert(page.includes("consecutive day"), "5. the streak counts one day");
    assert(
      page.includes("record, not a score"),
      "5. and is labelled a record, not a score",
    );
    assert(
      page.includes("06:15") && page.includes("07:30"),
      "5. with the window it uses taken from the domain, not typed in the page",
    );

    const dash = text((await get("/")).html);
    assert(dash.includes("Last night"), "5. the Dashboard has a night card");
    assert(
      dash.includes("7 h 50 min"),
      "5. showing the same length as the Routine page",
    );

    const refused = await post("/api/commands", {
      kind: "sleep.record",
      next: "/routine",
      field: "wake_time",
      time: "7am",
    });
    assert(
      (refused.location ?? "").includes("err="),
      "5. a malformed time is refused with an outcome the page can render",
    );
    assert(
      !text((await get("/routine")).html).includes("7am"),
      "5. and the malformed time is not stored",
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n# nap warnings are soft, and shown as warnings");

  {
    await post("/api/commands", {
      kind: "nap.start",
      next: "/routine",
      time: "15:30",
    });
    const running = text((await get("/routine")).html);
    assert(
      running.includes("still running"),
      "6. a running nap says it is running",
    );
    assert(
      running.includes("after the 15:00 mark"),
      "6. and the late-start warning is visible immediately",
    );

    await post("/api/commands", {
      kind: "nap.end",
      next: "/routine",
      time: "16:20",
    });
    const closed = text((await get("/routine")).html);
    assert(
      closed.includes("50 min"),
      "6. the nap's length is computed, in the domain",
    );
    assert(
      closed.includes("over the 30 minute mark"),
      "6. the long-nap warning is visible",
    );

    const database = new Database(scratchFile, { readonly: true });
    const naps = database.prepare("SELECT start, end FROM nap_log").all();
    database.close();
    assertEqual(naps.length, 1, "6. the warned-about nap was still stored");
    assertEqual(naps[0].end, "16:20", "6. with its end time intact");

    // A nap that trips both warnings is still an ordinary stored row and an ordinary sentence.
    assert(
      !closed.includes("blocked") && !closed.includes("not allowed"),
      "6. a warning never reads as a block",
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n# nothing on either page judges the user");

  for (const page of ["/routine", "/"]) {
    const response = await get(page);
    const body = text(response.html);
    const found = JUDGEMENT.filter((needle) => body.includes(needle));

    assert(
      found.length === 0,
      `7. ${page} renders no judgement construct${found.length === 0 ? "" : ` — found: ${found.join(", ")}`}`,
    );
    assert(
      !/\b\d{1,3}\s*%/.test(body),
      `7. ${page} renders no percentage standing in for a score`,
    );
    assert(
      !response.html.includes("<progress") &&
        !response.html.includes('role="progressbar"'),
      `7. ${page} renders no progress bar`,
    );
  }
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (server.exitCode === null) {
    server.kill("SIGKILL");
  }
  fs.rmSync(scratchDir, { recursive: true, force: true });
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

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
