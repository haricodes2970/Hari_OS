/**
 * Bedtime, sleep, wake, and naps: the times the user says, and the arithmetic on them.
 *
 * ## Two kinds of time, kept apart
 *
 * The application stores an execution timestamp for every change it makes, and that is not
 * what this module is about. "I went to bed at 11" is a **stated fact** about the user's
 * night, and it has to stay distinguishable from "the server received this at 23:04:11Z".
 * Conflating them would mean a check-in written at 1 AM silently books a wake time an hour
 * before bedtime.
 *
 * So a stated time is a wall-clock `HH:MM` on a 24-hour clock, stored as text, with no date
 * and no zone attached. The date lives on the row — `sleep_log.date` is the day the night
 * began, `nap_log.date` is the day the nap was taken — and the application resolves it from
 * the server clock when the record is written. Nothing here reads a clock, and nothing here
 * invents a timezone: a person who says "11" means 11 wherever they are, and this
 * application has no business guessing which zone that is.
 *
 * ## Durations are computed here and nowhere else
 *
 * A night wraps past midnight — bedtime 23:30, wake 06:45 is 7h15m, not a negative number —
 * so the subtraction has to know about the wrap, and that knowledge lives in exactly one
 * function. A UI that did the same subtraction would be a second implementation, and the
 * two would disagree on precisely the nights that matter most.
 *
 * ## Warnings inform; they never judge
 *
 * The PRD asks for a soft warning when a nap runs long or starts after 3 PM. Both are
 * properties of the times, both are stated as information, and neither changes whether the
 * nap is stored. A warning is a fact about a clock, not a verdict about a person, and this
 * module has no vocabulary for one.
 *
 * Pure. No clock, no database, no filesystem.
 */
import type { CalendarDate } from "./calendar.ts";
import { fail, ok, type Result } from "./result.ts";

/** A stated wall-clock time: 24-hour `HH:MM`. Deliberately not a date and not an instant. */
export type ClockTime = string;

/** Exactly two digits, 00–23 for hours and 00–59 for minutes. */
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** The PRD's nap warning thresholds, stated once. */
export const NAP_LONG_MINUTES = 30;
export const NAP_LATE_START: ClockTime = "15:00";

/**
 * The window the PRD calls the stable wake range: "currently stable at about 6:15 to 7:30
 * AM and is treated as the anchor".
 *
 * Used only by the consistency streak, and inclusive at both ends, because 6:15 and 7:30 are
 * the two times the user reported and both are inside the range they described.
 */
export const WAKE_WINDOW_START: ClockTime = "06:15";
export const WAKE_WINDOW_END: ClockTime = "07:30";

/** The three times one night records, as the `sleep_log` columns store them. */
export type SleepField = "bedtime" | "sleep_time" | "wake_time";

export const SLEEP_FIELDS: readonly SleepField[] = [
  "bedtime",
  "sleep_time",
  "wake_time",
];

export function isSleepField(value: string): value is SleepField {
  return (SLEEP_FIELDS as readonly string[]).includes(value);
}

/** One night, matching the `sleep_log` row. */
export type SleepLog = {
  readonly date: CalendarDate;
  /** When the user got into bed. `null` means not stated, not "no". */
  readonly bedtime: ClockTime | null;
  /** When the user fell asleep. `null` means not stated. */
  readonly sleepTime: ClockTime | null;
  /** When the user woke. `null` means not stated. */
  readonly wakeTime: ClockTime | null;
  /**
   * The night check-in's phone confirmation.
   *
   * `false` covers both "said the phone stayed in the bedroom" and "never asked", because
   * the column cannot tell them apart. Callers therefore render only `true` as a
   * confirmation and never render `false` as an accusation.
   */
  readonly phoneOutside: boolean;
};

/** One nap, matching the `nap_log` row. */
export type NapLog = {
  readonly id: number;
  readonly date: CalendarDate;
  readonly start: ClockTime;
  /** `null` while the nap is still running. */
  readonly end: ClockTime | null;
};

/**
 * Parses a stated time.
 *
 * Strict on purpose. `9:5`, `23:60`, `9pm`, and `""` are all refused, because a nap that
 * "starts at 9pm" has an ambiguous wall-clock reading and picking one for the user would be
 * a fabricated time. The failure names the received text, which is safe to show.
 */
