/**
 * Write, change, or clear the note on one diary entry.
 *
 * ## Why this route exists rather than a form on the Habits page
 *
 * The note is addressed to a **row id** — the same id that appears in the photo's URL — because
 * the user is looking at a picture when they write about it. Addressing by day instead would make
 * "that photo" ambiguous the moment a day has two, and would force the page to guess which entry
 * the user meant. Guessing is exactly what the rest of this application refuses to do, so the
 * entry is named explicitly and the route never has to infer anything.
 *
 * ## One field, one meaning
 *
 * `note` is the whole request. Sending an empty string, or omitting it, clears the note — that is
 * `diaryNote`'s contract in `src/domain/diary.ts`, not a rule invented here. There is no
 * `action=delete` field, no separate DELETE route, and no way to express "clear" that means
 * something other than "no note", because three spellings of one intention are three states that
 * can disagree.
 *
 * ## What this handler holds no rules about
 *
 * The limit, the trimming, the control characters, and the requirement that the entry actually has
 * a photo all live in the domain and the feature. This handler reads a request and answers, in the
 * same shape as every other route in the application.
 *
 * ## Answers
 *
 * - **403** for a cross-origin post (ADR-042/045), the same guard as every other write.
 * - **400** for an id that is not an id, or a note the domain refuses, with the domain's own token.
 * - **201** for JSON callers, **303** back to `/diary` for form posts.
 *
 * The redirect is why a form post still reports failures: an HTML form cannot read a response
 * body, so without it a rejected note would land on a blank page. Tokens rather than text, for the
 * reason every other route does it — a note is something the user typed, and a redirect ends up in
 * browser history.
 */
import { NextResponse } from "next/server";

import { writeNote } from "@/features/habits/diary";
import { safeReturnPath } from "@/features/shared/command-form";
import { isSameOriginRequest } from "@/features/shared/same-origin";

/** Runs per request, so the route holds no state. */
export const dynamic = "force-dynamic";

/** Where a form post returns to when it does not say. The diary, since that is the only page. */
const DEFAULT_RETURN_PATH = "/diary";

/**
 * The numeric id from the path.
 *
 * `Number` over `parseInt`, for the reason the photo route uses it: `parseInt("12abc")` is 12, so
 * a URL that is not an id would edit some other entry's note.
 */
function readId(raw: string): number | null {
  if (!/^[0-9]+$/u.test(raw)) {
    return null;
  }

  const id = Number(raw);

  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The submitted note and the page to return to.
 *
 * Read once, because a body can only be consumed once and the two values come from the same form.
 * `undefined` for `note` means the body was unreadable, which clears nothing — a request that
 * could not be parsed must not be able to delete a note, or any malformed client would be able to
 * delete one.
 */
async function readSubmission(
  request: Request,
): Promise<{ note: string | null | undefined; next: string }> {
  if (
    (request.headers.get("content-type") ?? "").includes("application/json")
  ) {
    let body: { note?: unknown } | null = null;
    let parsed = false;

    try {
      body = (await request.json()) as { note?: unknown };
      parsed = true;
    } catch {
      // Left unparsed, and reported as `undefined` below rather than as "no note". A body that
      // could not be read must not be allowed to delete a stored note: any malformed client would
      // then be able to remove one.
      parsed = false;
    }

    return {
      // An unparsed body is `undefined`, which the caller refuses — see above. A parsed body whose
      // `note` is missing or is not a string is `null`, which means "no note". Anything that is not
      // a string is not a note, and passing such a value on to the domain would move the type
      // error somewhere less useful; `[object Object]` is not what anyone meant.
      note: parsed
        ? typeof body?.note === "string"
          ? body.note
          : null
        : undefined,
      next: DEFAULT_RETURN_PATH,
    };
  }

  const form = await request.formData().catch(() => null);

  if (form === null) {
    return { note: undefined, next: DEFAULT_RETURN_PATH };
  }

  const rawNote = form.get("note");
  const rawNext = form.get("next");

  return {
    note: typeof rawNote === "string" ? rawNote : null,
    next: typeof rawNext === "string" ? rawNext : DEFAULT_RETURN_PATH,
  };
}

function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin submissions are not accepted." },
      { status: 403 },
    );
  }

  const { id: rawId } = await context.params;
  const id = readId(rawId);

  if (id === null) {
    return NextResponse.json(
      { error: "No such diary entry.", token: "unknown_photo" },
      { status: 404 },
    );
  }

  const submission = await readSubmission(request);

  if (submission.note === undefined) {
    return NextResponse.json(
      { error: "The note was not sent as a form submission or as JSON." },
      { status: 400 },
    );
  }

  const returnTo = safeReturnPath(submission.next);
  const written = writeNote(id, submission.note);

  if (!written.ok) {
    if (written.kind === "persistence") {
      return NextResponse.json({ error: written.message }, { status: 500 });
    }

    if (wantsJson(request)) {
      return NextResponse.json(
        { error: written.error.message, token: written.error.code },
        { status: 400 },
      );
    }

    const query = new URLSearchParams({ err: written.error.code });

    return NextResponse.redirect(
      new URL(`${returnTo}?${query.toString()}`, request.url),
      { status: 303 },
    );
  }

  if (wantsJson(request)) {
    return NextResponse.json(
      {
        saved: true,
        id: written.value.entry.id,
        date: written.value.entry.date,
        note: written.value.entry.note,
        cleared: written.value.cleared,
      },
      { status: 201 },
    );
  }

  const query = new URLSearchParams({ saved: "ok" });

  if (written.value.cleared) {
    query.set("msg", `Note cleared for ${written.value.entry.date}.`);
  } else {
    query.set("msg", `Note saved for ${written.value.entry.date}.`);
  }

  return NextResponse.redirect(
    new URL(`${returnTo}?${query.toString()}`, request.url),
    { status: 303 },
  );
}

/** The note surface accepts writes only. Reading a note is part of the page. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "Use POST to write a note. The diary reads them at /diary." },
    { status: 405, headers: { allow: "POST" } },
  );
}
