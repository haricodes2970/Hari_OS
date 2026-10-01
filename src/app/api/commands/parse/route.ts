/**
 * `POST /api/commands/parse` — the natural-language entry point.
 *
 * A second endpoint, and deliberately not a change to `POST /api/commands`. The structured
 * endpoint is the proven path and stays exactly as it was: it receives a command-shaped body
 * and hands it to the Phase 1 executor. This one receives a sentence, parses it, and then
 * converges on the *same* executor by calling the same engine the rest of the application
 * uses. There is still exactly one execution path; this route only widens the input.
 *
 * ## Why results go back as query parameters
 *
 * The chat input is a plain HTML form, so it must work with JavaScript disabled (ADR-037).
 * A form cannot read a response body, so on success or failure the answer is a `303` back to
 * the page carrying the outcome in the query string, and the page renders it.
 *
 * What travels back is **an enum, not prose**. `status` is one of a fixed set and
 * `missing`/`token` are drawn from closed sets, and the sentence the user typed is echoed back
 * as `said` because it is their own data. A model's free-text explanation is never reflected
 * into a URL or a page, so a model cannot put arbitrary content into the interface. The
 * sentences themselves are written in `features/chat/presentation.ts`, from the trusted
 * execution result.
 *
 * A caller that asks for JSON gets the structured result instead, which is what the tests and
 * any future client use.
 *
 * Server-only.
 */
import { NextResponse } from "next/server";

import type { ChatResult } from "@/features/chat/presentation";
import { describeChatResult } from "@/features/chat/presentation";
import { getChatEngine } from "@/features/chat/runtime";

/** Per request; the engine holds a provider client, not request state. */
export const dynamic = "force-dynamic";

/** Where a submission should return to when the caller does not say. */
const DEFAULT_ORIGIN = "/";

/** Long enough for a full page, short enough to stay in a URL bar. */
const MAX_ECHOED_SENTENCE = 500;

function text(form: FormData, name: string): string {
  const value = form.get(name);

  return typeof value === "string" ? value : "";
}

/**
 * Only same-site paths, for the same reason as the structured endpoint: a redirect that can be
 * pointed anywhere would turn this into a phishing primitive. One leading slash, never a
 * protocol-relative `//host`.
 */
function safeReturnPath(candidate: string): string {
  return /^\/(?!\/)/.test(candidate) ? candidate : DEFAULT_ORIGIN;
}

/**
 * The result as query parameters.
 *
 * `applied` and the two configuration-flavoured failures carry a message, because those
 * messages are written by this application: a confirmation assembled from the stored result,
 * or a configuration instruction. The other outcomes carry only tokens, because their wording
 * is looked up rather than carried.
 */
function outcomeQuery(result: ChatResult, sentence: string): URLSearchParams {
  const query = new URLSearchParams();

  if (result.status === "empty") {
    return query;
  }

  query.set("said", sentence.slice(0, MAX_ECHOED_SENTENCE));
  query.set("status", result.status);

  if (
    result.status === "applied" ||
    result.status === "unconfigured" ||
    result.status === "unavailable"
  ) {
    query.set("msg", result.message);
  }

  if (result.status === "needs_clarification") {
    for (const fact of result.missing) {
      query.append("missing", fact);
    }
  }

  if (result.status === "rejected") {
    query.set("token", result.token);
    if (result.field !== null) {
      query.set("field", result.field);
    }
  }

  return query;
}

function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

