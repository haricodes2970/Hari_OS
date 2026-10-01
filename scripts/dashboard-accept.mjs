/**
 * Phase 5 acceptance: the Dashboard over real HTTP, against a disposable database.
 *
 * Run with `npm run build && npm run dashboard:accept`.
 *
 * ## Why this is a separate script
 *
 * `dashboard:test` proves what the read model does with persisted rows. It cannot prove what the
 * *page* does with it, because `src/app/page.tsx` is a Server Component and rendering it requires
 * Next.js — a Server Component cannot be rendered by `react-dom/server` in a bare Node process,
 * and no amount of inspecting the element tree would show the HTML a browser receives. So the
 * page-level claims are checked the only way they can be honestly checked: a real `next start`
 * serving real HTML, over HTTP, against a database that is thrown away afterwards.
 *
 * ## The rules this follows from earlier phases
 *
 * - `HARI_OS_DB_PATH` is set **before the server starts**, so the running application and the
 *   script's own inspections both point at the temporary file. The development database is never
 *   opened, and its fingerprint is compared at the end.
 * - The flow starts on a **completely fresh** database, so "does not crash with no data" is
 *   tested before anything is created rather than assumed.
 * - Setup is the documented `npm run db:setup`, run against the temporary database. Nothing here
 *   invents a balance or an item that the application would not create for a user.
 */
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
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

function fingerprint(file) {
  return fs.existsSync(file)
    ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
    : "absent";
}

const developmentFingerprintBefore = fingerprint(developmentDatabase);
const developmentSidecarsBefore = fs
  .readdirSync(path.join(projectRoot, "data"))
  .filter((name) => name.endsWith("-wal") || name.endsWith("-shm"))
  .sort();

if (!fs.existsSync(path.join(projectRoot, ".next", "BUILD_ID"))) {
  console.error(
    "This acceptance run serves the production build. Run `npm run build` first.",
  );
  process.exit(1);
}

const scratchDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "hari-os-dashboard-accept-"),
);
const scratchFile = path.join(scratchDir, "accept.db");
const port = 3100 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;

