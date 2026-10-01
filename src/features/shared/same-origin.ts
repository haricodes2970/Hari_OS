/**
 * One same-origin check, shared by every route that writes.
 *
 * Phase 2 put this in the parse route, where it was found by HTTP acceptance testing after
 * the route had already shipped without it. Duplicating the rule into the Kitchen route would
 * make the guard correct in two places and enforceable in none, so it lives here and both
 * routes import it. A third write route must import it too.
 *
 * ## Why a write route needs this at all
 *
 * ADR-002 keeps authentication out of V1, so there is no cookie and no session — nothing that
 * a browser will refuse to attach to a cross-site request. That leaves the browser-supplied
 * `Origin` as the only signal separating this application from any other page the user has
 * open, and `Origin` is a header a browser will not drop from a cross-origin POST. Without
 * this check, a page the user happened to visit could post a form to `localhost` and cause a
 * command to run.
 *
 * This is a CSRF defence, not authorisation. It does not stop a local process, and it is not a
 * substitute for authentication if this ever becomes multi-user.
 *
 * ## Why a missing Origin is allowed
 *
 * `curl`, the test scripts, and any future non-browser client send no `Origin` at all.
 * Refusing them would mean refusing the very requests used to verify this guard. The check is
 * therefore "reject a cross-origin submission", not "accept only browser submissions", which
 * is the trade every same-origin form guard makes.
 *
 * ## Why the Host header counts as well as the request URL
 *
 * Comparing `Origin` only against the reconstructed request URL looks sufficient and is not.
 * `next start` derives its own canonical hostname from configuration, so a request that
 * genuinely arrived at `http://127.0.0.1:3111` is seen server-side as `http://localhost:3111`
 * — the `Host` header says `127.0.0.1:3111` while the URL says `localhost:3111`. The browser
 * faithfully sends `Origin: http://127.0.0.1:3111`, and comparing that against the URL alone
 * refuses the application's own users. Both name this same deployment, so both are accepted.
 * `http://` and `https://` are both tried because a TLS-terminating proxy would present one
 * scheme while the internal URL carries the other.
 *
 * Pure and client-safe: it takes a `Request` and returns a boolean, imports nothing, and can be
 * exercised directly in a test without a server.
 */

/**
 * Whether a request may perform a write.
 *
 * `true` for a same-origin submission and for one that carries no `Origin` at all; `false`
 * only for a submission that positively identifies another site.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");

  if (origin === null) {
    return true;
  }

  const host = request.headers.get("host");
  const allowed = new Set<string>([new URL(request.url).origin]);

  if (host !== null) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }

  return allowed.has(origin);
}
