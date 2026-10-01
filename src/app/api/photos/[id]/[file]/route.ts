/**
 * Serve one stored photo.
 *
 * The URL is `/api/photos/<id>/<filename>`, exactly as `habit_log.photo_url` records it, so a
 * copied link keeps working and this handler has something to check the request against.
 *
 * ## Why both parts of the URL are checked
 *
 * `loadPhoto` refuses unless the id belongs to a habit row that has a photo **and** the filename in
 * the request is the filename in that row. The second check is the one that matters: without it, a
 * caller who changed one character of a filename would be reading a different file out of the
 * upload directory, which is the same mistake as serving a data directory by guessing.
 *
 * ## The content type comes from the file, not the request
 *
 * The browser's `Accept` header says nothing about what the bytes are, and the extension came from
 * the file's own signature when it was stored. So the response type is derived here from the stored
 * name and never from anything a caller sent.
 *
 * ## Why there is no cache header guessing here
 *
 * The response is not marked immutable even though the filename is a fresh UUID. The UUID makes the
 * bytes for a given name permanent, but the *row* can change: the user can replace the day's photo,
 * and the new file gets a new name. A cache entry keyed on the old URL therefore cannot go stale in
 * a way that matters, and inventing a long-lived header would only add a failure mode.
 *
 * `404` for anything that does not resolve, rather than a 200 with no bytes — an empty 200 renders
 * as a broken image with no way for the user to tell it from a slow one.
 */
import { NextResponse } from "next/server";

import { loadPhoto } from "@/features/habits/photos";

/** Runs per request, so the route holds no state. */
export const dynamic = "force-dynamic";

/**
 * Reads the numeric id.
 *
 * A non-numeric segment is not an id, so it is a 404 rather than a lookup that guesses. `Number`
 * is used deliberately over `parseInt`, because `parseInt("12abc")` is 12 — a URL that is not an
 * id would then read a photo the caller did not ask for.
 */
function readId(raw: string): number | null {
  if (!/^[0-9]+$/u.test(raw)) {
    return null;
  }

  const id = Number(raw);

  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; file: string }> },
): Promise<NextResponse> {
  const { id: rawId, file } = await context.params;
  const id = readId(rawId);

  if (id === null) {
    return NextResponse.json({ error: "No such photo." }, { status: 404 });
  }

  const photo = await loadPhoto(id, file);

  if (!photo.ok) {
    return NextResponse.json({ error: photo.error.message }, { status: 500 });
  }

  if (photo.value === null) {
    return NextResponse.json({ error: "No such photo." }, { status: 404 });
  }

  return new NextResponse(photo.value.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": photo.value.contentType,
      // The bytes are the user's own laundry, so they are marked private rather than
      // cacheable by a shared cache. `nosniff` matters here: without it a browser may decide an
      // image is something else, and this is the one route that serves bytes a user supplied.
      "cache-control": "private, max-age=0, must-revalidate",
      "x-content-type-options": "nosniff",
    },
  });
}