export function parseClockTime(value: string): Result<ClockTime> {
  return CLOCK_TIME.test(value)
    ? ok(value)
    : fail("invalid_time", `"${value}" is not a time in 24-hour HH:MM form.`, {
        received: value,
      });
}

/** Minutes since midnight, the representation every duration is computed in. */
export function minutesSinceMidnight(time: ClockTime): number {
  const parsed = parseClockTime(time);

  if (!parsed.ok) {
    // Only reachable from an untyped caller. A stored time is validated on the way in, and
    // refusing here would need a Result this function's callers could not act on.
    throw new Error(`Not a clock time: ${time}`);
  }

  const [hours, minutes] = time.split(":").map(Number);

  return hours * MINUTES_PER_HOUR + minutes;
}

/** Minutes since midnight back to `HH:MM`. */
export function formatClockTime(minutes: number): ClockTime {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remainder = minutes % MINUTES_PER_HOUR;

  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

/**
 * Minutes from `from` to `to`, wrapping past midnight.
 *
 * The wrap is what makes a night work: 23:30 to 06:45 is 7h15m. The two equal times are the
 * one case refused, because they are either a zero-length night or a whole day of sleep and
 * the application cannot know which, so it asks rather than picking.
 */
export function overnightMinutes(
  from: ClockTime,
  to: ClockTime,
): Result<number> {
  const start = minutesSinceMidnight(from);
  const end = minutesSinceMidnight(to);

  if (start === end) {
    return fail(
      "invalid_time_order",
      "Those two times are the same, which would be a 24-hour night. Check the values.",
      { from, to },
    );
  }

  return ok(end > start ? end - start : end + MINUTES_PER_DAY - start);
}

/** How long one night lasted, in whole minutes. */
export function nightMinutes(night: SleepLog): Result<number> {
  if (night.bedtime === null || night.wakeTime === null) {
    return fail(
      "invalid_time",
      "The night has no bedtime or no wake time yet, so there is no length to report.",
      { date: night.date },
    );
  }

  return overnightMinutes(night.bedtime, night.wakeTime);
}

/** How long the user was actually asleep, in whole minutes. */
export function asleepMinutes(night: SleepLog): Result<number> {
  if (night.sleepTime === null || night.wakeTime === null) {
    return fail(
      "invalid_time",
      "The night has no sleep time or no wake time yet, so there is nothing to add up.",
      { date: night.date },
    );
  }

  return overnightMinutes(night.sleepTime, night.wakeTime);
}

/** How long a nap lasted, in whole minutes. `null` while the nap is still running. */
export function napMinutes(nap: NapLog): Result<number> | null {
  if (nap.end === null) {
    return null;
  }

  const start = minutesSinceMidnight(nap.start);
  const end = minutesSinceMidnight(nap.end);

  if (end <= start) {
    return fail(
      "invalid_time_order",
      `A nap that started at ${nap.start} cannot end at ${nap.end}: that is before it started.`,
      { start: nap.start, end: nap.end },
    );
  }

  return ok(end - start);
}

/** What a nap produced, once its times are known. */
export type NapSummary = {
  readonly id: number;
  readonly date: CalendarDate;
  readonly start: ClockTime;
  readonly end: ClockTime | null;
  /** `null` while the nap is running, or if its stated times are impossible. */
  readonly minutes: number | null;
  readonly warnings: readonly NapWarning[];
};

export type NapWarningCode = "nap_too_long" | "nap_started_late";

export type NapWarning = {
  readonly code: NapWarningCode;
  /** Factual and about the clock. No score, no judgement, no advice about the person. */
  readonly message: string;
};

/**
 * A nap with its duration and any soft warnings.
 *
 * The thresholds are the PRD's and the boundaries are exact: a nap of **more than** 30
 * minutes warns, and one of exactly 30 does not; a nap starting at **after** 15:00 warns,
 * and one starting at 15:00 does not. A rule that fired on the boundary would tell the user
 * something they did not do.
 */
export function summariseNap(nap: NapLog): NapSummary {
  const duration = napMinutes(nap);
  const minutes = duration !== null && duration.ok ? duration.value : null;
  const warnings: NapWarning[] = [];

  if (minutes !== null && minutes > NAP_LONG_MINUTES) {
    warnings.push({
      code: "nap_too_long",
      message: `That nap ran ${formatDuration(minutes)}, over the ${NAP_LONG_MINUTES} minute mark.`,
    });
  }

  if (minutesSinceMidnight(nap.start) > minutesSinceMidnight(NAP_LATE_START)) {
    warnings.push({
      code: "nap_started_late",
      message: `That nap started at ${nap.start}, after the ${NAP_LATE_START} mark.`,
    });
  }

  return {
    id: nap.id,
    date: nap.date,
    start: nap.start,
    end: nap.end,
    minutes,
    warnings,
  };
}

/**
 * A duration in whole minutes, written the way a person would say it.
 *
 * Only ever applied to a real duration, so the hours part is at most 23 and the minutes part
 * is always two digits — no plural to get wrong, and no rounding.
 */
export function formatDuration(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0) {
    return `${String(minutes)} minutes`;
  }

  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;

  if (hours === 0) {
    return `${rest} min`;
  }

  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * The one neutral sleep metric this build can state honestly.
 *
 * The PRD asks for a "sleep consistency streak" without saying what consistency is. The
 * smallest defensible reading uses the fact the PRD itself supplies — the wake time is
 * stable at about 6:15 to 7:30 AM and is the anchor — and counts **consecutive calendar days
 * with a recorded wake time inside that window**, walking back from the most recent day that
 * has one.
 *
 * What it deliberately is not:
 *
 * - **Not a score.** There is no number out of ten, no grade, and nothing to compare against
 *   anyone else. It counts days the user logged, nothing more.
 * - **Not a quality judgement.** A wake time is a time. It says nothing about how the night
 *   went, and this module does not infer that it does.
 * - **Not medical.** No threshold here is a health guideline, because the PRD supplied none
 *   and inventing one would be a claim this application has no basis to make.
 * - **Not broken by absence in a punishing way.** A day with no wake time ends the streak
 *   rather than counting against it, and the wording says "not recorded", not "failed".
 *
 * A day with no wake time inside the window also ends it. That is a statement about the
 * record, and the caller renders it as such.
 */
export function wakeConsistencyStreak(nights: readonly SleepLog[]): {
  readonly days: number;
  readonly lastRecorded: CalendarDate | null;
} {
  const withWake = nights
    .filter((night) => night.wakeTime !== null)
    .sort((left, right) => right.date.localeCompare(left.date));

  const mostRecent = withWake[0];

  if (mostRecent === undefined) {
    return { days: 0, lastRecorded: null };
  }

  let days = 0;
  let expected = mostRecent.date;

  for (const night of withWake) {
    if (night.date !== expected || night.wakeTime === null) {
      break;
    }

    if (!isInsideWakeWindow(night.wakeTime)) {
      break;
    }

    days += 1;
    expected = previousCalendarDay(expected);
  }

  return { days, lastRecorded: mostRecent.date };
}

/** Whether a stated wake time is inside the PRD's stated stable range. */
export function isInsideWakeWindow(time: ClockTime): boolean {
  const minutes = minutesSinceMidnight(time);

  return (
    minutes >= minutesSinceMidnight(WAKE_WINDOW_START) &&
    minutes <= minutesSinceMidnight(WAKE_WINDOW_END)
  );
}

function previousCalendarDay(date: CalendarDate): CalendarDate {
  const [year, month, day] = date.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day) - 86_400_000);

  return previous.toISOString().slice(0, 10);
}

