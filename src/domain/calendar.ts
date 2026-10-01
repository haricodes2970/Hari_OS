/**
 * A calendar date as `YYYY-MM-DD`, and the arithmetic on it.
 *
 * The whole application agrees on one convention: dates are UTC calendar days, and every
 * timestamp in the schema is an ISO-8601 UTC instant (ADR-034). `currentUtcDate` in the
 * composition root is the single place a date is read from the clock; everything downstream
 * takes a date as an argument, which is why the operations here are pure and can be tested
 * against any day.
 *
 * This module exists so that "tomorrow", "the night before", and "is this a real day" are
 * answered in exactly one place. A page that computed tomorrow's date with its own string
 * arithmetic would be one refactor away from disagreeing with a repository that filtered on
 * a different value — and a routine feature that puts the morning's tasks on yesterday's
 * list is precisely that bug.
 *
 * Pure. No clock, no database, no filesystem.
 */
import { fail, ok, type Result } from "./result.ts";

/** A calendar day, `YYYY-MM-DD`. */
export type CalendarDate = string;

/** The shape a date must have before anyone tries to do arithmetic with it. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Whether a value is a real calendar day.
 *
 * The regex alone is not enough: `2026-02-30` matches the shape and is not a day that ever
 * happened. The date is therefore built from its parts and checked by converting it back,
 * so a month of 13 or a 31 February is refused rather than rolling silently into March —
 * which is what `new Date("2026-02-30")` would do.
 */
export function isCalendarDate(value: string): value is CalendarDate {
  if (!ISO_DATE.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const asUtc = Date.UTC(year, month - 1, day);

  const roundTrip = new Date(asUtc);

  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

/**
 * Parses an untrusted value into a calendar day.
 *
 * A failure names the received text, which is a value the user typed rather than a secret, so
 * the caller may show it.
 */
export function parseCalendarDate(value: string): Result<CalendarDate> {
  return isCalendarDate(value)
    ? ok(value)
    : fail(
        "invalid_date",
        `"${value}" is not a calendar date in YYYY-MM-DD form.`,
        { received: value },
      );
}

/** The day after `date`. */
export function nextDate(date: CalendarDate): Result<CalendarDate> {
  return addDays(date, 1);
}

/** The day before `date`. */
export function previousDate(date: CalendarDate): Result<CalendarDate> {
  return addDays(date, -1);
}

/**
 * Moves a day by whole days.
 *
 * Through the epoch rather than by adding to the numbers in the string, so 2026-12-31 plus a
 * day is 2027-01-01 and 2026-03-01 minus a day is 2026-02-28. Arithmetic on the digits of a
 * date string is the classic way to produce a date that does not exist.
 */
export function addDays(
  date: CalendarDate,
  days: number,
): Result<CalendarDate> {
  if (!isCalendarDate(date)) {
    return fail("invalid_date", `"${date}" is not a calendar date.`, {
      received: date,
    });
  }

  if (!Number.isInteger(days)) {
    return fail(
      "invalid_date",
      "A day offset must be a whole number of days.",
      {
        days,
      },
    );
  }

  const [year, month, day] = date.split("-").map(Number);
  const moved = new Date(
    Date.UTC(year, month - 1, day) + days * MILLISECONDS_PER_DAY,
  );

  return ok(moved.toISOString().slice(0, 10));
}

/**
 * Every day from `from` to `to`, inclusive, in order.
 *
 * Used by the consistency streak, which walks days backwards and needs to stop at the
 * beginning rather than wrap around. `to` before `from` yields an empty list rather than
 * failing: "no days in that range" is a real answer when nothing has been recorded.
 */
export function daysBetween(
  from: CalendarDate,
  to: CalendarDate,
): Result<readonly CalendarDate[]> {
  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    return fail("invalid_date", "A day range needs two calendar dates.", {});
  }

  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);

  if (end < start) {
    return ok([]);
  }

  const days: CalendarDate[] = [];

  for (let instant = start; instant <= end; instant += MILLISECONDS_PER_DAY) {
    days.push(new Date(instant).toISOString().slice(0, 10));
  }

  return ok(days);
}

/**
 * The calendar day an ISO-8601 instant falls on.
 *
 * The one place a timestamp becomes a date, so `sleep.record` from chat and a bedtime typed
 * into the form cannot land on different days for the same moment. It is the UTC day, which is
 * the convention every stored timestamp already uses (ADR-034) — a user in another zone sees
 * their own midnight, and this function does not pretend otherwise.
 */
export function calendarDateOf(timestamp: string): Result<CalendarDate> {
  const millis = Date.parse(timestamp);

  if (Number.isNaN(millis)) {
    return fail(
      "invalid_time",
      `"${timestamp}" is not a timestamp this build can read.`,
      { received: timestamp },
    );
  }

  return ok(new Date(millis).toISOString().slice(0, 10));
}
