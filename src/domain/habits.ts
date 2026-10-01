/**
 * The habit log: neutral daily habits, manual screen time, and the private log.
 *
 * ## What is a habit here, and what is not
 *
 * PRD section 6.6 names three daily habits — cooking, dishes, and laundry — plus a manually
 * entered screen-time estimate, plus a private log for doom-scrolling and masturbation. This
 * module implements exactly those and nothing else. There is no generic habit engine, no
 * scheduler, no recurrence rule, and no notion of a habit being "due", because the PRD asks for
 * a target frequency of twice a week for laundry and for nothing else.
 *
 * ## Neutral habits may carry a streak. Private behaviour may not.
 *
 * This is the PRD's line and this module keeps it exactly: `habitStreak` exists, is applied only
 * to `cooking`, `dishes`, and `laundry`, and is never called with a `private_log` row — a private
 * entry is not a `HabitLog` at all, is written through a different repository, and is read by a
 * different feature module. There is no code path in this application from a private entry to a
 * count, a bar, or a word like "streak".
 *
 * The streak counts **consecutive days with the habit recorded as done**, and nothing else. It
 * is not compared to a target, and a missed day does not produce a message about falling behind.
 *
 * ## Laundry needs proof
 *
 * The PRD states that laundry "requires a photo upload as proof of completion; the app does not
 * accept a text claim alone". So `recordHabit` refuses `laundry` + done without a photo, which
 * means the text path cannot fake it. The refusal is here rather than in the route so that no
 * caller can skip it.
 *
 * ## Screen time is a number the user typed
 *
 * `screen_time` is a measurement, not a thing to be done, so it requires `minutes` and refuses
 * `done: false` — "I did not spend screen time" is not a fact the schema can hold and not one
 * the PRD asks for. Nothing here measures, estimates, or infers it: no platform API, no device
 * permission, no automatic capture.
 *
 * Pure. No clock, no database, no filesystem, no provider.
 */
import { fail, ok, type Result } from "./result.ts";

import type { CalendarDate } from "./calendar.ts";

/**
 * The PRD's three daily habits, in the schema's own order.
 *
 * `cooking` is included because the PRD's section 6.6 lists it first, even though the Dashboard
 * shows laundry and dishes: omitting it would mean a habit row could not be displayed at all.
 *
 * These are the three a **streak** applies to. Screen time is deliberately not one of them.
 */
export const HABIT_TYPES = ["cooking", "dishes", "laundry"] as const;

export type HabitType = (typeof HABIT_TYPES)[number];

export function isHabitType(value: string): value is HabitType {
  return (HABIT_TYPES as readonly string[]).includes(value);
}

/** The manually entered screen-time type, added by migration 002. */
export const SCREEN_TIME = "screen_time";

/**
 * Everything `habit_log.type` can hold, which is what this application will speak about.
 *
 * Mirrors the schema's `CHECK`. `scripts/dashboard-test.mjs` asserts the two agree, so a schema
 * change that adds a type without adding a domain type fails a test rather than producing a
 * habit the application cannot explain.
 */
export const LOGGABLE_HABIT_TYPES = [...HABIT_TYPES, SCREEN_TIME] as const;

export type LoggableHabitType = (typeof LOGGABLE_HABIT_TYPES)[number];

export function isLoggableHabitType(value: string): value is LoggableHabitType {
  return (LOGGABLE_HABIT_TYPES as readonly string[]).includes(value);
}

/**
 * The PRD's laundry target: twice a week.
 *
 * Counted over the trailing seven days rather than a calendar week, so the number answers "how
 * often have I done this lately" instead of resetting on a Sunday and reporting zero.
 */
export const LAUNDRY_TARGET_PER_WEEK = 2;

/** The longest screen-time entry: 24 hours of screen time. */
export const MAX_SCREEN_TIME_MINUTES = 24 * 60;

/** The longest a private note may be. Long enough to be useful, short enough to be read. */
export const MAX_PRIVATE_NOTE = 500;