/**
 * The three changes this module can authorise.
 *
 * Each is a complete record rather than a patch, because the executor persists the whole row
 * and a patch would leave the executor guessing which column it was given.
 *
 * `field` names which part of the night changed. It is part of the change rather than
 * something the caller remembers, because a confirmation that says "wake time" about a
 * bedtime sentence is worse than no confirmation at all.
 */
export type SleepChange =
  | {
      readonly kind: "night";
      readonly field: SleepField | "phone_outside";
      readonly night: SleepLog;
      /**
       * The parsed time for a `SleepField` change, and `null` for a phone confirmation.
       *
       * Carried deliberately, so the executor stores what the domain parsed rather than
       * re-deriving it from the night by reading the right property back out. Deriving it is
       * how a `wake_time` write once ended up storing the empty string: the column name and the
       * row's property name differ by an underscore, and a lookup that guessed wrong found
       * `undefined`. The domain already knows the answer; this hands it over.
       */
      readonly time: ClockTime | null;
    }
  | { readonly kind: "nap"; readonly nap: NapLog };

/** The row property each column writes, so the two spellings are stated once. */
const NIGHT_KEYS: Readonly<
  Record<SleepField, "bedtime" | "sleepTime" | "wakeTime">
> = {
  bedtime: "bedtime",
  sleep_time: "sleepTime",
  wake_time: "wakeTime",
};

