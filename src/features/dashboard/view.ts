/**
 * The Dashboard read model: everything the day's screen shows, assembled from real state.
 *
 * ## What this module is for
 *
 * The Dashboard is an *aggregating* view. It owns no data of its own, so the only thing worth
 * being careful about is where each figure comes from. Every value below is produced by the
 * module that owns the rule behind it:
 *
 * - **Low stock** comes from the Kitchen read side, which calls the domain's own `isLowStock`.
 *   The comparison `quantity <= threshold` exists in exactly one place and the Dashboard does not
 *   repeat it, because two screens disagreeing about whether the onions are low is precisely the
 *   failure this file exists to prevent.
 * - **Today's spend** comes from the Expenses read side, which totals the day with the domain's
 *   `summariseDay` — the same function that produces the daily bill. The Dashboard's figure and
 *   the bill's total are therefore the same number by construction, not by agreement.
 * - **Tasks** come from `plan_task`, which has existed in the schema since micro-phase 1.1.
 *
 * ## No rule is duplicated, and no arithmetic happens here
 *
 * Nothing in this file sums, compares, or rounds. It selects rows, calls rules that already
 * exist, and shapes the result for rendering. There is no model involved at any point: the
 * Dashboard shows what the database holds and never suggests what to do about it.
 *
 * ## What it deliberately does not have
 *
 * - **No recommendation.** `suggestedFirstAction` is the first task the user wrote down and has
 *   not marked done. It is not ranked, scored, reordered, or generated. An assistant that picked
 *   for the user would be the failure the PRD names, not a feature.
 * - **No second task model.** `plan_task` rows are read; nothing here creates one. Writing them is
 *   Routine's job (Phase 6), and until then the list is empty and says so.
 * - **No Skills.** The replacement-activity list is Phase 7. `SKILLS_AVAILABLE` is `false` and the
 *   page renders a truthful unavailable state rather than an empty list that looks like a verdict.
 * - **No money arithmetic.** See above.
 *
 * Server-only: it reaches storage through the composition root, so importing it from a client
 * component would pull a database connection into the browser.
 */
import "server-only";

import type { HabitType } from "@/domain/habits";
import { selectTopTasks } from "@/domain/routine.ts";

import { readDailyBill } from "../expenses/view.ts";
import { listKitchenStock } from "../kitchen/view.ts";
import { readRoutine } from "../routine/view.ts";
import { currentUtcDate, getRepositories } from "../shared/command-runtime.ts";

/**
 * How many tasks the morning view shows.
 *
 * The PRD's "top 3 tasks", written the night before. It is a cap on display, not a rule about
 * what the user may plan — if four rows exist for today, all four are counted and the fourth is
 * reported rather than silently dropped.
 *
 * Phase 6 moved the *selection* into `selectTopTasks`, in `src/domain/routine.ts`, because the
 * Routine feature now owns `plan_task` and this limit has to be the same three tasks the
 * morning opens on everywhere else. This constant remains only as the Dashboard's own
 * re-export for the pages and tests that already import it from here; there is one rule, in one
 * place.
 */
export { TOP_TASK_LIMIT } from "@/domain/routine.ts";

/**
 * Whether the replacement-activity list exists yet.
 *
 * A build fact, not data, and deliberately `false`: the Skills module is Phase 7. It is declared
 * here rather than hard-coded in the page so that the reason the entry point is unavailable lives
 * beside the other availability statements, and so a test can assert the flag instead of reading
 * the JSX to discover it.
 */
export const SKILLS_AVAILABLE = false;

/** One low-stock line, as the Dashboard needs it. `lowStock` is already the domain's verdict. */
export type LowStockLine = {
  readonly id: number;
  readonly name: string;
  readonly quantity: number;
  readonly unit: string;
  readonly lowThreshold: number | null;
};

/** One planned task for today. */
export type DashboardTaskLine = {
  readonly id: number;
  readonly title: string;
  readonly done: boolean;
};

/** One recorded habit entry for today. */
export type DashboardHabitLine = {
  readonly type: HabitType;
  readonly done: boolean;
  readonly hasPhoto: boolean;
};

/**
 * Today's spend.
 *
 * `computed` is `false` when the domain refused to total the day, which the page must render as
 * "could not be computed" rather than as ₹0.00. A zero would claim nothing was spent, and this
 * application cannot make that claim about a day it failed to add up.
 */
