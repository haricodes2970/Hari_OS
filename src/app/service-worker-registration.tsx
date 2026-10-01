/**
 * Registers the service worker, and nothing else.
 *
 * ## Why this file exists as its own client boundary
 *
 * `navigator.serviceWorker` does not exist during server rendering — there is no `navigator` on the
 * server at all, and a module that touched it at import time would fail the build. So the
 * registration has to happen in the browser, and the only honest way to do that in the App Router
 * is a `"use client"` component.
 *
 * This is that component, and it is deliberately tiny: a single `useEffect`, no state, no
 * rendering, no props. Adding `"use client"` to the root layout instead would pull the entire
 * application tree across the client/server boundary — every Server Component in every page — and
 * would mean hydration for pages that currently need none. A leaf component with no output keeps
 * the boundary at one empty element.
 *
 * ## What it does not do
 *
 * - **It never blocks anything.** Registration is fire-and-forget, and the page renders and works
 *   whether or not it succeeds. Nothing awaits the worker before showing data, because nothing may:
 *   a failed or unsupported worker must not mean an empty application.
 * - **It asks for nothing.** No camera permission, no notifications, no storage. The worker's
 *   whole cache policy is "nothing" (ADR-059), and registering it grants no access to anything the
 *   user has not already granted to the page.
 * - **It reports nothing to the page.** No state, no banner, no console output on failure. A user
 *   cannot act on "the service worker did not register", and an installability requirement is a
 *   browser-level prompt this application does not fake.
 *
 * ## Failure is not worth reporting, except in the console
 *
 * If registration rejects — a browser without support, a non-secure context, a hostile policy —
 * the `catch` exists so the rejection is not an unhandled promise in the user's console, and logs
 * once for whoever is debugging. An `if ("serviceWorker" in navigator)` guard covers the common
 * case first, and `import.meta.env.PROD` keeps the whole thing out of development, where a worker
 * would only be able to serve stale code to the person developing the application.
 */
"use client";

import { useEffect } from "react";

/**
 * The worker's URL. `public/sw.js` is served from the root, which is what gives it `/` as its
 * scope — a worker served from a subdirectory can only control that subdirectory, and this one
 * needs to control the application shell.
 */
const SERVICE_WORKER_URL = "/sw.js";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!import.meta.env.PROD) {
      return;
    }

    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: "/" })
      .catch(() => {
        // Nothing here is actionable by the user, and a failed registration is not a failure of
        // the application: every request is served over the network regardless.
      });
  }, []);

  return null;
}
