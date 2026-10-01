/**
 * Photos as a feature operation: upload the proof of a laundry day, and read one back.
 *
 * ## Why this module exists at all
 *
 * `src/app` is forbidden from touching storage — no driver, no `node:fs` — so a route handler
 * cannot write a file or read one. That rule is why the two photo routes are this thin: they parse
 * a request and call the two functions below. Everything with a rule in it lives here, next to
 * the habit rules it depends on, which is where a change to either will be noticed together.
 *
 * ## The order of operations, and why
 *
 * The file is written **before** the row, because the row needs the id to build the URL and the
 * id only exists after the insert. That leaves one window in which a file exists with no row, and
 * this module closes it: if the row cannot be written, the file is deleted before the failure is
 * returned. The opposite order was rejected — an inserted row whose image is missing renders as a
 * broken picture with no way for the application to tell it is unrecoverable.
 *
 * ## What is stored, and what is not
 *
 * `habit_log.photo_url` holds `/api/photos/<id>/<filename>`, and `habit_log.photo_note` holds the
 * user's own words about it (ADR-056). The URL is an **application URL**, never a filesystem path,
 * so the upload directory can move without stranding rows. The filename is in
 * the URL as well as the id, which costs nothing and buys one thing: `loadPhoto` refuses to read a
 * file whose name does not match the row, so no guessed path can reach a file this table does not
 * name.
 *
 * ## Which photos are accepted
 *
 * Only laundry, and only with a stated day reference or none at all (meaning today). The PRD's one
 * photo requirement is laundry's, and `habit_log.photo_url` is the only column that can hold a
 * picture, so an upload that proves nothing has nowhere to be stored. Refusing it — after
 * deleting the bytes — is the honest answer, and it is the reason there is no "gallery" mode
 * here: the Photo Diary is the timeline of laundry photos, read back through `loadPhoto`.
 */
import "server-only";

import type { CalendarDate } from "@/domain/calendar";
import { diaryNote } from "@/domain/diary";
import type { Result } from "@/domain/result";

import {
  MAX_PHOTO_BYTES,
  deletePhoto,
  readPhoto,
  savePhoto,
} from "@/lib/storage/photos";

import { getRepositories } from "../shared/command-runtime.ts";

/** A stored photo, as a caller refers to it afterwards. */
export type StoredPhotoRef = {
  readonly id: number;
  readonly url: string;
  readonly date: CalendarDate;
  readonly type: "laundry";
  readonly bytes: number;
};

/** A photo's contents, ready to be served. */
export type LoadedPhoto = {
  readonly bytes: Uint8Array;
  readonly contentType: string;
};

/**
 * The URL one stored photo is served from.
 *
 * The only form of the file's location the database keeps. Built in one place so the row written
 * by `storeLaundryPhoto` and the row checked by `loadPhoto` cannot disagree about it — a
 * mismatch here would make every photo unreadable rather than merely wrong.
 */
export function photoUrl(id: number, filename: string): string {
  return `/api/photos/${id}/${filename}`;
}

/**
 * Validates bytes, writes the file, and records the day as proved.
 *
 * `day` is already resolved to a calendar date by the route, from the stated day reference. The
 * row is written as done: uploading the picture is the completion, which is why the domain's
 * `photo_required` rule is satisfied by this path and not by a sentence.
 *
 * Every failure after the file exists removes it. The alternative — leaving an orphan for a
 * `deletePhoto` call nobody makes — is how `data/uploads` quietly fills with images nothing can
 * reach.
 *
 * ## About the note
 *
 * `note` is optional and, when given, is validated **before** anything is written. The order is the
 * whole point: a note that cannot be stored must not cost the user an uploaded file, and storing the
 * photo first would mean cleaning up after a rejection that was decided by text alone.
 *
 * A day is one row, so re-photographing it rewrites that row — and the previous note is read
 * inside the same transaction and carried onto the new photo unless this upload brought a note of
 * its own. Losing a note because someone uploaded a better picture of the same shelf is not a
 * correction the user asked for. Rewriting rather than deleting and reinserting is what keeps the
 * entry's id with its entry, so a note addressed to it still lands on the same picture; the
 * reasoning is on `updateHabitForDay`.
 */
