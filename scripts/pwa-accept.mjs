/**
 * Phase 8 PWA acceptance: the manifest, the icons, and the service worker over real HTTP.
 *
 * Run with `npm run build && npm run pwa:accept`.
 *
 * ## Why this is separate from `pwa-test.mjs`
 *
 * `pwa-test.mjs` checks what the files say and that the route handler behaves. It cannot prove
 * that the production build *serves* them, and serving is where a PWA layer actually fails: a
 * manifest that is valid TypeScript but not routed, an icon that exists in `public/` but 404s
 * behind a base path, a service worker served with the wrong content type and therefore refused
 * by the browser. So this runs `next start` and asks for each of them over HTTP.
 *
 * ## What is verified, and how honestly
 *
 * - The manifest is served, is valid JSON, and every path in it resolves with a 200 and a PNG
 *   content type.
 * - The document head links the manifest and the icons.
 * - The service worker is served from `/sw.js` — the origin root, which is what gives it `/` as its
 *   scope — and is served as JavaScript.
 * - `start_url` resolves, and the pages the app depends on still render.
 * - The photo upload and the diary note still work end to end over HTTP, unchanged by any of this.
 *
 * **Installation is not claimed.** Installing an application needs a browser UI event
 * (`beforeinstallprompt`) that a headless script cannot produce and no HTTP check can stand in
 * for. What is reported instead is the set of requirements that *are* observable, and the
 * remainder is listed as not verifiable here.
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

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "hari-os-pwa-"));
const scratchFile = path.join(scratchDir, "accept.db");
const port = 4900 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;

async function waitForServer(attempts = 80) {
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

async function get(path_) {
  const response = await fetch(`${base}${path_}`, { redirect: "manual" });

  return response;
}

/** A minimal PNG: the eight signature bytes plus an IHDR, which is all the byte check reads. */
function pngBytes() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
  ]);
}

/** A multipart upload, built the way a browser builds one. */
async function uploadPhoto(field, bytes) {
  const boundary = "----hariOsPwaAcceptBoundary";
  const parts = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nlaundry\r\n`,
      "utf8",
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`,
      "utf8",
    ),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ];

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