/**
 * Records one stated time on a night.
 *
 * The row may not exist yet: logging a bedtime creates the night with its other two times
 * left `null`, because "went to bed at 11" says nothing about when the user woke and a
 * placeholder for it would be a time they never gave. A night is therefore allowed to be
 * incomplete, and `nightMinutes` refuses to report a length until both ends are known.
 */
export function recordNightTime(
  night: SleepLog,
  field: SleepField,
  time: ClockTime,
): Result<SleepChange> {
  const parsed = parseClockTime(time);

  if (!parsed.ok) {
    return parsed;
  }

  const updated: SleepLog = { ...night, [NIGHT_KEYS[field]]: parsed.value };

  // A night records three distinct moments. Two identical ones are not a night: a sleep time
  // equal to the bedtime means no time passed between lying down and sleeping, and a wake time
  // equal to either means the night is either zero-length or a full day — the same ambiguity
  // `overnightMinutes` refuses rather than resolves. Catching it here means the contradiction
  // never reaches the database, instead of surfacing later as a night that cannot be added up.
  if (
    (updated.sleepTime !== null && updated.sleepTime === updated.bedtime) ||
    (updated.wakeTime !== null &&
      (updated.wakeTime === updated.bedtime ||
        updated.wakeTime === updated.sleepTime))
  ) {
    return fail(
      "invalid_time_order",
      `That makes two of the night's times the same, so the night has no length. Check which time it belongs to.`,
      { date: night.date, field, time: parsed.value },
    );
  }

  return ok({
    kind: "night",
    field,
    night: updated,
    time: parsed.value,
  });
}

/** Records the night check-in's phone confirmation. */
export function confirmPhoneOutside(
  night: SleepLog,
  outside: boolean,
): Result<SleepChange> {
  return ok({
    kind: "night",
    field: "phone_outside",
    night: { ...night, phoneOutside: outside },
    time: null,
  });
}

/**
 * Opens a nap.
 *
 * Refused while another nap on that day is still open, because two open naps make "the nap
 * has ended" ambiguous and an ambiguous end time is how a day's record stops adding up. The
 * user is told to close the running one first.
 */
export function startNap(
  openNap: NapLog | null,
  input: { readonly date: CalendarDate; readonly start: ClockTime },
): Result<SleepChange> {
  if (openNap !== null) {
    return fail(
      "invalid_time_order",
      `The nap that started at ${openNap.start} has no end time yet. Close it first.`,
      { start: openNap.start },
    );
  }

  const parsed = parseClockTime(input.start);

  if (!parsed.ok) {
    return parsed;
  }

  return ok({
    kind: "nap",
    // The id is the schema's; the domain's job here is the refusal and the stated time.
    nap: { id: 0, date: input.date, start: parsed.value, end: null },
  });
}

/**
 * Closes a nap.
 *
 * Two refusals, both about facts the data cannot support: a nap that does not exist, and one
 * that already has an end time. Ending a second time is not silently ignored, because a user
 * who believes they corrected a time and did not would carry a wrong record.
 */
export function endNap(
  nap: NapLog | null,
  end: ClockTime,
): Result<SleepChange> {
  if (nap === null) {
    return fail("unknown_nap", "There is no nap to end on that day.", {});
  }

  if (nap.end !== null) {
    return fail("nap_already_ended", `That nap already ended at ${nap.end}.`, {
      end: nap.end,
    });
  }

  const parsed = parseClockTime(end);

  if (!parsed.ok) {
    return parsed;
  }

  const duration = napMinutes({ ...nap, end: parsed.value });

  if (duration !== null && !duration.ok) {
    return fail(
      duration.error.code,
      duration.error.message,
      duration.error.detail,
    );
  }

  return ok({ kind: "nap", nap: { ...nap, end: parsed.value } });
}