/** One `habit_log` row. */
export type HabitLog = {
  readonly id: number;
  readonly date: CalendarDate;
  readonly type: LoggableHabitType;
  readonly done: boolean;
  /**
   * The photo's **application URL** — `/api/photos/<id>` — or `null`.
   *
   * Never a filesystem path. The file lives under `data/uploads/` with a server-generated name,
   * and that name is not exposed to the database or to the browser; the database stores the route
   * that serves it, so moving the upload directory cannot break stored rows and a stored row
   * cannot leak a path.
   */
  readonly photoUrl: string | null;
  /**
   * The user's own words about the photo, or `null` when the entry has no note.
   *
   * Phase 8. It lives on the row rather than in a table of its own because a diary entry *is*
   * the photo, and two tables holding one picture's location would be two answers to the same
   * question (ADR-056). `src/domain/diary.ts` owns the rules about the text; this row only says
   * where the text is kept.
   */
  readonly photoNote: string | null;
  /** A manually entered screen-time estimate, or `null`. */
  readonly minutes: number | null;
};

/**
 * What one recorded habit changed.
 *
 * `photoAttached` is reported so the caller can write a message that says the photo was stored
 * with it, rather than a generic confirmation that hides which of the two things happened.
 */
/**
 * What a command result may say about the row it changed.
 *
 * Phase 9. `POST /api/commands` answers a JSON caller with the result of the execution, and the
 * execution re-reads the row it wrote — a full `HabitLog`, which since ADR-056 carries
 * `photoNote`. That put a diary note in the body of a command response: not rendered anywhere,
 * but reachable from an endpoint that is not the diary, which contradicts the rule that a note is
 * read in exactly one place. The projection is the fix, and it lives here rather than in the
 * executor because what may leave the domain in a response body is a domain decision.
 *
 * `photoUrl` is kept: it is an application URL, not a filesystem path, and a caller needs it to
 * address the entry. `photoNote` is the one field deliberately absent.
 */
export type HabitCommandView = {
  readonly id: number;
  readonly date: CalendarDate;
  readonly type: LoggableHabitType;
  readonly done: boolean;
  readonly photoUrl: string | null;
  /** Whether a photo is attached, so a confirmation can say which of the two things happened. */
  readonly photoAttached: boolean;
  readonly minutes: number | null;
};

/**
 * Projects a row onto what a command result may carry.
 *
 * Explicit field by field, so a column added to `habit_log` later is not automatically published
 * in an API response. A test asserts the note is absent, which is the assertion that matters.
 */
export function habitCommandView(log: HabitLog): HabitCommandView {
  return {
    id: log.id,
    date: log.date,
    type: log.type,
    done: log.done,
    photoUrl: log.photoUrl,
    photoAttached: log.photoUrl !== null,
    minutes: log.minutes,
  };
}

export type HabitChange = {
  /**
   * The row, as a command result may report it.
   *
   * `HabitCommandView` rather than `HabitLog`, added in Phase 9: a change result is a response
   * body, and a response body is not the place the diary note may be read from.
   */
  readonly habit: HabitCommandView;
  readonly photoAttached: boolean;
};

/** One private entry, matching the `private_log` row. */
export type PrivateLogEntry = {
  readonly id: number;
  readonly date: CalendarDate;
  readonly type: PrivateType;
  /** `null` when the user did not write one. The PRD calls the note optional. */
  readonly note: string | null;
};

/**
 * The two private behaviours the PRD names, in its own order.
 *
 * The schema's `CHECK` is the authority. Neither value is ever shown as a count, a streak, a
 * score, or a bar, and the words used to describe one are neutral on purpose.
 */
export const PRIVATE_TYPES = ["doom_scrolling", "masturbation"] as const;

export type PrivateType = (typeof PRIVATE_TYPES)[number];

export function isPrivateType(value: string): value is PrivateType {
  return (PRIVATE_TYPES as readonly string[]).includes(value);
}

/** Reads an existing habit row for a day, or nothing. */
export function habitFor(
  entries: readonly HabitLog[],
  type: LoggableHabitType,
): HabitLog | null {
  return entries.find((entry) => entry.type === type) ?? null;
}

