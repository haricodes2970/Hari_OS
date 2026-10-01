/**
 * The one endpoint that turns a request into a command.
 *
 * Structure: `UI → this handler → executor → domain → repositories → SQLite`. Every command in
 * the application enters here and nowhere else, which is what makes "one path to the data" a
 * property of the code rather than a habit. There is no second entry point — no server
 * action, no direct repository call from a page — so there is no second set of rules to keep
 * in step.
 *
 * ## Two ways in, one path down
 *
 * A JSON caller posts a command in the shape the contract already defines: `version`, amounts
 * in minor units, quantities as numbers. That body goes to the executor **untouched**, so the
 * API surface is exactly the validated command contract and nothing is quietly reinterpreted
 * on the way in.
 *
 * A form post is different, because a person types `50`, not `5000`. Those fields are
 * translated by `formToCommand`, which is the only translation in the application and which
 * fails closed rather than inventing values.
 *
 * ## Why a redirect
 *
 * An HTML form cannot read a response body, so a failed post would land the user on a blank
 * page with no idea what happened. The handler answers `303 See Other` back to the page the
 * form came from, carrying the outcome as short tokens in the query string. That works with
 * JavaScript disabled, it is inspectable with `curl`, and it leaves nothing on the server. A
 * caller that asks for JSON gets JSON instead.
 *
 * ## Why the outcome is only ever tokens
 *
 * A token is a fixed word chosen by `tokenForError`, never text the caller supplied, so
 * reflecting the outcome into a query string cannot reflect anything a user typed. The page
 * expands it to a sentence with `describeOutcome`.
 *
 * Server-only: importing the runtime below pulls in a database connection.
 */
import { NextResponse } from "next/server";

import type { ExecutionResult } from "@/commands/executor";
import {
  DEFAULT_RETURN_PATH,
  formToCommand,
  safeReturnPath,
} from "@/features/shared/command-form";
import {
  fieldForError,
  outcomeRedirect,
  tokenForError,
} from "@/features/shared/outcomes";
import { isSameOriginRequest } from "@/features/shared/same-origin";

import { runCommand } from "@/features/shared/command-runtime";

/** Runs per request, so the database handle and clock stay per-call. */
export const dynamic = "force-dynamic";

function text(form: FormData, name: string): string {
  const value = form.get(name);

  return typeof value === "string" ? value : "";
}

/**
 * The outcome as short tokens in a query string.
 *
 * `field` carries only the *name* of a field, which is a fixed identifier, not the value that
 * was entered, so it identifies what to correct without echoing anything the user typed.
 */
function outcomeQuery(result: ExecutionResult): URLSearchParams {
  const query = new URLSearchParams();

  if (result.ok) {
    query.set("saved", "ok");
    return query;
  }

  query.set("err", tokenForError(result.error));

  const field = fieldForError(result.error);
  if (field !== null) {
    query.set("field", field);
  }

  return query;
}

/**
 * The body as an untrusted command object, read exactly once.
 *
 * A body that is not JSON is not a command, and becomes `null` so that validation — not this
 * handler — reports it.
 */
async function readBody(
  request: Request,
): Promise<{ command: unknown; returnTo: string }> {
  if (
    (request.headers.get("content-type") ?? "").includes("application/json")
  ) {
    try {
      return {
        command: (await request.json()) as unknown,
        returnTo: DEFAULT_RETURN_PATH,
      };
    } catch {
      return { command: null, returnTo: DEFAULT_RETURN_PATH };
    }
  }

  const form = await request.formData().catch(() => new FormData());

  return {
    command: formToCommand(form),
    returnTo: safeReturnPath(text(form, "next")),
  };
}

function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

export async function POST(request: Request): Promise<NextResponse> {
  // Same rule, same shared implementation, as the parse route and the Kitchen route (ADR-042).
  // This handler executes commands — including spending the user's money — and V1 has no session,
  // so without this check any page the user happened to have open could post a form here and
  // cause an expense to be recorded. Phase 4 found the guard missing here; see ADR-045.
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin submissions are not accepted." },
      { status: 403 },
    );
  }

  const { command, returnTo } = await readBody(request);

  const result = runCommand(command);

  if (wantsJson(request)) {
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  return NextResponse.redirect(
    outcomeRedirect(returnTo, request.url, outcomeQuery(result)),
    { status: 303 },
  );
}

/** The command surface accepts writes only. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "Use POST to submit a command." },
    { status: 405, headers: { allow: "POST" } },
  );
}