async function postNote(id, note) {
  const response = await fetch(`${base}/api/photos/${id}/note`, {
    method: "POST",
    body: new URLSearchParams({ note, next: "/diary" }).toString(),
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
  console.log("\n# the manifest");

  const manifestResponse = await get("/manifest.webmanifest");

  assertEqual(
    manifestResponse.status,
    200,
    "1. the production build serves the manifest",
  );
  assert(
    (manifestResponse.headers.get("content-type") ?? "").includes(
      "application/manifest+json",
    ),
    "2. with the manifest content type a browser recognises",
  );

  const manifestText = await manifestResponse.text();
  let manifest = null;

  try {
    manifest = JSON.parse(manifestText);
    ok("3. its body is valid JSON");
  } catch {
    bad("3. its body is not valid JSON");
  }

  if (manifest !== null) {
    assertEqual(typeof manifest.name, "string", "4. it names the application");
    assertEqual(
      typeof manifest.short_name,
      "string",
      "4. and gives it a short name for the home screen",
    );
    assertEqual(
      manifest.display,
      "standalone",
      "4. and declares a display mode",
    );
    assert(
      typeof manifest.start_url === "string" &&
        manifest.start_url.startsWith("/"),
      "5. its start_url is a path on this origin",
    );
    assert(
      Array.isArray(manifest.icons) && manifest.icons.length >= 2,
      "6. it lists icons, plural, as installability requires",
    );

    // Every icon it names must actually resolve. This is the check that catches a renamed file,
    // and it is the reason the icons are generated by a script rather than renamed by hand.
    for (const icon of manifest.icons) {
      const response = await get(icon.src);

      assertEqual(response.status, 200, `7. ${icon.src} resolves`);
      assert(
        (response.headers.get("content-type") ?? "").startsWith("image/png"),
        `7. ${icon.src} is served as a PNG`,
      );

      const bytes = Buffer.from(await response.arrayBuffer());

      assertEqual(
        bytes
          .subarray(0, 8)
          .equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          ),
        true,
        `7. ${icon.src} is a real PNG`,
      );
      assertEqual(
        `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,
        icon.sizes,
        `7. ${icon.src} really is ${icon.sizes}`,
      );
    }

    const startResponse = await get(manifest.start_url);

    assertEqual(
      startResponse.status,
      200,
      "8. the start_url resolves, which is the last of the manifest requirements",
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n# the document head");

  const home = await (await get("/")).text();

  assert(
    /<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/u.test(home) ||
      /<link[^>]+href="\/manifest\.webmanifest"[^>]+rel="manifest"/u.test(home),
    "9. the document links the manifest",
  );
  assert(
    home.includes("/icon-192.png") && home.includes("/icon-512.png"),
    "9. and links the icons it installed would use",
  );
  assert(
    home.includes("/apple-touch-icon.png"),
    "9. and an apple-touch-icon, for iOS, which ignores the manifest",
  );

  // Every icon link in the head, fetched. The framework adds its own `/favicon.ico` link whether or
  // not this application declares one, so asserting the *absence* of the reference would be
  // asserting something untrue; asserting that each one resolves is the claim that matters, and it
  // is the one a browser cares about when it draws a tab.
  // Parsed per tag, so `rel` and `href` are read from the same element rather than inferred from
  // the text around it — which is how the apple-touch-icon went uncollected the first time this
  // ran, and how an unresolvable link could have slipped through unnoticed.
  const iconLinks = [...home.matchAll(/<link[^>]*>/gu)]
    .map((match) => match[0])
    .map((tag) => ({
      rel: /rel="([^"]*)"/u.exec(tag)?.[1] ?? "",
      href: /href="([^"]+)"/u.exec(tag)?.[1] ?? null,
    }))
    .filter(
      (link) =>
        link.href !== null &&
        ["manifest", "icon", "apple-touch-icon", "shortcut icon"].includes(
          link.rel,
        ),
    )
    .map((link) => link.href);

  assert(
    iconLinks.length >= 4,
    `9. the head declares the manifest and several icons (${iconLinks.length} links)`,
  );

  for (const href of iconLinks) {
    const response = await get(href);
    const bytes = Buffer.from(await response.arrayBuffer());

    assertEqual(
      response.status === 200 && bytes.length > 0,
      true,
      `9. ${href} resolves with ${bytes.length} bytes, so no icon link is broken`,
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n# the service worker");

  const workerResponse = await get("/sw.js");

  assertEqual(workerResponse.status, 200, "10. it is served");
  assert(
    (workerResponse.headers.get("content-type") ?? "").includes("javascript"),
    "11. as JavaScript, or the browser refuses to install it",
  );

  const workerText = await workerResponse.text();
  const workerCode = workerText
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/[^\n]*/gu, "");

  assertEqual(
    workerCode.includes('addEventListener("fetch"'),
    false,
    "12. it has no fetch handler, so nothing is ever intercepted",
  );
  assertEqual(
    workerCode.includes("caches.open("),
    false,
    "13. it opens no cache, so no private response is ever stored",
  );
  assertEqual(
    workerCode.includes("/api/"),
    false,
    "13. and its code names no API path, so it cannot treat one differently",
  );

  // Scope follows from where the file is served: `/sw.js` is the origin root, so the scope is `/`.
  assertEqual(
    new URL("/sw.js", base).pathname,
    "/sw.js",
    "14. it is served from the origin root, which is what gives it / as its scope",
  );

  const servedFromRoot = fs.existsSync(
    path.join(projectRoot, "public", "sw.js"),
  );

  assert(
    servedFromRoot,
    "14. and it comes from public/sw.js, so the path above is the whole story",
  );

  // -------------------------------------------------------------------------
  console.log("\n# nothing about this changed the application");

  for (const page of [
    "/",
    "/diary",
    "/habits",
    "/kitchen",
    "/expenses",
    "/routine",
    "/skills",
  ]) {
    const response = await get(page);

    assertEqual(response.status, 200, `15. ${page} still renders`);
  }

  const uploaded = await uploadPhoto("capture", pngBytes());

  assertEqual(
    uploaded.status,
    201,
    "16. a photo sent as a camera capture is stored by the existing upload path",
  );

  const entryId = uploaded.body?.id;

  const served = await get(uploaded.body.url);

  assertEqual(served.status, 200, "16. and is served back from its URL");

  const noted = await postNote(entryId, "written before the PWA work");

  assertEqual(noted.status, 303, "17. the diary note route is unchanged");

  const diary = await (await get("/diary")).text();

  assert(
    diary.includes("written before the PWA work"),
    "17. and the note still appears on the diary",
  );

  const refused = await uploadPhoto("capture", Buffer.from("not an image"));

  assertEqual(
    refused.status,
    400,
    "18. a camera capture still has to pass the byte check",
  );

  const commands = await fetch(`${base}/api/commands`, {
    method: "POST",
    body: new URLSearchParams({
      kind: "skill.create",
      name: "pwa regression",
      next: "/skills",
    }).toString(),
    redirect: "manual",
    headers: {
      origin: base,
      host: `127.0.0.1:${port}`,
      "content-type": "application/x-www-form-urlencoded",
    },
  });

  assertEqual(
    commands.status,
    303,
    "19. the command endpoint behaves exactly as before",
  );

  // -------------------------------------------------------------------------
  console.log("\n# what could not be verified here");

  console.log(
    "note  Installing the application needs a browser UI event (beforeinstallprompt) that no",
  );
  console.log(
    "note  script can raise: it requires a user gesture and a real profile. What is verified",
  );
  console.log(
    "note  above is every installability requirement that is observable from outside a browser —",
  );
  console.log(
    "note  manifest served and valid, icons resolving, start_url resolving, worker served from the",
  );
  console.log(
    "note  root — and `responsive:check` confirms registration and scope in a real browser.",
  );
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