export type DashboardSpend = {
  readonly computed: boolean;
  readonly total: number;
  readonly formattedTotal: string;
  readonly count: number;
};

export type DashboardModel = {
  /** The UTC calendar day this describes, matching how every timestamp is stored. */
  readonly date: string;
  readonly spend: DashboardSpend;
  readonly lowStock: readonly LowStockLine[];
  /** How many items are tracked at all, so "nothing low" can be told apart from "nothing tracked". */
  readonly inventoryCount: number;
  readonly tasks: readonly DashboardTaskLine[];
  /** Every task written for today, including any beyond the three shown. */
  readonly taskCount: number;
  /**
   * The first thing the user wrote down for today that is not done yet, or `null`.
   *
   * `null` covers both "nothing was planned" and "everything planned is done". Those are different
   * situations and the page distinguishes them using `tasks`, not by inventing a suggestion.
   */
  readonly suggestedFirstAction: string | null;
  readonly habits: readonly DashboardHabitLine[];
  readonly skillsAvailable: boolean;
  /**
   * Last night's sleep, as far as it was recorded.
   *
   * Every field is nullable and the page renders the nulls as "not recorded". The morning view
   * shows how long the night was so the user can judge their own day; it does not convert that
   * into a target, a grade, or advice.
   */
  readonly sleep: DashboardSleep;
  /**
   * Consecutive days with a wake time inside the PRD's stated range.
   *
   * A record, never a comparison. Nothing here subtracts a missed day or changes colour with it.
   */
  readonly consistencyDays: number;
  /**
   * Whether tomorrow already has a plan.
   *
   * This is the PRD's visible next action working in the direction that matters: a morning that
   * opens on tasks chosen last night. It is a fact about the rows, not a prompt to go and do
   * something.
   */
  readonly tomorrowPlanned: boolean;
};

/** Last night's sleep, for the morning card. All of it optional, because all of it is optional. */
export type DashboardSleep = {
  readonly recorded: boolean;
  readonly bedtime: string | null;
  readonly sleepTime: string | null;
  readonly wakeTime: string | null;
  readonly inBed: string | null;
  readonly asleep: string | null;
};

/**
 * Everything the Dashboard shows for one day.
 *
 * The date is an argument rather than read here, so the function has no clock and can be tested
 * against any day. Every read goes through the composition root, so this module never opens a
 * database of its own.
 */
export function readDashboard(date: string = currentUtcDate()): DashboardModel {
  const bill = readDailyBill(date);
  const stock = listKitchenStock();
  const routine = readRoutine(date);
  const habits = getRepositories().display.habitsForDate(date);

  // `readRoutine` returns every task for the day; the top three are the morning's, chosen by
  // the domain rule rather than by slicing here.
  const topTasks = selectTopTasks(routine.tasks);
  const undone =
    topTasks.find((task) => !task.done) ??
    routine.tasks.find((task) => !task.done);

  return {
    date,
    spend:
      bill === null
        ? { computed: false, total: 0, formattedTotal: "", count: 0 }
        : {
            computed: true,
            total: bill.total,
            formattedTotal: bill.formattedTotal,
            count: bill.count,
          },
    lowStock: stock
      .filter((item) => item.lowStock)
      .map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        lowThreshold: item.lowThreshold,
      })),
    inventoryCount: stock.length,
    // The database orders by id, so this is the order the tasks were written in.
    tasks: topTasks.map((task) => ({
      id: task.id,
      title: task.title,
      done: task.done,
    })),
    taskCount: routine.taskCount,
    suggestedFirstAction: undone === undefined ? null : undone.title,
    habits: habits.map((entry) => ({
      type: entry.type,
      done: entry.done,
      hasPhoto: entry.hasPhoto,
    })),
    skillsAvailable: SKILLS_AVAILABLE,
    sleep: {
      recorded: routine.night.recorded,
      bedtime: routine.night.bedtime,
      sleepTime: routine.night.sleepTime,
      wakeTime: routine.night.wakeTime,
      inBed: routine.night.inBed,
      asleep: routine.night.asleep,
    },
    consistencyDays: routine.consistency.days,
    tomorrowPlanned: routine.tomorrowTasks.length > 0,
  };
}