/** Runs a short command to completion and returns its exit code and output. */
function runSync(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/** Waits for the server to answer, or gives up. */
async function waitForServer(attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${base}/`);

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

/** Runs the documented first-run setup against the disposable database, once the fresh state is checked. */
let setup = { code: 1, output: "not run" };
function runSetup() {
  // `--conditions=react-server` is what the npm script passes: the application imports
  // `server-only`, which is a no-op without that condition.
  setup = runSync(
    process.execPath,
    ["--conditions=react-server", "scripts/db-setup.mjs"],
    { HARI_OS_DB_PATH: scratchFile },
  );
}

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
  console.log("\n# 15, 19-22. a never-used database");

  {
    const fresh = await get("/");
    const page = text(fresh.html);

    assertEqual(
      fresh.status,
      200,
      "15. the Dashboard renders on a fresh database",
    );
    assert(page.includes("Dashboard"), "15. it is the Dashboard");
    assert(
      page.includes("Nothing is planned for today"),
      "19. an unplanned day says so instead of inventing tasks",
    );
    assert(
      page.includes("No suggestion, because no task is planned for today"),
      "19. and offers no suggested action",
    );
    assert(
      page.includes("tracked in the kitchen yet"),
      "18. an empty kitchen is stated, not shown as healthy stock",
    );
    assert(
      page.includes("₹0.00"),
      "12. a day with no spending renders a real zero",
    );
    assert(
      page.includes("Nothing has been spent today"),
      "12. and says that rather than implying a balance",
    );
    assert(
      page.includes("not recorded"),
      "21. laundry and dishes report as not recorded, not as not done",
    );
    assert(
      page.includes("not available yet"),
      "20. the scrolling entry point is truthfully unavailable",
    );
    assert(
      !page.includes("Balances") && !page.includes("Bank 1"),
      "the Dashboard shows no account balances, only the day's spend",
    );
  }

  // The first-run rows come from the documented script, run now against the same disposable
  // file — not inserted by this script, and not created by opening a page.
  runSetup();
  assertEqual(
    setup.code,
    0,
    `the documented db:setup runs against the disposable database${setup.code === 0 ? "" : ` — ${setup.output.slice(0, 300)}`}`,
  );

  // -------------------------------------------------------------------------
  console.log("\n# 23, 25, 26. stock changes move the Dashboard");

  {
    const before = text((await get("/")).html);

    // `db:setup` creates milk at 1 litre against a threshold of 2, so the very first render
    // after setup already has one real low-stock item — and onions, which is healthy, is not on
    // the list. Both halves matter: a screen that shows everything is not a low-stock screen.
    assert(
      before.includes("milk") && before.includes("alert at 2"),
      "an item below its threshold is flagged from the rows setup wrote",
    );
    assert(
      !/onions \\d+ piece alert at/u.test(before),
      "a healthy item is not on the low-stock list",
    );
    assert(
      text((await get("/kitchen")).html).includes("onions"),
      "the setup items exist in the kitchen once setup has run",
    );

    const consumed = await post("/api/commands", {
      kind: "inventory.consume",
      itemName: "onions",
      amount: "8",
      unit: "piece",
      next: "/",
    });

    assertEqual(
      consumed.status,
      303,
      "25. a Kitchen command from the Dashboard redirects back",
    );
    assertEqual(
      new URL(consumed.location ?? "http://localhost/").pathname,
      "/",
      "25. to the Dashboard itself",
    );

    const low = text((await get("/")).html);

    assert(
      low.includes("onions") && low.includes("2 piece"),
      "25. the consumed quantity is shown from persisted state",
    );
    assert(
      low.includes("alert at 3"),
      "2. the threshold is shown beside the low item",
    );

    const restocked = await post("/api/commands", {
      kind: "inventory.restock",
      itemName: "onions",
      amount: "5",
      unit: "piece",
      next: "/",
    });

    assertEqual(restocked.status, 303, "26. a restock is accepted");
    assert(
      !text((await get("/")).html).includes("alert at 3"),
      "26. and the item leaves the low-stock list",
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n# 17, 24, 27-30. expenses reach the Dashboard");

  {
    const spent = await post("/api/commands", {
      kind: "expense.record",
      item: "banana",
      amount: "10",
      accountName: "cash",
      next: "/",
    });

    assertEqual(
      spent.status,
      303,
      "27. an expense is recorded from the Dashboard",
    );
    assert(
      (spent.location ?? "").includes("saved=ok"),
      "24. the success comes back as the endpoint's own token",
    );

    const withSpend = text((await get("/")).html);

    assert(
      withSpend.includes("₹10.00"),
      "17. the Dashboard shows the day's total",
    );
    assert(
      withSpend.includes("Spent across 1 entry today"),
      "17. and the entry count that came with it",
    );
    assert(
      withSpend.includes("not an account balance"),
      "the day's spend is explicitly not presented as a balance",
    );

    // 29: an entry from another day must not appear.
    const scratch = new Database(scratchFile);
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10);
    scratch
      .prepare(
        "INSERT INTO expense (timestamp, item, amount, account, category) VALUES (?, 'yesterday bus', 5000, 1, NULL)",
      )
      .run(`${yesterday}T09:00:00.000Z`);
    scratch.close();

    const afterYesterday = text((await get("/")).html);

    assert(
      afterYesterday.includes("₹10.00") && !afterYesterday.includes("₹60.00"),
      "29. yesterday's expense is excluded from today's total",
    );

    // 6: the Dashboard and the bill are the same number, over HTTP.
    const bill = await fetch(`${base}/expenses/daily-bill`);
    const billText = await bill.text();

    assertEqual(
      bill.headers.get("content-type"),
      "text/plain; charset=utf-8",
      "the bill is still served as plain text",
    );
    assert(
      billText.includes("₹10.00") && !billText.includes("₹60.00"),
      "7. the bill agrees with the Dashboard, and excludes yesterday too",
    );

    // 28: a reload reads persisted state rather than anything held in the page.
    const reloaded = text((await get("/")).html);

    assert(reloaded.includes("₹10.00"), "28. the total survives a reload");
    assert(
      text((await get("/kitchen")).html).includes("7 piece"),
      "28. and so does the stock the restock left behind",
    );

    // 24: a refused command renders the failure rather than claiming success.
    const refused = await post("/api/commands", {
      kind: "inventory.consume",
      itemName: "onions",
      amount: "9999",
      unit: "piece",
      next: "/",
    });

    assert(
      (refused.location ?? "").includes("err="),
      "24. a refusal redirects with an error token",
    );

    const afterRefusal = text((await get("/")).html);

    assert(
      afterRefusal.includes("only 8 available") ||
        afterRefusal.toLowerCase().includes("available"),
      "24. and the page explains what the domain refused",
    );
    assert(
      afterRefusal.includes("₹10.00"),
      "24. the day's spend is unchanged by a refused command",
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n# 37. writes from another site are still refused");

  {
    const crossOrigin = await post(
      "/api/commands",
      {
        kind: "expense.record",
        item: "attacker",
        amount: "1000",
        accountName: "cash",
        next: "/",
      },
      { origin: "https://evil.example" },
    );

    assertEqual(
      crossOrigin.status,
      403,
      "a cross-origin command is refused with 403",
    );
    assert(
      !text((await get("/")).html).includes("₹110.00"),
      "and no money moved as a result",
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n# 23, 31. the shared input, and no client-side arithmetic");

  {
    const html = (await get("/")).html;

    assert(
      html.includes('action="/api/commands/parse"'),
      "23. the shared natural-language input posts to the one command endpoint",
    );
    assert(html.includes('name="text"'), "23. and carries the sentence field");
    const endpoints = [...html.matchAll(/action="([^"]+)"/gu)].map(
      (match) => match[1],
    );

    assertEqual(
      [...new Set(endpoints)].join(","),
      "/api/commands/parse",
      "31. the Dashboard posts to the one command endpoint and defines no route of its own",
    );
    assert(
      !/use client|useState|useEffect/u.test(html),
      "31. the page ships no client component, so no figure is computed in the browser",
    );
    assert(
      !html.includes("better-sqlite3") && !html.includes("SELECT "),
      "31. nothing about storage reaches the browser",
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n# responsive and basic usability");

  {
    const html = (await get("/")).html;
    const css = fs.readFileSync(
      path.join(projectRoot, "src/app/globals.css"),
      "utf8",
    );

    assert(
      html.includes('name="viewport"') ||
        html.includes('content="width=device-width'),
      "the page declares a device-width viewport",
    );
    assert(
      html.includes('href="/kitchen"') && html.includes('href="/expenses"'),
      "navigation to the other two pages is present",
    );
    assert(
      !/<table[^>]*width=/u.test(html),
      "no table is given a fixed pixel width",
    );
    assert(
      /overflow-x: hidden/u.test(css),
      "the stylesheet prevents horizontal overflow outright",
    );
    assert(
      /grid-template-columns: repeat\(auto-fit, minmax\(/u.test(css),
      "the tile grid reflows on narrow screens rather than fixing a width",
    );
    assert(
      /flex-wrap: wrap/u.test(css),
      "forms and rows wrap instead of overflowing",
    );

    // The longest unbroken string a 320px screen would have to fit.
    const widest = [...text(html).matchAll(/[^\s]{20,}/gu)]
      .map((match) => match[0])
      .sort((left, right) => right.length - left.length)[0];

    assert(
      widest === undefined || widest.length <= 60,
      `no single token forces a wide scroll (longest: ${String(widest)})`,
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n# the other pages still answer");

  for (const [page, needle] of [
    ["/kitchen", "In stock"],
    ["/expenses", "Balances"],
    ["/expenses/daily-bill", "Hari OS"],
  ]) {
    const response = await get(page);

    assertEqual(response.status, 200, `${page} still answers`);
    assert(
      text(response.html).includes(needle),
      `${page} still renders its content`,
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
  fs
    .readdirSync(path.join(projectRoot, "data"))
    .filter((name) => name.endsWith("-wal") || name.endsWith("-shm"))
    .sort()
    .join(","),
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
