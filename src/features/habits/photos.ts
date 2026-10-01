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
 * `habit_log.photo_url` holds `/api/photos/<id>/<filename>`. It is an **application URL**, never a
 * filesystem path, so the upload directory can move without stranding rows. The filename is in
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
 * Validates bytes, writes the file, and records today's laundry as proved.
 *
 * `day` is already resolved to a calendar date by the route, from the stated day reference. The
 * row is written as done: uploading the picture is the completion, which is why the domain's
 * `photo_required` rule is satisfied by this path and not by a sentence.
 *
 * Every failure after the file exists removes it. The alternative — leaving an orphan for a
 * `deletePhoto` call nobody makes — is how `data/uploads` quietly fills with images nothing can
 * reach.
 */
export async function storeLaundryPhoto(
  bytes: Uint8Array,
  day: CalendarDate,
): Promise<Result<StoredPhotoRef>> {
  const stored = await savePhoto(bytes);

  if (!stored.ok) {
    return stored;
  }

  const repositories = getRepositories();

  try {
    const saved = repositories.transaction(() => {
      const existing = repositories.habits.findForDay(day, "laundry");

      if (existing !== null) {
        const removed = repositories.habits.deleteForDay(day, "laundry");

        if (!removed.ok) {
          throw new Error(removed.error.message);
        }
      }

      const inserted = repositories.habits.insertHabit({
        id: 0,
        date: day,
        type: "laundry",
        done: true,
        photoUrl: null,
        minutes: null,
      });

      if (!inserted.ok) {
        throw new Error(inserted.error.message);
      }

      const attached = repositories.habits.attachPhoto(
        day,
        "laundry",
        photoUrl(inserted.value.id, stored.value.filename),
      );

      if (!attached.ok) {
        throw new Error(attached.error.message);
      }

      return attached.value;
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
