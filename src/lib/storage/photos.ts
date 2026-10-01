/**
 * Photo storage: the only place in the application that touches a file on disk.
 *
 * ## Why photos are not in `public/`
 *
 * `public/` is served to the browser with no authorisation. A laundry photo is the user's home,
 * so it goes to `data/uploads/`, which is git-ignored, and is reached through
 * `/api/photos/<id>` — a route that can check that the caller is asking for a row that exists
 * before it reads a byte. V1 has no authentication (ADR: none until required), so this is not a
 * security boundary against an attacker; it is a boundary against the repository, against a
 * filename guess, and against the file layout leaking into the UI.
 *
 * ## Every file is checked before it is written, and named by the server
 *
 * Four rules, each of which closes a hole that a naive implementation leaves open:
 *
 * 1. **The bytes decide the type, not the filename or the browser's content type.** The signature
 *    is read from the first bytes and the extension is derived from it. A `.png` that is actually
 *    HTML is rejected, and it cannot be written under a name a static server would treat as
 *    markup.
 * 2. **SVG is refused outright.** It is an XML document that can carry script, and it would be
 *    served as `image/svg+xml` from a route on the same origin as the application. There is no
 *    feature here that needs it — a camera produces JPEG.
 * 3. **The name is a fresh UUID plus the detected extension.** Nothing from the client reaches
 *    the filesystem path: no `../`, no `null` byte, no length limit, no collision by overwriting.
 * 4. **The size is bounded before the write.** A ten-megabyte "photo" is refused rather than
 *    truncated, because a truncated JPEG is a broken image and an error is easier to act on.
 *
 * ## Files are written before the row, and cleaned up if the row fails
 *
 * The route inserts the row after this module returns, because the row needs the id to build the
 * URL. That leaves a window where a file exists with no row — an orphan the user will never see.
 * The route deletes the file when the insert fails, and `deletePhoto` exists for the same reason.
 * The reverse order was rejected: an inserted row whose file is missing renders as a broken image
 * that the application cannot tell is unrecoverable.
 *
 * Server-only.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Result } from "../../domain/result.ts";

/**
 * The largest accepted upload, in bytes.
 *
 * Ten megabytes is far above what a phone camera produces for a single compressed frame, and
 * low enough that a mistaken video upload is refused instead of filling the disk.
 */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** One image format this application accepts, and the bytes that identify it. */
type ImageFormat = {
  readonly extension: string;
  readonly contentType: string;
  /**
   * Matches against the first bytes of the file.
   *
   * ASCII signatures are matched as strings through a small latin1 read; binary ones as byte
   * sequences. Longest-first matters: WEBP is a RIFF container, so a short RIFF check would also
   * accept every WAV file.
   */
  readonly matches: (bytes: Uint8Array) => boolean;
};

/**
 * The accepted formats, in the order they are tried.
 *
 * Deliberately a short list of raster formats a camera produces. Anything that can execute, or
 * that can be treated as a document, is absent by intent rather than by oversight.
 */
const FORMATS: readonly ImageFormat[] = [
  {
    extension: "png",
    contentType: "image/png",
    matches: (bytes) =>
      startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    extension: "jpg",
    contentType: "image/jpeg",
    matches: (bytes) =>
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff,
  },
  {
    extension: "webp",
    contentType: "image/webp",
    // "RIFF" .... "WEBP" — both halves are required, which is what rejects every other RIFF file.
    matches: (bytes) =>
      bytes.length >= 12 &&
      ascii(bytes, 0, 4) === "RIFF" &&
      ascii(bytes, 8, 12) === "WEBP",
  },
  {
    extension: "gif",
    contentType: "image/gif",
    matches: (bytes) =>
      bytes.length >= 6 &&
      (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a"),
  },
];

/** A file that has been validated and written, with everything a caller needs to store a row. */
export type StoredPhoto = {
  /** The server-generated filename. The only part of this the database keeps. */
  readonly filename: string;
  /** Absolute path, returned so a failed insert can clean up. Never persisted. */
  readonly path: string;
  readonly contentType: string;
  readonly bytes: number;
};

function startsWithBytes(
  bytes: Uint8Array,
  signature: readonly number[],
): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}

/** Reads `length` bytes at `offset` as latin1, or `""` if the buffer is too short. */
function ascii(bytes: Uint8Array, offset: number, end: number): string {
  if (bytes.length < end) {
    return "";
  }

  let text = "";

  for (let index = offset; index < end; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }

  return text;
}

/**
 * Resolves where uploads live.
 *
 * `data/uploads/` relative to the project root, for the same reason the database is: it is
 * already git-ignored as part of `data/`, and V1 has no deployment to configure. There is
 * deliberately no environment variable for it — one would be a path a tracked file has to name,
 * and AGENTS.md forbids putting machine-specific absolute paths in tracked files.
 */
function uploadsDirectory(): string {
  return join(process.cwd(), "data", "uploads");
}

/** The absolute path of one stored photo, given the filename from the database. */
export function photoPath(filename: string): string {
  return join(uploadsDirectory(), filename);
}

/**
 * Validates bytes and writes them, returning the stored file's facts.
 *
 * The two failure codes are the domain's, so the caller and the command surface report the same
 * wording the rest of the application uses: `invalid_photo` for bytes that are not an accepted
 * image, `photo_too_large` for a size over the limit.
 */
export async function savePhoto(
  bytes: Uint8Array,
): Promise<Result<StoredPhoto>> {
  if (bytes.length === 0) {
    return {
      ok: false,
      error: {
        code: "invalid_photo",
        message: "That file has no content, so it is not a photo.",
      },
    };
  }

  if (bytes.length > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      error: {
        code: "photo_too_large",
        message: "That photo is over the 10 MB limit. Try a smaller one.",
      },
    };
  }

  const format = FORMATS.find((candidate) => candidate.matches(bytes));

  if (format === undefined) {
    return {
      ok: false,
      error: {
        code: "invalid_photo",
        message:
          "That file is not a JPEG, PNG, WebP, or GIF image, so it was not stored.",
      },
    };
  }

  // The extension comes from the signature, so a misleading original name cannot influence it.
  const filename = `${randomUUID()}.${format.extension}`;
  const path = join(uploadsDirectory(), filename);

  // `data/` is already created for the database, but uploads is a subdirectory of it and mkdir is
  // recursive, so this is safe on a fresh clone with no database yet.
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { mode: 0o600 });

  return {
    ok: true,
    value: {
      filename,
      path,
      contentType: format.contentType,
      bytes: bytes.length,
    },
  };
}

/**
 * Removes a stored photo.
 *
 * Used to undo a write whose row could not be inserted. A missing file is not an error: the caller's
 * intent was "this file should not be there", and it is not there. Any other failure is returned,
 * because silently leaving a user's photo on disk after they were told it was not stored would be
 * the worse of the two.
 */
export async function deletePhoto(filename: string): Promise<Result<null>> {
  try {
    await unlink(photoPath(filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, value: null };
    }

    return {
      ok: false,
      error: {
        code: "invalid_photo",
        message:
          "The stored photo could not be removed. It is no longer reachable by any page.",
      },
    };
  }

  return { ok: true, value: null };
}

/**
 * Reads a stored photo's bytes.
 *
 * `null` for a file that is not there. The caller decides what that means; this module does not
 * invent an empty image, because a 200 response with zero bytes renders as a broken image.
 */
export async function readPhoto(filename: string): Promise<Uint8Array | null> {
  try {
    const contents = await readFile(photoPath(filename));

    return new Uint8Array(contents);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}
