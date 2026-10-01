/**
 * Responsive verification in a real browser, not an inspection of the CSS.
 *
 * Run with `npm run build && npm run responsive:check`.
 *
 * ## Why this is not a stylesheet review
 *
 * Reading `globals.css` can show that a grid uses `auto-fit` and a row uses `flex-wrap`. It
 * cannot show that the page does not scroll sideways on a 320px screen, that the day's total is
 * actually readable there, or that the shared input is still usable — and those are the claims a
 * "responsive" acceptance criterion is really making. So this drives headless Chrome over the
 * DevTools protocol, sets two viewport widths, and measures the rendered document.
 *
 * ## What it asserts, and what it does not
 *
 * It measures **horizontal overflow**, whether the primary figures are present and legible, and
 * whether the shared input is on screen and enabled. It does not take screenshots, it does not
 * check contrast or focus order, and it is not a substitute for looking at the page. What it
 * removes is the weaker claim: "the stylesheet looks like it should reflow".
 *
 * A browser is required. If none can be found the script fails loudly rather than reporting a
 * pass it did not earn.
 */
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

function assertEqual(actual, expected, message) {
  if (Object.is(actual, expected)) {
    ok(message);
  } else {
    bad(
      `${message} (expected ${String(expected)}, received ${String(actual)})`,
    );
  }
}

function assert(condition, message) {
  if (condition) {
    ok(message);
  } else {
    bad(message);
  }
}

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

if (!fs.existsSync(path.join(projectRoot, ".next", "BUILD_ID"))) {
  console.error(
    "This check serves the production build. Run `npm run build` first.",
  );
  process.exit(1);
}

/** The browsers to try, in order. Anything Chromium-based will do. */
const CANDIDATES = [
  process.env.CHROME_PATH,
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
].filter(Boolean);

function findBrowser() {
  for (const candidate of CANDIDATES) {
    try {
      const probe = spawn(candidate, ["--version"], { stdio: "ignore" });

      probe.on("error", () => {});
      if (spawnSync0(candidate)) {
        return candidate;
      }
    } catch {
      // Try the next one.
    }
  }

  return null;
}

function spawnSync0(candidate) {
  // `spawnSync` is imported lazily so the failure above can be a simple "no such binary".
  const { spawnSync } = require("node:child_process");

  return spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0;
}

const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);

const browser = findBrowser();

if (browser === null) {
  bad(
    "no Chromium-based browser was found, so the responsive check did not run (set CHROME_PATH)",
  );
  process.exitCode = 1;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

const scratchDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "hari-os-responsive-"),
);
const scratchFile = path.join(scratchDir, "responsive.db");
const appPort = 3600 + Math.floor(Math.random() * 300);
const debugPort = appPort + 1000;
const base = `http://127.0.0.1:${appPort}`;

const app = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--port", String(appPort)],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      HARI_OS_DB_PATH: scratchFile,
      PORT: String(appPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let appOutput = "";
app.stdout.on("data", (chunk) => (appOutput += chunk));
app.stderr.on("data", (chunk) => (appOutput += chunk));

const chromeProfile = path.join(scratchDir, "chrome-profile");
const chrome = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    `--user-data-dir=${chromeProfile}`,
    `--remote-debugging-port=${debugPort}`,
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let chromeOutput = "";
chrome.stdout.on("data", (chunk) => (chromeOutput += chunk));
chrome.stderr.on("data", (chunk) => (chromeOutput += chunk));

async function waitFor(check, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await check()) {
        return true;
      }
    } catch {
      // Not up yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

/** A minimal DevTools protocol client over the browser's own WebSocket. */
class DevTools {
  #socket;
  #next = 1;
  #pending = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const waiting = this.#pending.get(message.id);

      if (waiting !== undefined) {
        this.#pending.delete(message.id);
        if (message.error === undefined) {
          waiting.resolve(message.result);
        } else {
          waiting.reject(new Error(message.error.message));
        }
      }
    });
  }

  static async open(url) {
    const socket = new WebSocket(url);

    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("no socket")), {
        once: true,
      });
    });

    return new DevTools(socket);
  }

  send(method, params = {}) {
    const id = this.#next++;

    this.#socket.send(JSON.stringify({ id, method, params }));

    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
  }

  /** Evaluates an expression in the page and returns its JSON value. */
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result.exceptionDetails !== undefined) {
      throw new Error(result.exceptionDetails.text ?? "evaluation failed");
    }

    return result.result.value;
  }

  close() {
    this.#socket.close();
  }
}

const VIEWPORTS = [
  { label: "mobile (320x568)", width: 320, height: 568, deviceScaleFactor: 1 },
  { label: "phone (390x844)", width: 390, height: 844, deviceScaleFactor: 1 },
  {
    label: "desktop (1440x900)",
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
  },
];

