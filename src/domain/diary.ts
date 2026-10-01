/**
 * Diary notes: the user's own words about a photo, and the rules those words have to satisfy.
 *
 * ## What the PRD asked for, and what it did not
 *
 * PRD 6.6, one line: "Digital diary: the laundry photo and daily notes form a visual timeline."
 * The photo half shipped in Phase 7. The notes are this file's subject.
 *
 * What that sentence does **not** say is as important as what it does. It does not ask for
 * captions, alt-text generation, mood detection, tagging, summaries, or any of the things a
 * machine could produce from a picture. So this module has exactly one job: take text the user
 * wrote, check it, and hand back either a storable note or a refusal. There is no prompt here,
 * no provider call, and no image inspection anywhere in this file — a note's source of truth is
 * the person who typed it, and an application that guesses at their feelings about their own
 * laundry is not being helpful.
 *
 * ## Why a note is trimmed, limited, and stripped of control characters
 *
 * Three rules, each closing a specific hole rather than expressing caution in general:
 *
 * - **Trimmed**, so `"  shelves are clean  "` and `"shelves are clean"` are one note rather than
 *   two, and so an all-whitespace note is the same as no note at all.
 * - **Bounded at 500 characters.** A diary note is a sentence or two; the limit is what stops a
 *   pasted document from becoming a row. It matches `private_log`'s limit deliberately — the two
 *   are different features that happen to want the same bound, and a shared constant would have
 *   coupled them for no reason.
 * - **Control characters are refused**, except tab, newline, and carriage return, which are
 *   replaced with a space. A note the user cannot read back is not a note, and a `NUL` in a text
 *   column is a corruption risk for anything that later reads the row.
 *
 * ## Why an empty note is not an error
 *
 * `diaryNote("")` returns `null`, and `null` means "this entry has no note". That is the whole
 * correction story for clearing a note: the same call that adds words removes them. A separate
 * `clearNote` would be a second spelling of one intention, and two spellings of "no note" are two
 * states that can disagree.
 *
 * ## The invariant this file helps enforce
 *
 * "If a note exists, it belongs to a real persisted photo entry." The storage half of that lives
 * in `src/features/habits/diary.ts`, which refuses to write a note onto a row that has no photo.
 * What this module guarantees is the other half: whatever comes back from `diaryNote` is a string
 * that is safe to store, display as text, and read back unchanged.
 *
 * Pure: no SQLite, no filesystem, no framework, no clock, no randomness. Everything here is a
 * function of its input.
 */
import type { Result } from "./result.ts";
import { fail, ok } from "./result.ts";

/**
 * The longest note a diary entry can hold.
 *
 * 500 characters, chosen because it is enough for the paragraph a person actually writes beside a
 * photo and short enough that no page has to think about a long one. `private_log` uses the same
 * number for the same reason, independently.
 */
export const MAX_DIARY_NOTE = 500;

/**
 * Line breaks and tabs, replaced with a space.
 *
 * These three are ordinary in written text, so they are normalised rather than refused. Kept as
 * a literal here rather than a shared constant so this module reads on its own; the only other
 * module that needs the same idea is `private_log`, whose rule is its own.
 */
const REPLACED_CHARACTERS = /[\t\n\r]/gu;

/**
 * Any control character left after that replacement.
 *
 * No `g` flag, and that is deliberate: a module-level `/g` pattern is stateful across calls, so
 * `test` on it inspects from wherever the previous call left off and returns a wrong answer for
 * the second caller. A flagless pattern has no `lastIndex` to get wrong.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;

/**
 * Checks a note the user wrote, and returns what should be stored.
 *
 * `null` in means "no note given", which is valid and means the same thing as an empty string: the
 * entry simply has no note. That is what lets an upload form carry an optional note without the
 * application having to treat its absence as a special case.
 *
 * The order of the two checks is deliberate. Line breaks are normalised **first**, so a note that
 * is only over the limit after the replacement is judged on what would actually be stored, and the
 * control-character refusal — when it comes — is about a character the user can actually see.
 */
export function diaryNote(
  text: string | null | undefined,
): Result<string | null> {
  if (text === null || text === undefined) {
    return ok(null);
  }

  const cleaned = text.replace(REPLACED_CHARACTERS, " ").trim();

  if (CONTROL_CHARACTERS.test(cleaned)) {
    return fail(
      "invalid_diary_note",
      "A diary note cannot contain that character. Use letters, numbers, and ordinary punctuation.",
      {},
    );
  }

  if (cleaned === "") {
    return ok(null);
  }

  if (cleaned.length > MAX_DIARY_NOTE) {
    return fail(
      "invalid_diary_note",
      `A diary note can be at most ${MAX_DIARY_NOTE} characters.`,
      { length: cleaned.length, limit: MAX_DIARY_NOTE },
    );
  }

  return ok(cleaned);
}

/**
 * Whether an entry carries a note.
 *
 * A predicate rather than a check for truthiness, because an empty string would be a note the
 * validation above can never produce, and a reader should not have to know that.
 */
export function hasDiaryNote(note: string | null): boolean {
  return note !== null && note !== "";
}

/**
 * One diary entry, as a page needs it: the day's photo, and the words the user wrote about it.
 *
 * A separate type from `HabitLog` on purpose. The habit row knows about a day, a type, and whether
 * it was done; the diary entry knows about a picture and a sentence. Keeping them apart means a
 * caller cannot read a note where it did not expect one, and the Dashboard — which composes the
 * habit read model — cannot receive a note at all.
 */
export type DiaryEntry = {
  /** The `habit_log` row id, which is also the photo's id in its URL. */
  readonly id: number;
  readonly date: string;
  /** The application's URL for the picture. Never a filesystem path. */
  readonly photoUrl: string;
  /** The user's words, or `null` when the entry has no note. */
  readonly note: string | null;
};

/**
 * Orders diary entries newest first, with a total order.
 *
 * `ORDER BY date DESC, id DESC` already gives that, and this function exists for the second
 * clause: when two entries share a day — which happens whenever a day is re-photographed — the
 * higher id is the later one, because ids increase. A sort that compared only dates would leave
 * the order of those two entries up to the renderer, which is how a timeline ends up shuffling
 * itself between reloads.
 */
export function byNewestFirst(
  entries: readonly DiaryEntry[],
): readonly DiaryEntry[] {
  return [...entries].sort((left, right) =>
    left.date === right.date
      ? right.id - left.id
      : right.date.localeCompare(left.date),
  );
}
