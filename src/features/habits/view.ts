/**
 * The Habits read side: what the user recorded today, how the neutral habits are running, and
 * the photo timeline.
 *
 * ## What this module reads, and what it refuses to
 *
 * It reads `habit_log` and nothing else. `private_log` has its own module —
 * `src/features/habits/private-log.ts` — and this file does not import it, so the Dashboard and
 * the Routine page cannot show a private entry even by accident: there is nothing here to pass
 * one on. That is the whole privacy boundary, and it is a structural one rather than a promise
 * in a comment.
 *
 * ## The rules it applies are the domain's
 *
 * - A **streak** is `habitStreak`, and it is computed for `cooking`, `dishes`, and `laundry`
 *   only. Screen time is a measurement and gets no streak.
 * - The **laundry target** is `laundryProgress` against the PRD's twice-a-week.
 * - A **missing day is "not recorded"**, not "not done". Only a row that says `done = 0` is a
 *   statement about the user, and inventing the other one is how a habit tracker starts making
 *   claims its data does not support.
 * - **Screen time** is reported as the number the user typed, and says so. Nothing here measures
 *   it, estimates it, or imports a device API.
 *
 * ## The progress bar is the PRD's, and only for laundry
 *
 * PRD section 6.6 asks for a progress bar on the neutral habits. There is exactly one here, for
 * laundry against twice a week, and it is built from the domain's two numbers rather than a
 * percentage computed in JSX. There is no bar for screen time and no bar for anything private.
 *
 * Server-only: it reaches storage through the composition root.
 */
import "server-only";

import type { CalendarDate } from "@/domain/calendar";
import { addDays } from "@/domain/calendar";
import type { HabitLog, HabitType, LoggableHabitType } from "@/domain/habits";
import { HABIT_TYPES, habitStreak, laundryProgress } from "@/domain/habits";

import { getRepositories } from "../shared/command-runtime.ts";

/** How many days the laundry window covers: the PRD says "twice per week". */
const LAUNDRY_WINDOW_DAYS = 7;

/** How many photos the timeline shows. Enough to be a timeline, bounded so it stays a page. */
const TIMELINE_LIMIT = 24;

/** One neutral habit's streak, as the page needs it. */
export type HabitStreakView = {
  readonly type: HabitType;
  readonly label: string;
  readonly recorded: boolean;
  readonly done: boolean;
  readonly days: number;
  readonly lastRecorded: string | null;
  /** True when a photo is attached to today's row, which for laundry is how it was completed. */
  readonly hasPhoto: boolean;
};

/** Laundry against the PRD's target, for the one progress bar in this application. */
export type LaundryProgressView = {
  readonly doneThisWeek: number;
  readonly target: number;
  /** An integer 0–100, computed from the two numbers above. A bar, not a grade. */
  readonly percent: number;
  readonly met: boolean;
};

/** One entry in the photo timeline: PRD 6.6's "digital diary". */
export type PhotoTimelineEntry = {
  readonly id: number;
  readonly date: string;
  readonly label: string;
  /** The application URL that serves the image. Never a filesystem path. */
  readonly photoUrl: string;
};

export type HabitsView = {
  readonly date: string;
  /** Today's entries, in the order the rows were written. */
  readonly today: readonly HabitLog[];
  /** One entry per neutral habit, whether or not anything was recorded for it. */
  readonly streaks: readonly HabitStreakView[];
  readonly laundry: LaundryProgressView;
  /** The screen-time estimate the user typed today, or `null`. Never measured. */
  readonly screenTimeMinutes: number | null;
  /** Recent days with a photo attached, newest first. */
  readonly timeline: readonly PhotoTimelineEntry[];
};

const LABELS: Readonly<Record<HabitType, string>> = {
  cooking: "Cooking",
  dishes: "Dishes",
  laundry: "Laundry",
};

/**
 * Labels for every loggable type, including screen time.
 *
 * The timeline is a read of `habit_log`, which contains no private rows — a private entry is a
 * different table behind a different repository — so this map is complete by construction and a
 * missing key would be a bug rather than a case to fall back from.
 */
const TIMELINE_LABELS: Readonly<Record<LoggableHabitType, string>> = {
  ...LABELS,
  screen_time: "Screen time",
};

/**
 * Everything the Habits page shows for one day.
 *
 * `date` is an argument so this module has no clock and can be tested against any day. The caller
 * supplies it from the composition root, which is the only module allowed to read the time.
 */
export function readHabits(date: CalendarDate): HabitsView {
  const repositories = getRepositories();
  const today = repositories.habits.listForDate(date);

  // Seven days ending today, read as one window so the laundry count and the streak cannot
  // disagree about which days were considered.
  const from = addDays(date, -(LAUNDRY_WINDOW_DAYS - 1));
  const window = from.ok
    ? repositories.habits.listBetween(from.value, date)
    : today;

  const laundry = laundryProgress(window);
  const progress =
    laundry.target === 0
      ? 0
      : Math.min(
          100,
          Math.round((laundry.doneThisWeek / laundry.target) * 100),
        );

  return {
    date,
    today,
    streaks: HABIT_TYPES.map((type) => {
      const entry = today.find((row) => row.type === type);
      const streak = habitStreak(window, type, date);

      return {
        type,
        label: LABELS[type],
        recorded: entry !== undefined,
        done: entry?.done ?? false,
        days: streak.days,
        lastRecorded: streak.lastRecorded,
        hasPhoto: entry?.photoUrl !== null && entry !== undefined,
      };
    }),
    laundry: {
      doneThisWeek: laundry.doneThisWeek,
      target: laundry.target,
      percent: progress,
      met: laundry.doneThisWeek >= laundry.target,
    },
    screenTimeMinutes:
      today.find((entry) => entry.type === "screen_time")?.minutes ?? null,
    timeline: repositories.habits
      .listWithPhotos(TIMELINE_LIMIT)
      .map((entry) => ({
        id: entry.id,
        date: entry.date,
        label: TIMELINE_LABELS[entry.type],
        photoUrl: entry.photoUrl ?? "",
      })),
  };
}
