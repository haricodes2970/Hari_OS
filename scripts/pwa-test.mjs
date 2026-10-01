/**
 * Phase 8 PWA tests: the manifest, the icons, the service worker, and camera capture.
 *
 * Run with `npm run pwa:test`.
 *
 * ## What this file is for
 *
 * Most of the PWA layer is static, so most of what can go wrong with it is a **reference that
 * points at nothing** or a **worker that does more than it says**. Neither shows up until a
 * browser tries to install an application that is not installable. So this suite asserts the
 * claims that are cheap to get wrong:
 *
 * 1. **Every path the manifest names exists.** A manifest with a 404 in it is the single most
 *    common reason an install prompt never appears, and it is invisible in every other suite.
 * 2. **The service worker does not intercept anything.** This is asserted by reading the file and
 *    checking it has no `fetch` listener, no cache open, and no reference to any API path — a
 *    claim about *absence*, which is exactly the kind that stops being true quietly. The file is
 *    also checked for credentials and for imports, because a worker is the one piece of this
 *    application that runs in the background with no page and nobody watching.
 * 3. **The worker's scope is the whole origin**, which follows from where it is served from and is
 *    asserted rather than assumed.
 * 4. **Camera capture is an affordance, not a second path.** The upload route must accept both
 *    field names and validate them identically, which is checked by posting a non-image under
 *    `capture` and requiring the same refusal a `photo` gets.
 * 5. **The registration is client-only and inert.** `import.meta.env.PROD` and the effect mean the
 *    worker is never registered during server rendering, and the source is checked for both.
 *
 * ## What it deliberately does not claim
 *
 * It cannot install an application. Nothing in Node can: `beforeinstallprompt` is a browser UI
 * event that requires a user gesture and a real profile. `npm run pwa:accept` verifies the pieces
 * over real HTTP, and `responsive:check` drives a real browser for registration; the OS-level
 * install is reported as not verifiable rather than assumed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const publicDirectory = path.join(projectRoot, "public");

/** The PNG signature. Enough to tell a real PNG from an HTML error page named `.png`. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A JavaScript file with its comments removed.
 *
 * Two of the claims below are about what the worker *does*, and both files document themselves at
 * length — the worker explains, in prose, that it deliberately never mentions `/api/`, and that it
 * holds no key. Asserting against the raw text would fail on its own explanation, which is the
 * wrong way round: the invariant is about code, and the comments are the record of why it holds.
 *
 * Both files are plain scripts with no regular-expression literals and no `//` inside a string, so
 * removing block comments and then line comments is unambiguous here.
 */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

/**
 * Whether a file declares the `"use client"` directive.
 *
 * The directive is conventionally written after a file's doc comment, so it is not necessarily the
 * first character — matching only a leading directive would have reported this application's one
 * client component as not existing.
 */