/**
 * Rejects a submission that came from another site.
 *
 * This endpoint is a write: a parsed sentence is executed, so any page the user happens to have
 * open could otherwise cause a command to run by posting a form to `localhost`. There is no
 * cookie or session to rely on, because there is no sign-in (V1 is single-user and
 * unauthenticated), so the browser-supplied `Origin` is the only thing distinguishing the app
 * from a third party — and it is a header a browser cannot be talked out of sending on a
 * cross-origin POST.
 *
 * A request with **no** `Origin` is allowed. Non-browser clients do not send one, and refusing
 * them would break the tests and `curl`. The check is therefore "reject a cross-origin
 * submission" rather than "accept only a browser submission", which is the same trade every
 * same-origin form guard makes.
 *
 * ## Why the `Host` header is also accepted
 *
 * Comparing `Origin` only against `request.url` looks sufficient and is not. `next start`
 * derives its own canonical hostname from configuration, so a request that arrived at
 * `http://127.0.0.1:3111` is seen server-side as `http://localhost:3111` — the `Host` header
 * says `127.0.0.1:3111` while the reconstructed URL says `localhost:3111`. The browser
 * faithfully sends `Origin: http://127.0.0.1:3111`, and comparing that against the URL alone
 * refuses the application's own users. Both are the same origin for this deployment, so both
 * are accepted; `http://` and `https://` are tried because a TLS-terminating proxy would present
 * one scheme while the internal URL carries the other.
 */
function isSameOrigin(request: Request): boolean {
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

/**
 * `malformed` distinguishes "the caller sent a body I could not read" from "the caller sent an
 * empty sentence". The second is a user who typed nothing and gets a quiet redirect; the first
 * is a broken client, and answering it as if it were an empty sentence would report success for
 * a request that was never understood.
 */
async function readSentence(
  request: Request,
): Promise<{ sentence: string; returnTo: string; malformed: boolean }> {
  if (
    (request.headers.get("content-type") ?? "").includes("application/json")
  ) {
    let body: { text?: unknown; next?: unknown };

    try {
      body = (await request.json()) as { text?: unknown; next?: unknown };
    } catch {
      return { sentence: "", returnTo: DEFAULT_ORIGIN, malformed: true };
    }

    const sentence = typeof body.text === "string" ? body.text : "";
    const next = typeof body.next === "string" ? body.next : "";

    return { sentence, returnTo: safeReturnPath(next), malformed: false };
  }

  const form = await request.formData().catch(() => null);

  if (form === null) {
    return { sentence: "", returnTo: DEFAULT_ORIGIN, malformed: true };
  }

  return {
    sentence: text(form, "text"),
    returnTo: safeReturnPath(text(form, "next")),
    malformed: false,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    // Reported to the caller as well as the server log's subject: this route is a localhost
    // application, so the only expected cross-origin submission is one that did not come from
    // the app. No sentence is read and no provider is called.
    return NextResponse.json(
      { error: "Cross-origin submissions are not accepted." },
      { status: 403 },
    );
  }

  const { sentence, returnTo, malformed } = await readSentence(request);

  if (malformed) {
    return NextResponse.json(
      { error: "The request body was not readable JSON." },
      { status: 400 },
    );
  }

  if (sentence.trim() === "") {
    const empty: ChatResult = { status: "empty" };

    // Same envelope as every other answer, so a client can read `ok` without special-casing
    // the empty result.
    return wantsJson(request)
      ? NextResponse.json(
          { ok: true, result: empty, message: describeChatResult(empty) },
          { status: 200 },
        )
      : NextResponse.redirect(new URL(returnTo, request.url), { status: 303 });
  }

  const result = await getChatEngine().interpret(sentence);

  if (wantsJson(request)) {
    // A refusal is a successful request that produced a refusal, so the HTTP status reports
    // whether the service worked, and `ok` reports the outcome. Collapsing the two would
    // make a missing API key look identical to a malformed sentence.
    return NextResponse.json(
      { ok: true, result, message: describeChatResult(result) },
      { status: 200 },
    );
  }

  return NextResponse.redirect(
    new URL(
      `${returnTo}?${outcomeQuery(result, sentence).toString()}`,
      request.url,
    ),
    { status: 303 },
  );
}

/** Parsing is a write, because a parsed command is executed. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "Use POST to submit a sentence." },
    { status: 405, headers: { allow: "POST" } },
  );
}
