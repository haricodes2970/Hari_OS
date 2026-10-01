/**
 * The Photo Diary: a timeline of the user's laundry photos, each with the words the user wrote
 * beside it.
 *
 * ## What this is, in the PRD's terms
 *
 * PRD 6.6, in full: "Digital diary: the laundry photo and daily notes form a visual timeline."
 * Both halves are here, and the second half is the one this module exists for.
 *
 * ## The rules, and where they live
 *
 * `src/domain/diary.ts` owns what a note may contain. This module owns three things the domain
 * deliberately does not know about, because each one is about state rather than about text:
 *
 * 1. **A note belongs to a real photo.** `writeNote` reads the row first and refuses when
 *    `photoUrl` is `null`. That check lives here rather than in a SQL `WHERE` clause on purpose: a
 *    clause would turn "this entry has no photo" into an apparently successful write that stored
 *    nothing, and the user would reload the diary to find their note gone with no explanation.
 *    A refusal the user can see is worth more than a write that silently does nothing.
 *
 * 2. **A note is read through its own query.** `listDiary` reads the whole history and nothing
 *    else. It is not a projection of `readHabits`, and the composition is one-directional: this
 *    module is not imported by `src/features/dashboard/view.ts`, so the Dashboard cannot receive a
 *    diary note even by accident. That is the privacy boundary, and like the private-log boundary
 *    it is structural — there is no code path to audit rather than a promise in a comment.
 *
 * 3. **Clearing is writing `null`.** There is no separate `clearNote`. `diaryNote("")` is `null`,
 *    so the same call adds and removes words, and the two cannot drift apart.
 *
 * ## No machine-written words, anywhere
 *
 * Nothing in this module inspects the image, calls a provider, or proposes text. A note's only
 * source is the person who typed it. A diary that summarised your own photographs back at you, or
 * guessed how the picture made you feel, would be inventing the part of a diary that is supposed
 * to be yours — so there is no caption column, no tag column, and no prompt in the codebase.
 *
 * Server-only: it reads SQLite through the composition root and nothing else.
 */
import "server-only";

import { byNewestFirst, diaryNote, hasDiaryNote } from "@/domain/diary";
import type { DiaryEntry } from "@/domain/diary";
import type { DomainError } from "@/domain/result";

import { getRepositories } from "../shared/command-runtime.ts";

/**
 * The outcome of writing a note, with the two failure kinds kept apart.
 *
 * A `Result` from `src/domain/result.ts` deliberately cannot carry a database failure — domain
 * code cannot cause one. This module writes to SQLite, so it needs three outcomes, and it defines
 * them here rather than borrowing the command executor's: a feature that imported
 * `src/commands/executor.ts` to name a failure would point the dependency the wrong way, and the
 * executor has no business owning the vocabulary a page needs.
 *
 * The split matters to callers. A `domain` failure is the user's own input and should be shown in
 * the first person; a `persistence` failure is the application failing to store something valid,
 * and saying "your note was too long" when the disk was full would send them off fixing the wrong
 * thing.
 */
export type DiaryWriteResult =
  | { readonly ok: true; readonly value: DiaryWrite }
  | { readonly ok: false; readonly kind: "domain"; readonly error: DomainError }
  | {
      readonly ok: false;
      readonly kind: "persistence";
      readonly message: string;
    };

/** What writing a note changed, so a caller can report it in the user's terms. */
export type DiaryWrite = {
  readonly entry: DiaryEntry;
  /** True when this write removed a note rather than adding or changing one. */
  readonly cleared: boolean;
};

/**
 * The whole diary, newest first.
 *
 * Unbounded on purpose. `readHabits`' timeline caps at a couple of dozen entries because the
 * Habits page needs a preview, but a diary truncated to a preview would be a diary that hides its
 * own past while looking complete. The ordering is total — same day, higher id first — so a day
 * that was re-photographed keeps its later entry at the top and the timeline cannot reshuffle
 * between two loads of the same data.
 */