try {
  assert(
    await waitFor(async () => {
      const response = await fetch(`${base}/`);

      return response.ok;
    }),
    `the application is serving (${appOutput.split("\n")[0] ?? ""})`,
  );

  // Real data, so the screen has a low-stock line, a day's total, and a task to measure.
  // The rows come from the documented setup script and this script's own inserts; nothing here
  // imports application code, because a browser-driving script has no business loading a
  // `server-only` module.
  const setup = spawnSync(
    process.execPath,
    ["--conditions=react-server", "scripts/db-setup.mjs"],
    {
      cwd: projectRoot,
      env: { ...process.env, HARI_OS_DB_PATH: scratchFile },
      encoding: "utf8",
    },
  );

  assertEqual(
    setup.status,
    0,
    "the documented setup creates the disposable database",
  );

  const database = new Database(scratchFile);
  const today = new Date().toISOString().slice(0, 10);
  database
    .prepare("UPDATE inventory_item SET quantity = 2 WHERE name = 'onions'")
    .run();
  database
    .prepare(
      "INSERT INTO expense (timestamp, item, amount, account, category) VALUES (?, 'banana', 1250, 1, NULL)",
    )
    .run(`${today}T09:15:00.000Z`);
  database
    .prepare(
      "INSERT INTO plan_task (date, title, done) VALUES (?, 'Read ten pages before the phone', 0)",
    )
    .run(today);
  database.close();

  assert(
    await waitFor(async () => {
      const response = await fetch(`${base}/`);

      return (await response.text()).includes("₹12.50");
    }),
    "the page serves real data: a low-stock item, a day's total, and a task",
  );

  assert(
    await waitFor(async () => {
      const response = await fetch(
        `http://127.0.0.1:${debugPort}/json/version`,
      );

      return response.ok;
    }),
    `the browser is ready (${chromeOutput.split("\n")[0] ?? ""})`,
  );

  const targets = await (
    await fetch(`http://127.0.0.1:${debugPort}/json/list`)
  ).json();
  const target = targets.find((entry) => entry.type === "page");

  assert(target !== undefined, "the browser exposes a page target to drive");

  const page = await DevTools.open(target.webSocketDebuggerUrl);

  await page.send("Page.enable");
  await page.send("Runtime.enable");

  for (const viewport of VIEWPORTS) {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      mobile: viewport.width < 600,
    });
    await page.send("Page.navigate", { url: `${base}/` });
    await page.send("Runtime.evaluate", {
      expression:
        "new Promise((done) => document.readyState === 'complete' ? done(true) : addEventListener('load', () => done(true)))",
      awaitPromise: true,
    });

    const measurement = await page.evaluate(`(() => {
        const documentElement = document.documentElement;
        const overflowing = [...document.querySelectorAll('*')]
          .filter((node) => node.getBoundingClientRect().right > documentElement.clientWidth + 1)
          .map((node) => node.tagName + (node.className ? '.' + String(node.className).split(' ')[0] : ''));
        const spend = document.querySelector('.tile-value');
        const input = document.querySelector('.chat-input');
        const button = document.querySelector('.chat-form button');
        return {
          scrollWidth: documentElement.scrollWidth,
          clientWidth: documentElement.clientWidth,
          overflowing: [...new Set(overflowing)],
          spend: spend === null ? null : spend.textContent.trim(),
          spendSize: spend === null ? 0 : Number.parseFloat(getComputedStyle(spend).fontSize),
          inputVisible: input !== null && input.getBoundingClientRect().width > 0,
          inputDisabled: input === null ? true : input.disabled,
          buttonVisible: button !== null && button.getBoundingClientRect().width > 0,
          navLinks: [...document.querySelectorAll('.nav-link')].map((node) => node.textContent.trim()),
          bodyText: document.body.innerText,
        };
      })()`);

    assert(
      measurement.scrollWidth <= measurement.clientWidth,
      `${viewport.label}: no horizontal overflow (${measurement.scrollWidth} <= ${measurement.clientWidth})`,
    );
    assertEqual(
      measurement.overflowing.join(","),
      "",
      `${viewport.label}: no element extends past the viewport`,
    );
    assertEqual(
      measurement.spend,
      "₹12.50",
      `${viewport.label}: the day's total is rendered`,
    );
    assert(
      measurement.spendSize >= 16,
      `${viewport.label}: the day's total is at least readable text (${measurement.spendSize}px)`,
    );
    assert(
      measurement.inputVisible && measurement.buttonVisible,
      `${viewport.label}: the shared input and its button are on screen`,
    );
    assert(
      measurement.inputDisabled,
      `${viewport.label}: the input reports honestly that parsing is unavailable (no API key here)`,
    );
    // Named, not counted. Phase 7 added Habits and Skills, and a count is the assertion a
    // navigator stops updating the moment a page is added.
    assertEqual(
      measurement.navLinks.join(","),
      "Dashboard,Kitchen,Expenses,Routine,Habits,Skills",
      `${viewport.label}: navigation reaches every page`,
    );
    assert(
      measurement.bodyText.includes("onions"),
      `${viewport.label}: the low-stock line is readable`,
    );
  }

  page.close();
} finally {
  chrome.kill("SIGKILL");
  app.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (app.exitCode === null) {
    app.kill("SIGKILL");
  }
  fs.rmSync(scratchDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