/**
 * Records what the user said about one habit for one day.
 *
 * ## The rules, and why each one is here
 *
 * - **Laundry cannot be recorded as done without a photo.** PRD 6.6: "the app does not accept a
 *   text claim alone". `hasPhotoProof` is passed by the caller, which is the route that actually
 *   wrote the photo — so this function cannot be asked to assume a proof exists.
 * - **Screen time needs minutes and cannot be "not done".** It is a measurement the user typed.
 *   `done` is stored as `1` because the entry asserts the measurement happened.
 * - **The other three take no minutes.** A habit that was done does not have a duration in
 *   `habit_log`, and accepting one would store a number no rule reads.
 * - **One row per type per day.** The second entry for a day replaces the first, because a day
 *   has one cooking and one laundry, and two rows would make "did I cook today?" ambiguous.
 *
 * `id`, `photoUrl`, and `photoNote` come from the repository, the photo route, and the user
 * respectively; none of them is something this function invents. A recorded habit is written with
 * no photo and no note, because a photo is attached by the upload route and a note by the diary —
 * the two are separate operations that happen to land on the same row.
 */
export function recordHabit(input: {
  readonly date: CalendarDate;
  readonly type: LoggableHabitType;
  readonly done: boolean;
  readonly minutes?: number | null;
  readonly hasPhotoProof?: boolean;
}): Result<HabitChange> {
  const stated = input.minutes ?? null;

  if (input.type === SCREEN_TIME) {
    if (stated === null) {
      return fail(
        "invalid_habit_minutes",
        "Screen time is entered by hand, so it needs the number of minutes.",
        { type: input.type },
      );
    }

    if (!Number.isInteger(stated) || stated < 0) {
      return fail(
        "invalid_habit_minutes",
        "Screen time has to be a whole number of minutes, zero or more.",
        { minutes: stated },
      );
    }

    if (stated > MAX_SCREEN_TIME_MINUTES) {
      return fail(
        "invalid_habit_minutes",
        `Screen time cannot be more than ${MAX_SCREEN_TIME_MINUTES} minutes in a day.`,
        { minutes: stated, limit: MAX_SCREEN_TIME_MINUTES },
      );
    }

    return ok({
      habit: {
        id: 0,
        date: input.date,
        type: SCREEN_TIME,
        done: true,
        photoUrl: null,
        photoAttached: false,
        minutes: stated,
      },
      photoAttached: false,
    });
  }

  if (stated !== null) {
    return fail(
      "invalid_habit_minutes",
      `${input.type} is recorded as done or not done, and does not take a number of minutes.`,
      { type: input.type, minutes: stated },
    );
  }

  if (input.type === "laundry" && input.done && input.hasPhotoProof !== true) {
    return fail(
      "photo_required",
      "Laundry is recorded with a photo, because a text claim alone is not proof. Upload one on the Habits page.",
      { type: input.type, date: input.date },
    );
  }

  return ok({
    habit: {
      id: 0,
      date: input.date,
      type: input.type,
      done: input.done,
      photoUrl: null,
      photoAttached: false,
      minutes: null,
    },
    photoAttached: false,
  });
}

/**
 * Consecutive days, ending today, with this habit recorded as done.
 *
 * Today being absent does not break the streak: the day is not over, so the count reports the
 * days up to and including the last one that has an entry. A day recorded as **not done** does
 * end it, because that is the user saying the day happened and the habit did not.
 *
 * `entries` may contain any dates; only those on or before `today` are counted, and a habit
 * logged for a future day is not something to reward in advance.
 */
/**
 * The smallest row shape the habit rules actually read: a day, a type, and whether it was done.
 *
 * `habitStreak` and `laundryProgress` look at nothing else — not the photo, not the note, not the
 * minutes — so asking for a whole `HabitLog` would have them depend on fields they do not use, and
 * would have made the read model carry a diary note purely to satisfy them. `HabitLog` satisfies
 * this structurally, so a caller with full rows still passes rows.
 */
export type HabitRecord = {
  readonly date: CalendarDate;
  readonly type: LoggableHabitType;
  readonly done: boolean;
};