export function readDiary(): readonly DiaryEntry[] {
  const repositories = getRepositories();

  // The `WHERE photo_url IS NOT NULL` in the query already guarantees the field is a string, but
  // the type cannot see into another module's SQL. The guard below is that mismatch made explicit
  // rather than papered over with a cast: if the query ever stops filtering, a photo-less row is
  // dropped here instead of reaching a page as an entry with no image.
  const entries: DiaryEntry[] = [];

  for (const row of repositories.habits.listDiary()) {
    if (row.photoUrl === null) {
      continue;
    }

    entries.push({
      id: row.id,
      date: row.date,
      photoUrl: row.photoUrl,
      note: row.photoNote,
    });
  }

  return byNewestFirst(entries);
}

/**
 * One entry, by id, or `null` when there is no such row.
 *
 * The id is the one in the photo's URL and the form's field name, so this is how a page that was
 * handed a stale link can tell whether the entry still exists instead of rendering a form that
 * would fail on submit.
 */
export function readDiaryEntry(id: number): DiaryEntry | null {
  const repositories = getRepositories();
  const row = repositories.habits.findById(id);

  if (row === null || row.photoUrl === null) {
    return null;
  }

  return {
    id: row.id,
    date: row.date,
    photoUrl: row.photoUrl,
    note: row.photoNote,
  };
}

/**
 * Adds, changes, or clears the note on one entry.
 *
 * `text` of `null`, `undefined`, or whitespace means "no note", and that is how a note is removed.
 * The validation runs before the write, so a rejected note leaves the stored one untouched: the
 * alternative is a form that clears a note because the replacement was too long.
 */
export function writeNote(id: number, text: string | null): DiaryWriteResult {
  const note = diaryNote(text);

  if (!note.ok) {
    return { ok: false, kind: "domain", error: note.error };
  }

  const repositories = getRepositories();
  const row = repositories.habits.findById(id);

  if (row === null || row.photoUrl === null) {
    return {
      ok: false,
      kind: "domain",
      // Its own code rather than a persistence failure: nothing failed to be stored, there was
      // simply no photo here for a note to belong to, and the user can fix that by uploading one.
      // Wording it as a database error would send them looking in the wrong place.
      error: {
        code: "unknown_photo",
        message:
          "That entry has no photo, so there is nothing to write a note on. Upload the photo first.",
        detail: { id },
      },
    };
  }

  let saved: ReturnType<typeof repositories.habits.saveDiaryNote>;

  try {
    saved = repositories.habits.saveDiaryNote(id, note.value);
  } catch (cause) {
    // The repository already turns SQL errors into a `persistence_failed` value rather than
    // throwing, so reaching here means the call itself blew up — a closed handle, a driver
    // failure above the statement. Either way it is infrastructure, and reported as such.
    return {
      ok: false,
      kind: "persistence",
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }

  if (!saved.ok) {
    return {
      ok: false,
      kind: "persistence",
      message: saved.error.message,
    };
  }

  return {
    ok: true,
    value: {
      entry: {
        id: saved.value.id,
        date: saved.value.date,
        // Non-null because the row was read with a photo a moment ago, and this function does not
        // return a result that contradicts the row it just checked.
        photoUrl: saved.value.photoUrl ?? "",
        note: saved.value.photoNote,
      },
      cleared: !hasDiaryNote(saved.value.photoNote),
    },
  };
}

/**
 * Whether any entry carries a note, for the page's own summary line.
 *
 * A count of the user's own words is the kind of thing that becomes a score, so it is a plain
 * sentence built here rather than a number rendered as a badge: "3 entries have a note" says what
 * it means and cannot be read as progress.
 */
export function diarySummary(entries: readonly DiaryEntry[]): string {
  const noted = entries.filter((entry) => hasDiaryNote(entry.note)).length;

  if (entries.length === 0) {
    return "No photos yet. The diary fills itself as laundry days are recorded.";
  }

  if (noted === 0) {
    return `${entries.length} ${entries.length === 1 ? "entry" : "entries"}, none with a note yet.`;
  }

  return `${entries.length} ${entries.length === 1 ? "entry" : "entries"}, ${noted} with a note.`;
}