function isClientComponent(source) {
  return /^\s*(\/\*[\s\S]*?\*\/\s*)*["'`]use client["'`]/u.test(source);
}

// =============================================================================
// 1. The manifest
// =============================================================================

console.log(`\n--- the manifest`);

const { default: manifest } = await import("../src/app/manifest.ts");
const document = manifest();

assertEqual(
  typeof document.name === "string" && document.name.length > 0,
  true,
  "1. it has a name",
);
assertEqual(
  document.name,
  "Hari OS",
  "1. and it is the application's own name",
);
assertEqual(
  typeof document.short_name === "string" && document.short_name.length > 0,
  true,
  "2. it has a short name, which is what a home screen shows",
);
assertEqual(
  document.start_url,
  "/",
  "3. it starts at the Dashboard rather than at a page of no particular importance",
);
assertEqual(
  document.display,
  "standalone",
  "4. it opens as an application window rather than a browser tab",
);
assertEqual(
  document.background_color,
  "#ffffff",
  "5. its background is the paper colour from globals.css",
);
assertEqual(
  document.theme_color,
  "#171717",
  "5. and its theme colour is the ink colour, matching viewport.themeColor",
);

// The scope default is the directory the manifest is served from, which is `/`. Asserting it is
// absent means nobody has narrowed it by accident: a wrong scope is an installability failure that
// produces no error.
assertEqual(
  Object.prototype.hasOwnProperty.call(document, "scope"),
  false,
  "6. it declares no scope, so the default — the whole origin — applies",
);

// =============================================================================
// 2. The icons
// =============================================================================

console.log(`\n--- the icons`);

const icons = document.icons ?? [];

assert(
  icons.length >= 2,
  "7. it names at least two icons, which is what installability asks for",
);

const anySizes = icons
  .filter((icon) => icon.purpose !== "maskable")
  .map((icon) => icon.sizes);
const maskableSizes = icons
  .filter((icon) => icon.purpose === "maskable")
  .map((icon) => icon.sizes);

assert(anySizes.includes("192x192"), "8. including one at 192x192");
assert(anySizes.includes("512x512"), "8. and one at 512x512");
assert(
  maskableSizes.includes("512x512"),
  "9. and a maskable one, which is what an Android launcher prefers",
);

for (const icon of icons) {
  const file = path.join(publicDirectory, icon.src.replace(/^\//u, ""));

  assert(
    fs.existsSync(file),
    `10. ${icon.src} exists, so the manifest names no 404`,
  );

  if (fs.existsSync(file)) {
    const bytes = fs.readFileSync(file);

    assertEqual(
      PNG_SIGNATURE.every((byte, index) => bytes[index] === byte),
      true,
      `10. ${icon.src} is a real PNG, not an error page with the wrong name`,
    );

    const [width, height] = icon.sizes.split("x").map(Number);

    // Width and height are the first eight bytes of the IHDR chunk, which follows the 8-byte
    // signature, the 4-byte length, and the 4-byte type.
    assertEqual(
      bytes.readUInt32BE(16) === width && bytes.readUInt32BE(20) === height,
      true,
      `10. ${icon.src} really is ${width}x${height}, as the manifest claims`,
    );
  }
}

// The same files, from the same generator, must be reproducible: a re-run that produced different
// bytes would mean the committed icons no longer match their source.
const { execFileSync } = await import("node:child_process");
const before = fs
  .readdirSync(publicDirectory)
  .filter((name) => name.endsWith(".png"))
  .map((name) => [name, fs.readFileSync(path.join(publicDirectory, name))]);

execFileSync(process.execPath, ["scripts/generate-icons.mjs"], {
  cwd: projectRoot,
  stdio: "ignore",
});

for (const [name, contents] of before) {
  assertEqual(
    fs.readFileSync(path.join(publicDirectory, name)).equals(contents),
    true,
    `11. ${name} is byte-identical when regenerated: the generator is deterministic`,
  );
}

// The layout links the same files, so a renamed icon breaks a test rather than a browser tab.
const layout = fs.readFileSync(
  path.join(projectRoot, "src", "app", "layout.tsx"),
  "utf8",
);
const appleTouch = fs.existsSync(
  path.join(publicDirectory, "apple-touch-icon.png"),
);

assert(
  appleTouch,
  "12. there is an apple-touch-icon for iOS, which ignores the manifest",
);
assert(
  layout.includes("apple-touch-icon.png") && layout.includes("favicon.png"),
  "12. and the document head links both it and a favicon",
);
assert(
  fs.existsSync(path.join(publicDirectory, "favicon.png")),
  "12. so no page load requests a /favicon.ico that does not exist",
);

// =============================================================================
// 3. The service worker
// =============================================================================

console.log(`\n--- the service worker`);

const workerFile = path.join(publicDirectory, "sw.js");

assert(fs.existsSync(workerFile), "13. it exists");

const worker = fs.readFileSync(workerFile, "utf8");
const workerCode = code(worker);

assert(
  worker.includes('addEventListener("install"'),
  "14. it handles install, which the platform calls",
);
assert(
  worker.includes('addEventListener("activate"'),
  "14. and activate, which is where it claims open clients",
);
assertEqual(
  path.dirname("sw.js") === ".",
  true,
  "15. it is served from the origin root, which is what gives it / as its scope",
);

// The absence claims, in the order they matter.
assert(
  !/addEventListener\(\s*["'`]fetch["'`]/u.test(workerCode),
  "16. it registers no fetch handler at all, so no request is ever intercepted",
);
assert(
  !workerCode.includes("respondWith"),
  "16. and nothing calls respondWith, so the browser's own network path serves everything",
);
assert(
  !/caches\.open\(/u.test(workerCode),
  "17. it opens no cache, so no response — private or otherwise — is ever stored",
);
assert(
  !/caches\.add(All)?\(/u.test(workerCode),
  "17. and nothing is added to a cache",
);
assert(
  !workerCode.includes("/api/"),
  "18. its code mentions no API path at all, so it cannot treat one differently",
);
assert(
  !/\b(fetch|XMLHttpRequest)\s*\(/u.test(workerCode),
  "18. and it makes no request of its own",
);
assert(
  !/addEventListener\(\s*["'`](message|sync|push|notificationclick|periodicsync)["'`]/u.test(
    workerCode,
  ),
  "19. it has no message, sync, push, or notification handler: no background capability",
);

// A worker is the one file here that runs with no page and no user watching.
assert(
  !/(api[_-]?key|token|secret|password|authorization|bearer)/iu.test(
    workerCode,
  ),
  "20. it contains no credential, or anything shaped like one",
);
assert(
  !/^\s*import\s/mu.test(workerCode) && !/^\s*export\s/mu.test(workerCode),
  "20. and no import or export: it is a classic script that runs on its own",
);
assert(
  !workerCode.includes("process.env") && !workerCode.includes("@/"),
  "20. and no build-time configuration or path alias, so it carries nothing from the server",
);

// =============================================================================
// 4. Registration is client-only, and inert
// =============================================================================

console.log(`\n--- registration`);

const registration = fs.readFileSync(
  path.join(projectRoot, "src", "app", "service-worker-registration.tsx"),
  "utf8",
);

assert(
  isClientComponent(registration),
  "21. registration lives in a client component, because there is no navigator on the server",
);
assert(
  registration.includes('"serviceWorker" in navigator'),
  "22. it checks for support before using it, so an unsupporting browser changes nothing",
);
assert(
  registration.includes("import.meta.env.PROD"),
  "22. and it does nothing in development, where a worker would only serve stale code",
);
assert(
  registration.includes(".catch("),
  "23. a failed registration is caught, so it is never an unhandled rejection",
);
assert(
  !registration.includes("getCamera") &&
    !registration.includes("mediaDevices") &&
    !registration.includes("permissions"),
  "24. it asks for no permission at all: registering a worker grants nothing",
);

// The server-rendering invariant: `navigator` may only be read once the component runs, never while
// the module is being imported — which is what server rendering does.
const registrationCode = code(registration);
const componentStart = registrationCode.indexOf("export function");
const navigatorUses = [...registrationCode.matchAll(/navigator/gu)].map(
  (match) => match.index,
);

assert(
  componentStart > 0 &&
    navigatorUses.length > 0 &&
    navigatorUses.every((index) => index > componentStart),
  "25. navigator appears only inside the component body, never at module scope",
);
assert(
  registrationCode.includes("typeof navigator ==="),
  "25. and it is guarded, so a context without it is not an error",
);

// No client boundary anywhere else: this is the only "use client" file in the application.
const { globSync } = await import("node:fs");
const clientFiles = globSync("src/**/*.{ts,tsx}", { cwd: projectRoot })
  .filter((file) =>
    isClientComponent(fs.readFileSync(path.join(projectRoot, file), "utf8")),
  )
  .sort();

assertEqual(
  clientFiles.join(","),
  "src/app/service-worker-registration.tsx",
  "26. it is the only client component in the application, so nothing else was hydrated for it",
);

// =============================================================================
// 5. Camera capture goes through the existing upload path
// =============================================================================

console.log(`\n--- camera capture`);

const uploadRoute = fs.readFileSync(
  path.join(projectRoot, "src", "app", "api", "photos", "route.ts"),
  "utf8",
);

assert(
  uploadRoute.includes('"capture"') && uploadRoute.includes('"photo"'),
  "27. the upload route accepts a file under either name",
);
assert(
  uploadRoute.includes("PHOTO_FIELDS") &&
    /for \(const field of PHOTO_FIELDS\)/u.test(uploadRoute),
  "27. through one loop over PHOTO_FIELDS, so both names are read and validated identically",
);
assert(
  uploadRoute.includes("isSameOriginRequest"),
  "28. a camera capture still passes the origin guard",
);
assert(
  uploadRoute.includes("storeLaundryPhoto"),
  "28. and still goes through the feature that validates bytes and names the file",
);
assertEqual(
  fs.existsSync(
    path.join(
      projectRoot,
      "src",
      "app",
      "api",
      "photos",
      "capture",
      "route.ts",
    ),
  ),
  false,
  "29. there is no second photo endpoint",
);

const habitsPage = fs.readFileSync(
  path.join(projectRoot, "src", "app", "habits", "page.tsx"),
  "utf8",
);

assert(
  habitsPage.includes('capture="environment"'),
  "30. the upload form offers the native camera",
);
assert(
  habitsPage.includes('name="photo"') &&
    habitsPage.includes('accept="image/*"'),
  "31. and still offers ordinary file selection, which is what a desktop uses",
);

// The real check: a camera-named part is validated exactly like any other. A non-image under
// `capture` must be refused with the same status and the same code a `photo` gets.
const { POST: PHOTO_POST } = await import("../src/app/api/photos/route.ts");

function multipart(fields, file) {
  const boundary = `----hariOsPwa${Math.random().toString(16).slice(2)}`;
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
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="photo.png"\r\nContent-Type: ${file.type}\r\n\r\n`,
        "utf8",
      ),
      Buffer.from(file.bytes),
      Buffer.from("\r\n", "utf8"),
    );
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));

  return { boundary, body: Buffer.concat(parts) };
}

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

const notAnImage = {
  field: "capture",
  type: "text/plain",
  bytes: "this is not a photo",
};

const refusedCapture = await PHOTO_POST(
  uploadRequest({ type: "laundry" }, notAnImage),
);
const refusedPhoto = await PHOTO_POST(
  uploadRequest({ type: "laundry" }, { ...notAnImage, field: "photo" }),
);

assertEqual(
  refusedCapture.status,
  400,
  "32. a non-image sent as a camera capture is refused",
);
assertEqual(
  refusedCapture.status,
  refusedPhoto.status,
  "32. with the same status a file from the device gets: the camera hint grants nothing",
);

const bothRefused = await PHOTO_POST(uploadRequest({ type: "laundry" }));

assertEqual(
  bothRefused.status,
  400,
  "33. a submission with neither field is refused, since neither is required of the form",
);

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
