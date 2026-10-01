/**
 * The routine write route: the night check-in, and nothing else.
 *
 * ## Why this exists when `/api/commands` already does
 *
 * `/api/commands` runs one command — one stated fact. The check-in is three tasks and a phone
 * confirmation that either all happen or none do, which is a transaction over several rows
 * and therefore an *operation* rather than a command (see
 * `src/features/routine/write.ts`). Everything else the routine surfaces — planning a task,
 * completing one, recording a bedtime, starting and ending a nap — goes through the ordinary
 * command endpoint, so this route deliberately holds a single operation instead of becoming
 * a second way to do everything.
 *
 * ## Security
 *
 * Same guard, same shared implementation, as the command and Kitchen routes (ADR-042,
 * ADR-045): a request whose `Origin` and `Host` disagree is refused with 403 before the body
 * is read. V1 has no session, so without that check any page the user had open could post a
 * check-in over a plan the user did not write. There is no GET, and no other verb.
 */
import { NextResponse } from "next/server";

import { currentUtcDate } from "@/features/shared/command-runtime";
import { isSameOriginRequest } from "@/features/shared/same-origin";

import { runNightCheckIn } from "@/features/routine/write";

/** Runs per request, so the database handle and clock stay per-call. */
export const dynamic = "force-dynamic";

const RETURN_PATH = "/routine";

/** The one operation this route performs. */
const OPERATIONS = ["night_check_in"] as const;

type Operation = (typeof OPERATIONS)[number];

function isOperation(value: string): value is Operation {
  return (OPERATIONS as readonly string[]).includes(value);
}

/** How many title inputs the check-in form submits. */
const TITLE_FIELDS = ["title1", "title2", "title3"] as const;

/**
 * Runs one operation, as a function of the submitted fields.
 *
 * Split out from the handler so the dispatch can be tested without constructing a request,
 * which is how the check-in's own tests exercise its refusals.
 */
export function runRoutineOperation(
  fields: ReadonlyMap<string, string>,
  today: string,
): ReturnType<typeof runNightCheckIn> {
  const operation = fields.get("operation") ?? "";

  if (!isOperation(operation)) {
    return {
      ok: false,
      token: "invalid_command",
      error: "That is not a routine action.",
    };
  }

  // The phone confirmation is a user-provided fact, and the only two words accepted are the
  // two the form offers. Anything else — including an absent field, which an unchecked box
  // does not send — is a refusal rather than a default, so a missing value cannot be read as
  // "the phone was outside".
  const phone = fields.get("phoneOutside") ?? "";

  if (phone !== "true" && phone !== "false") {
    return {
      ok: false,
      token: "invalid_command",
      error: "Answer whether the phone is charging outside the bedroom.",
    };
  }

  return runNightCheckIn({
    today,
    titles: TITLE_FIELDS.map((name) => fields.get(name) ?? ""),
    phoneOutside: phone === "true",
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin submissions are not accepted." },
      { status: 403 },
    );
  }

  const form = await request.formData().catch(() => null);

  if (form === null) {
    return NextResponse.json(
      { error: "The request body was not readable." },
      { status: 400 },
    );
  }

  const fields = new Map<string, string>();

  for (const [key, value] of form.entries()) {
    if (typeof value === "string" && !fields.has(key)) {
      fields.set(key, value.trim());
    }
  }

  const result = runRoutineOperation(fields, currentUtcDate());
  const query = new URLSearchParams();

  if (result.ok) {
    query.set("saved", "ok");
    query.set("msg", result.message);
  } else {
    query.set("err", result.token);
  }

  return NextResponse.redirect(
    new URL(`${RETURN_PATH}?${query.toString()}`, request.url),
    { status: 303 },
  );
}

/** The routine surface accepts writes only. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "Use POST to submit a routine change." },
    { status: 405, headers: { allow: "POST" } },
  );
}
