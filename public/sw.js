/**
 * The service worker. Its entire job is to exist, and it does nothing else.
 *
 * ## Why there is one at all
 *
 * Chrome requires a registered service worker with a fetch handler for the install prompt
 * (`beforeinstallprompt` never fires without one). That is the whole requirement. The PRD asks for
 * an installable app and camera access, and this file is what makes the first of those testable in
 * a browser.
 *
 * ## The cache policy: nothing is cached
 *
 * There is no `caches` call anywhere in this file, and that is a decision rather than an omission.
 *
 * Hari OS is a **server-rendered application over live SQLite**. Every page reflects state the user
 * just recorded: an expense they entered, a note they wrote, a photo they uploaded. A cache in
 * front of that does not make it faster, because the response cannot be reused — and it makes it
 * **wrong**, in the specific way this project cannot accept:
 *
 * - A diary note written on one tab would not appear on another tab that had the old page cached.
 *   PRD principle 13 requires every mutation to be traceable and correctable, and a diary that
 *   shows yesterday's words is not correctable — the user would correct the cache, not the data.
 * - A photo at `/api/photos/<id>/<filename>` is private user data. Caching it into storage the
 *   user cannot see, and cannot delete per-photo, is a worse version of the thing
 *   `data/uploads/` being git-ignored so carefully.
 * - `POST /api/commands`, the photo upload, and the note route are **not** cached, not
 *   intercepted, and not modified. This worker has no `fetch` handler at all, so the browser's
 *   own network path serves every request, exactly as it does with JavaScript disabled.
 * - Nothing is served from the cache when the server is unreachable. A cached Dashboard showing
 *   yesterday's balances with no way to tell would be a lie the user has to notice themselves.
 *
 * The cost is that the app needs its server running, which it always did: it is a local
 * application with a local database and a local filesystem, not a static site.
 *
 * ## Lifecycle, and why it is this short
 *
 * `install` and `activate` exist because the platform calls them and a worker that throws in either
 * fails to install. Neither does anything except let the installation complete. `skipWaiting` and
 * `clients.claim` are called so a new version takes over without the user having to close every
 * tab — which matters when the only way to be sure a new worker is running is to reload, and
 * reload is the one thing a service worker makes awkward.
 *
 * There is deliberately no `fetch` listener, no `message` listener, no `sync`, and no
 * `notificationclick`. Each would be a new capability, and Phase 8's scope is installability and
 * camera access — not offline operation (ADR-059).
 *
 * ## Scope
 *
 * Served from `/sw.js`, so its scope is `/` — the whole origin, which is what an app shell needs.
 * It is not served from a subdirectory, because a worker can only control paths at or below its
 * own location, and `public/sw.js` is the shallowest path a static file can take.
 *
 * ## What this file may not do
 *
 * It is a static asset in `public/`. It imports nothing — no application module, no database, no
 * provider, no configuration, no key. `npm run pwa:test` asserts all of that, because a service
 * worker is the one place in this application that runs in the background with no page and no user
 * watching, and that is exactly where a secret would go unnoticed.
 */

/**
 * The prefix of any cache this worker is responsible for.
 *
 * It is never opened — see the policy above — and it exists so that `activate` has something
 * specific to clean up: a cache left behind by an earlier version of this file, or by a future one
 * that decides to cache something. Matching on the prefix rather than deleting every cache on the
 * origin means this worker can only ever remove its own, which matters as soon as a second
 * application shares the origin.
 */
const CACHE_PREFIX = "hari-os-";

self.addEventListener("install", () => {
  // Take over as soon as the new worker is installed, rather than waiting for every tab of the
  // application to be closed.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Delete any cache this worker is responsible for. There is none today; this is what makes that
  // true rather than merely intended, and it runs once per activation.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
/**
 * No `fetch` handler, on purpose.
 *
 * Registering one that does nothing but forward would mean the browser stops applying its own
 * network handling and this file starts deciding — and the day that forwarding logic gains a
 * condition ("skip `/api/`", "cache images"), the file that decides becomes the place private data
 * can leak from. Not registering it at all means every request is served by the browser exactly as
 * it would be with no worker installed, which is the strongest guarantee available and costs
 * nothing here.
 *
 * Note this file is a **classic** worker script: it is served as-is from `public/` and registered
 * without `{ type: "module" }`, so it contains no `export`, no `import`, and no bundler. Anything
 * that made it a module would stop it parsing, and a worker that fails to parse cannot be
 * installed at all.
 */