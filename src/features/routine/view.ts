/**
 * The routine read model: what today looks like, what tomorrow holds, and how the night went.
 *
 * This is the Routine feature's whole contribution to a screen. The Dashboard calls it rather
 * than reading `plan_task`, `sleep_log`, and `nap_log` itself, because a second set of rules
 * about what "today's first task" is would be a second thing to keep in step — the exact
 * failure ADR-047 recorded when the Dashboard grew its own summary.
 *
 * ## The rules it applies, and where they live
 *
 * - **Top three** is `selectTopTasks`: the first three rows by id, which is the order they
 *   were written in. `src/domain/routine.ts`.
 * - **First action** is `firstIncompleteTask`: the first not-done row, or nothing.
 *   `src/domain/routine.ts`.
 * - **Night length and nap length** are computed by `src/domain/sleep.ts`, which owns the
 *   midnight wrap. Nothing here subtracts two times.
 * - **The nap warnings** are the PRD's, produced by the domain and passed through.
 * - **The consistency streak** is the neutral count the domain defines. This file adds no
 *   threshold, no grade, and no wording of its own beyond formatting.
 *
 * ## What it will not say
 *
 * A night with a bedtime and no wake time has no length, and this returns `null` for it rather
 * than counting to midnight or guessing. A day with no wake time ends the streak without being
 * called a failure. And a task list that is empty says the list is empty — it does not become
 * "you have nothing to do".
 *
 * Server-only.
 */
import "server-only";

import { nextDate } from "@/domain/calendar";
import type { PlanTask } from "@/domain/routine";
import { firstIncompleteTask, selectTopTasks } from "@/domain/routine";
import type { NapSummary, SleepLog } from "@/domain/sleep";
import {
  asleepMinutes,
  formatDuration,
  nightMinutes,
  summariseNap,
  wakeConsistencyStreak,
} from "@/domain/sleep";

import { getRepositories } from "../shared/command-runtime.ts";

/** One night's record, with its lengths already computed by the domain. */
export type NightView = {
  readonly date: string;
  readonly bedtime: string | null;
  readonly sleepTime: string | null;
  readonly wakeTime: string | null;
  /**
   * Whether the night check-in recorded the phone outside the bedroom.
   *
   * `false` is "not confirmed" as often as it is "confirmed inside", and the screens render
   * only the `true` case. The column cannot tell the two apart and neither does this.
   */
  readonly phoneOutside: boolean;
  /** `null` until both ends of the night are known. */
  readonly inBed: string | null;
  /** `null` until the sleep time and the wake time are both known. */
  readonly asleep: string | null;
  /** False when there is no row for the night at all, as distinct from an empty one. */
  readonly recorded: boolean;
};

export type RoutineView = {
  readonly date: string;
  readonly tomorrow: string;
  /** Every task planned for today, in the order they were written. */
  readonly tasks: readonly PlanTask[];
  /** The first three of those, which is what the morning opens on. */
  readonly topTasks: readonly PlanTask[];
  /** The true count, so a day with more than three says so instead of hiding the rest. */
  readonly taskCount: number;
  /** The first task not done yet, or `null`. Never a suggestion the system invented. */
  readonly firstAction: string | null;
  /** Tomorrow's plan, which the night check-in writes. */
  readonly tomorrowTasks: readonly PlanTask[];
  readonly night: NightView;
  readonly naps: readonly NapSummary[];
  /** A nap that is still running, shown so the page can offer to close it. */
  readonly activeNap: NapSummary | null;
  /** Consecutive days with a wake time inside the PRD's stated range. */
  readonly consistency: {
    readonly days: number;
    readonly lastRecorded: string | null;
  };
};

function nightView(night: SleepLog | null, date: string): NightView {
  if (night === null) {
    return {
      date,
      bedtime: null,
      sleepTime: null,
      wakeTime: null,
      phoneOutside: false,
      inBed: null,
      asleep: null,
      recorded: false,
    };
  }

  const inBed = nightMinutes(night);
  const asleep = asleepMinutes(night);

  return {
    date: night.date,
    bedtime: night.bedtime,
    sleepTime: night.sleepTime,
    wakeTime: night.wakeTime,
    phoneOutside: night.phoneOutside,
    inBed: inBed.ok ? formatDuration(inBed.value) : null,
    asleep: asleep.ok ? formatDuration(asleep.value) : null,
    recorded: true,
  };
}

/**
 * Everything the routine and sleep surfaces show for one day.
 *
 * The date is an argument so the function has no clock and can be tested against any day.
 * `today` is the day whose night is "the night beginning tonight" — bedtime 23:30 on the 1st
 * is part of the 1st's row even though the wake-up belongs to the 2nd.
 */
export function readRoutine(date: string): RoutineView {
  const repositories = getRepositories();
  const tasks = repositories.tasks.listForDate(date);

  const tomorrow = nextDate(date);
  const tomorrowDate = tomorrow.ok ? tomorrow.value : date;
  const naps = repositories.naps.listNapsForDate(date).map(summariseNap);
  const active = naps.find((nap) => nap.end === null) ?? null;

  return {
    date,
    tomorrow: tomorrowDate,
    tasks,
    topTasks: selectTopTasks(tasks),
    taskCount: tasks.length,
    firstAction: firstIncompleteTask(tasks)?.title ?? null,
    tomorrowTasks: selectTopTasks(repositories.tasks.listForDate(tomorrowDate)),
    night: nightView(repositories.sleep.findNight(date), date),
    naps,
    activeNap: active,
    // 30 nights is more than the streak can span in any honest reading of "consistency", and
    // it is a bounded read rather than the whole table.
    consistency: wakeConsistencyStreak(repositories.sleep.listNights(30)),
  };
}