export function habitStreak(
  entries: readonly HabitRecord[],
  type: HabitType,
  today: CalendarDate,
): { readonly days: number; readonly lastRecorded: CalendarDate | null } {
  // One entry per type per day, so a Map keyed by date is the whole picture. Rows dated after
  // `today` are ignored rather than counted: a habit logged in advance is not a day kept.
  const byDate = new Map<string, boolean>();

  for (const entry of entries) {
    if (entry.type === type && entry.date <= today) {
      byDate.set(entry.date, entry.done);
    }
  }

  const recorded = [...byDate.keys()].sort();
  const lastRecorded = recorded[recorded.length - 1];

  if (lastRecorded === undefined) {
    return { days: 0, lastRecorded: null };
  }

  // Start from today and walk backwards, with one adjustment: **today itself does not break a
  // streak**, because the day is not over. So the walk skips exactly one day — today — and no
  // more. Skipping to the most recent recorded day instead would read three unrecorded days as
  // a streak of three, which is the opposite of what the number means.
  //
  // Every day after that point is judged by what is stored. A day recorded as **not done** stops
  // the walk, because that is the user saying the day happened and the habit did not. A day with
  // no row also stops it: two unrecorded days is not a run, and calling that a streak would be a
  // claim the data does not support.
  let cursor = byDate.has(today) ? today : previousDay(today);
  let days = 0;

  while (byDate.get(cursor) === true && days < MAX_STREAK_SCAN) {
    days += 1;
    cursor = previousDay(cursor);
  }

  return { days, lastRecorded };
}

/**
 * The day before `date`.
 *
 * `addDays` returns a `Result` because a caller may hand it a string that is not a date. Every
 * date reaching this function came out of `parseCalendarDate`, from storage written by this
 * application, or from the server clock, so the failure cannot occur and unwrapping it would add
 * a branch that is dead by construction. `src/domain/sleep.ts` does the same for the same reason.
 */
function previousDay(date: CalendarDate): CalendarDate {
  const [year, month, day] = date.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day) - 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * How far the scan will go before it gives up.
 *
 * Four years. Longer than any streak a person keeps, short enough to be obviously finite.
 */
export const MAX_STREAK_SCAN = 1461;

/**
 * Laundry against the PRD's target of twice a week.
 *
 * `entries` is every laundry row within the trailing seven days, newest or oldest order — the
 * caller passes what it read. `doneThisWeek` counts distinct **days** that were recorded as
 * done, not rows: two uploads on one day are one day of laundry, and counting rows would make a
 * single good day look like two.
 */
export function laundryProgress(entries: readonly HabitRecord[]): {
  readonly doneThisWeek: number;
  readonly target: number;
} {
  const days = new Set(
    entries
      .filter((entry) => entry.type === "laundry" && entry.done)
      .map((entry) => entry.date),
  );

  return { doneThisWeek: days.size, target: LAUNDRY_TARGET_PER_WEEK };
}

/**
 * The private log entry for a day.
 *
 * A fact and nothing more. There is no count, no comparison, no total, and no function anywhere
 * that takes these entries and returns a number — which is the structural reason a private entry
 * cannot become a streak.
 *
 * The note is optional because the PRD says "a yes/no plus an optional note". It is trimmed, and
 * refused if it contains control characters: a note the user cannot read back is not a note.
 */
export function recordPrivateEntry(input: {
  readonly date: CalendarDate;
  readonly type: PrivateType;
  readonly note?: string | null;
}): Result<PrivateLogEntry> {
  const note = input.note ?? null;

  if (note !== null) {
    if (/[\u0000-\u001F\u007F]/u.test(note.replace(/[\t\n\r]/gu, " "))) {
      return fail(
        "invalid_private_note",
        "The note contains characters the log cannot store.",
        {},
      );
    }

    const trimmed = note.trim();

    if (trimmed.length > MAX_PRIVATE_NOTE) {
      return fail(
        "invalid_private_note",
        `A note can be at most ${MAX_PRIVATE_NOTE} characters.`,
        { length: trimmed.length, limit: MAX_PRIVATE_NOTE },
      );
    }

    return ok({
      id: 0,
      date: input.date,
      type: input.type,
      note: trimmed === "" ? null : trimmed,
    });
  }

  return ok({ id: 0, date: input.date, type: input.type, note: null });
}

/**
 * How a private type is written when a person reads it.
 *
 * Wording only. It says what the entry is and nothing about how often it happens, how good it
 * is, or what it means — there is no function that turns a `PrivateLogEntry` into a number.
 */
export function privateTypeLabel(type: PrivateType): string {
  return type === "doom_scrolling" ? "Doom scrolling" : "Masturbation";
}
