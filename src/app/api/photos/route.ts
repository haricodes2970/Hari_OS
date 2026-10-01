/**
 * Upload a photo: the PRD's proof for laundry, and the pictures in the Photo Diary.
 *
 * ## This handler holds no rules
 *
 * `src/app` may not touch storage — no `node:fs`, no driver — so validating bytes, naming the
 * file, writing it, and recording the day are all `storeLaundryPhoto`'s job. What is left here is
 * the part only a route can do: read a request, refuse a cross-origin one, and answer.
 *
 * ## What the request must contain
 *
 * A `multipart/form-data` body with one non-empty `photo` part, because a `<form>` can post a file
 * and a chat sentence cannot. An optional `day` is a **stated day reference** — "today",
 * "tomorrow", "yesterday" — never a date, matching every other write path in the application, so
 * no client can name a calendar day it worked out for itself. Absent means today.
 *
 * ## Three answers, and why each is specific
 *
 * - **403** for a cross-origin post, the same guard every write route uses (ADR-042/045). With
 *   no session, it is the only thing between a page the user did not open and a write to their
 *   data.
 * - **400** for a request with no file, a file that is empty, or a `day` that is not one of the
 *   three words. Each names the problem, because the user can act on that and not on "upload
 *   failed".
 * - **201** with the stored photo's id and URL on success.
 *
 * The handler deliberately does not accept an arbitrary habit type. Laundry is the only thing the
 * PRD requires a photo for, and `habit_log.photo_url` is the only column that can hold a picture;
 * the reason is spelled out in `src/features/habits/photos.ts`.
 */
import { NextResponse } from "next/server";

import { isDayReference, resolveDayReference } from "@/domain/routine";
import { storeLaundryPhoto } from "@/features/habits/photos";
import { isSameOriginRequest } from "@/features/shared/same-origin";

import { currentUtcDate } from "@/features/shared/command-runtime";

/** Runs per request, so the database handle and the filesystem stay per-call. */
export const dynamic = "force-dynamic";

/**
 * Reads the uploaded file.
 *
 * `form.get` returns `File | string | null`. Only a real `File` with content is accepted: a string
 * of that name means the part was a text field, and an empty `File` would be written and then
 * refused by the byte check with a vaguer message than "no photo was attached".
 */
function readFile(form: FormData): File | null {
  const entry = form.get("photo");

  return entry instanceof File && entry.size > 0 ? entry : null;
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
      { error: "The upload was not a form submission." },
      { status: 400 },
    );
  }

  const file = readFile(form);

  if (file === null) {
    return NextResponse.json(
      {
        error: "No photo was attached to the upload.",
        token: "invalid_photo",
      },
      { status: 400 },
    );
  }

  // Only laundry is provable. A photo for any other habit — or for no habit at all — has nowhere
  // to be stored: `habit_log.photo_url` is the only column that can hold one, and writing the file
  // anyway would leave bytes on disk that no page could ever reach. So the type is checked here,
  // before anything is written.
  if (form.get("type") !== "laundry") {
    return NextResponse.json(
      {
        error:
          "A photo can only be uploaded as the proof for laundry, which is the one thing the PRD requires one for.",
        token: "invalid_photo",
      },
      { status: 400 },
    );
  }

  const today = currentUtcDate();
  const dayField = form.get("day");
  const statedDay =
    typeof dayField === "string" && dayField !== "" ? dayField : null;

  if (statedDay !== null && !isDayReference(statedDay)) {
    return NextResponse.json(
      {
        error: `"${statedDay}" is not a day the application understands. Use today, tomorrow, or yesterday.`,
        token: "invalid_date",
      },
      { status: 400 },
    );
  }

  const resolved =
    statedDay === null
      ? { ok: true as const, value: today }
      : resolveDayReference(statedDay, today);

  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error.message, token: resolved.error.code },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const stored = await storeLaundryPhoto(bytes, resolved.value);

  if (!stored.ok) {
    // A size refusal is 413 because that is what it is, and the page distinguishes "too large"
    // from "not an image" by status rather than by reading prose.
    return NextResponse.json(
      { error: stored.error.message, token: stored.error.code },
      { status: stored.error.code === "photo_too_large" ? 413 : 400 },
    );
  }

  return NextResponse.json(
    {
      stored: true,
      id: stored.value.id,
      url: stored.value.url,
      date: stored.value.date,
    },
    { status: 201 },
  );
}

/** The upload surface accepts writes only. Reading one is a separate route. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error:
        "Use POST to upload a photo. Photos are read from /api/photos/<id>/<filename>.",
    },
    { status: 405, headers: { allow: "POST" } },
  );
}