export async function storeLaundryPhoto(
  bytes: Uint8Array,
  day: CalendarDate,
  note?: string | null,
): Promise<Result<StoredPhotoRef>> {
  // Validated up front, and the result is the value that gets stored rather than the text as it
  // arrived: trimmed, whitespace-only turned into "no note", control characters already refused.
  const stated = diaryNote(note);

  if (!stated.ok) {
    return stated;
  }

  const stored = await savePhoto(bytes);

  if (!stored.ok) {
    return stored;
  }

  const repositories = getRepositories();

  try {
    const saved = repositories.transaction(() => {
      // Read inside the transaction, so the note carried across belongs to the row being
      // rewritten and not to whatever a concurrent request did in between.
      const existing = repositories.habits.findForDay(day, "laundry");

      if (existing !== null) {
        // The day already has an entry, so the picture is updated onto it: same row, same id,
        // same note unless this upload brought one.
        const updated = repositories.habits.updateHabitForDay(day, "laundry", {
          done: true,
          photoUrl: photoUrl(existing.id, stored.value.filename),
          // A note typed now wins: it is about *this* photograph. `diaryNote` returning `null`
          // for an empty box means "the user said nothing", which must not be read as "the user
          // wants the old words deleted".
          photoNote: stated.value ?? existing.photoNote,
          minutes: existing.minutes,
        });

        if (!updated.ok) {
          throw new Error(updated.error.message);
        }

        return updated.value;
      }

      const inserted = repositories.habits.insertHabit({
        id: 0,
        date: day,
        type: "laundry",
        done: true,
        photoUrl: null,
        photoNote: null,
        minutes: null,
      });

      if (!inserted.ok) {
        throw new Error(inserted.error.message);
      }

      // The URL contains the row's id, so it cannot be part of the insert that produces the id.
      // The transaction is what makes the pair atomic: a row with no photo, or a photo with no
      // row, never both survive.
      const attached = repositories.habits.attachPhoto(
        day,
        "laundry",
        photoUrl(inserted.value.id, stored.value.filename),
      );

      if (!attached.ok) {
        throw new Error(attached.error.message);
      }

      const written = repositories.habits.saveDiaryNote(
        attached.value.id,
        stated.value,
      );

      if (!written.ok) {
        throw new Error(written.error.message);
      }

      return written.value;
    });

    return {
      ok: true,
      value: {
        id: saved.id,
        url: saved.photoUrl ?? photoUrl(saved.id, stored.value.filename),
        date: saved.date,
        type: "laundry",
        bytes: stored.value.bytes,
      },
    };
  } catch (cause) {
    await deletePhoto(stored.value.filename);

    return {
      ok: false,
      error: {
        // `photo_required` is the domain's own code for a laundry completion that has no photo,
        // and this failure means exactly that: the picture arrived and could not be recorded, so
        // from the data's point of view the proof does not exist. Reusing it keeps the wording the
        // user has already seen for the same situation.
        code: "photo_required",
        message:
          cause instanceof Error
            ? cause.message
            : "The photo was not recorded, so it was removed.",
      },
    };
  }
}

/**
 * Reads one stored photo back.
 *
 * Two checks, both necessary:
 *
 * - The id must belong to a habit row that has a photo. Without this, any integer would be read
 *   as a request for a file.
 * - The filename in the request must equal the filename in that row's stored URL. Without this,
 *   changing the name in the URL would read some other file in the upload directory — the same
 *   class of mistake as serving `data/` by guessing.
 *
 * `null` means there is nothing to serve, and the route turns that into a 404 rather than a 200
 * with no bytes.
 */
export async function loadPhoto(
  id: number,
  filename: string,
): Promise<Result<LoadedPhoto | null>> {
  const repositories = getRepositories();
  const row = repositories.habits.findById(id);

  if (row === null || row.photoUrl === null) {
    return { ok: true, value: null };
  }

  if (row.photoUrl !== photoUrl(id, filename)) {
    return { ok: true, value: null };
  }

  const bytes = await readPhoto(filename);

  if (bytes === null) {
    return { ok: true, value: null };
  }

  return { ok: true, value: { bytes, contentType: contentTypeFor(filename) } };
}

/**
 * The content type a stored file is served with.
 *
 * Derived from the extension `savePhoto` chose from the file's own bytes, so this cannot
 * disagree with the file. It is not derived from a request header: the browser's claim about a
 * file is not evidence, and serving a declared type that does not match the bytes is how an
 * upload becomes something the browser executes.
 */
function contentTypeFor(filename: string): string {
  const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();

  switch (extension) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}

/** The size limit, exposed so the page can say it before an upload is attempted. */
export const PHOTO_LIMIT_BYTES = MAX_PHOTO_BYTES;

/**
 * How much larger than the file limit a request body may be before it is refused unread.
 *
 * A `multipart/form-data` body carries the file plus a boundary, the field names, and the note, so
 * its length is always a little more than the file's. The slack is generous enough that no real
 * upload trips it and small enough to be worth having at all.
 */
export const UPLOAD_BODY_SLACK_BYTES = 64 * 1024;

/**
 * Whether a declared body length is already too large to read.
 *
 * Phase 9. The 10 MB rule was applied to the file *after* `formData()` had buffered the whole
 * request, so a caller could put an arbitrarily large body in memory by declaring nothing about it
 * and being refused afterwards. `Content-Length` is a claim, not a promise — a caller may lie or
 * omit it — so this is a cheap refusal in front of the real check, not a replacement for it: an
 * absent or unparseable header is not "allowed", it is simply not decided here, and the limit is
 * still enforced on the bytes themselves.
 */
export function bodyExceedsPhotoLimit(contentLength: string | null): boolean {
  if (contentLength === null) {
    return false;
  }

  const declared = Number(contentLength);

  if (!Number.isSafeInteger(declared) || declared < 0) {
    return false;
  }

  return declared > MAX_PHOTO_BYTES + UPLOAD_BODY_SLACK_BYTES;
}
