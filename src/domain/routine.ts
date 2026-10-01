/**
 * The daily plan: what the user intends to do on a given day, and which of it is done.
 *
 * ## The data model is the PRD's, unchanged
 *
 * `plan_task` has existed since micro-phase 1.1 with exactly the fields the PRD lists —
 * `date`, `title`, `done` — and Phase 6 adds no column to it. The one thing it does not have
 * is an explicit priority field, and that turns out not to be needed: **the order the rows
 * were written in is the order they matter in.**
 *
 * That is a real rule rather than a default, and it is the one the PRD's ritual implies. A
 * night check-in writes tomorrow's three tasks in the order the user considers them
 * important; the first row is therefore the first thing to do. A `priority` column would add
 * a second source of truth for the same decision — a number a model could then be asked to
 * choose, which is precisely the "this is your #1 priority" outcome ADR-048 rules out.
 *
 * So: **top 3 is the first three rows by `id`, ascending.** `id` is unique, so there are no
 * ties to break and no tie-breaking rule to document. A day with fewer than three tasks
 * shows what exists; a day with none shows nothing and says why.
 *
 * ## What this module decides
 *
 * Everything here is a pure function over task rows. Creating a task, marking it done or
 * undone, choosing the morning's three, and finding the first thing not yet done are all
 * decided from the data and nothing else. There is no clock, no database, and no ranking
 * function that could be asked what matters most.
 *
 * Pure. No clock, no database, no filesystem.
 */
import type { CalendarDate } from "./calendar.ts";
import {
  isCalendarDate,
  nextDate,
  parseCalendarDate,
  previousDate,
} from "./calendar.ts";
import { fail, ok, type Result } from "./result.ts";

/**
 * How many tasks the morning view opens on.
 *
 * The PRD's "top 3 tasks". A display cap, not a limit on planning: a day with five planned
 * tasks keeps all five, shows three, and reports the true count so nothing disappears
 * silently.
 */
export const TOP_TASK_LIMIT = 3;

/** The longest a task title may be, so a page cannot be broken by a pasted essay. */
export const MAX_TASK_TITLE = 120;

/** One planned task, matching the `plan_task` row. */
export type PlanTask = {
  readonly id: number;
  readonly date: CalendarDate;
  readonly title: string;
  readonly done: boolean;
};

/** A task before it has been stored: no id, because the schema assigns that. */
export type NewTask = {
  readonly date: CalendarDate;
  readonly title: string;
};

/**
 * A day, as a person says it.
 *
 * A closed set of three words rather than a date, because a date is a computed value and the
 * application computes it. "Tomorrow" is a fact the user stated; `2026-10-02` is a
 * conclusion drawn from it and a clock, and only the application may draw that one
 * (ADR-048). An absent reference means today, which is a documented default rather than an
 * inference — the same treatment `category` gets on `expense.record`.
 */
export type DayReference = "today" | "tomorrow" | "yesterday";

export const DAY_REFERENCES: readonly DayReference[] = [
  "today",
  "tomorrow",
  "yesterday",
];

export function isDayReference(value: string): value is DayReference {
  return (DAY_REFERENCES as readonly string[]).includes(value);
}

/**
 * Turns a stated day into a calendar day.
 *
 * The clock is supplied by the caller — the composition root is the only module allowed to
 * read it — so this stays a pure function of two dates and an offset.
 */
export function resolveDayReference(
  reference: DayReference | null,
  today: CalendarDate,
): Result<CalendarDate> {
  if (!isCalendarDate(today)) {
    return fail("invalid_date", `"${today}" is not a calendar date.`, {
      received: today,
    });
  }

  if (reference === null || reference === "today") {
    return ok(today);
  }

  return reference === "tomorrow" ? nextDate(today) : previousDate(today);
}

/**
 * Validates a task about to be written.
 *
 * A title is trimmed before it is stored, so "  read a book " and "read a book" are the same
 * task and the schema's `UNIQUE (date, title)` catches the duplicate as one case rather than
 * two spellings of it. Control characters are refused rather than stripped: a title with a
 * newline in it is a paste accident, and quietly cleaning it up would hide it.
 */
export function createTask(input: {
  readonly date: CalendarDate;
  readonly title: string;
}): Result<NewTask> {
  const date = parseCalendarDate(input.date);

  if (!date.ok) {
    return date;
  }

  const title = input.title.trim();

  if (title === "") {
    return fail("invalid_task_selection", "A task needs a title.", {});
  }

  if (title.length > MAX_TASK_TITLE) {
    return fail(
      "invalid_task_selection",
      `A task title may be at most ${MAX_TASK_TITLE} characters.`,
      { length: title.length },
    );
  }

  // Control characters come from a paste, not from a thought, and quietly stripping them
  // would hide that something was pasted rather than typed.
  if (/[\u0000-\u001F\u007F]/u.test(title)) {
    return fail(
      "invalid_task_selection",
      "A task title cannot contain control characters.",
      {},
    );
  }

  return ok({ date: date.value, title });
}

/**
 * A task as it will be stored, with the row id the repository assigned.
 *
 * The change is returned whole so a caller can echo exactly what happened, and so a write
 * failure can be reported without a second read.
 */
export type TaskChange = {
  readonly kind: "task";
  readonly task: PlanTask;
  readonly after: boolean;
};

/** Sets or clears a task's completion. Never removes it, and never reorders it. */
export function setTaskDone(task: PlanTask, done: boolean): Result<TaskChange> {
  return ok({ kind: "task", task: { ...task, done }, after: done });
}

/**
 * The morning's tasks: the first `limit` rows, in the order they were written.
 *
 * `limit` defaults to the PRD's three. It is clamped to the list length rather than padded,
 * so two planned tasks produce two tasks, and never an empty entry to make three.
 */
export function selectTopTasks(
  tasks: readonly PlanTask[],
  limit: number = TOP_TASK_LIMIT,
): readonly PlanTask[] {
  return [...tasks].sort(byId).slice(0, Math.max(0, limit));
}

/**
 * The first task the user wrote down that is not done yet.
 *
 * `null` covers two different days — nothing was planned, and everything planned is
 * finished — and callers are expected to tell them apart using the task list rather than by
 * inventing a suggestion. Returning `null` rather than a placeholder is what keeps the
 * morning screen from ever saying "you have nothing to do" when the truth is "you finished
 * everything".
 */
export function firstIncompleteTask(
  tasks: readonly PlanTask[],
): PlanTask | null {
  const ordered = [...tasks].sort(byId);

  return ordered.find((task) => !task.done) ?? null;
}

/**
 * Tomorrow's three, which is what a night check-in writes and the morning then opens on.
 *
 * The same rule as `selectTopTasks`, named for the ritual so the check-in and the morning
 * read the same function rather than two expressions that happen to agree today.
 */
export function tomorrowPlan(
  tasksForTomorrow: readonly PlanTask[],
): readonly PlanTask[] {
  return selectTopTasks(tasksForTomorrow, TOP_TASK_LIMIT);
}

/**
 * A night check-in: the titles to write, in order.
 *
 * At most `TOP_TASK_LIMIT`, because the PRD's ritual is three and accepting more would mean
 * storing rows the morning will never show. It is refused rather than truncated, because a
 * check-in that silently drops a task the user just wrote is a plan that quietly changed
 * itself. At least one is required: a check-in with no tasks in it is a form that was
 * submitted empty, and the page asks again rather than recording an empty ritual.
 */
export function nightCheckInTitles(
  rawTitles: readonly string[],
): Result<readonly string[]> {
  const titles = rawTitles
    .map((title) => title.trim())
    .filter((title) => title !== "");

  if (titles.length === 0) {
    return fail(
      "invalid_task_selection",
      "Write at least one task for tomorrow.",
      {},
    );
  }

  if (titles.length > TOP_TASK_LIMIT) {
    return fail(
      "invalid_task_selection",
      `The night check-in takes up to ${TOP_TASK_LIMIT} tasks. Add the rest during the day.`,
      { count: titles.length },
    );
  }

  // Duplicates within one submission would collide on the schema's UNIQUE (date, title) and
  // roll the whole check-in back, so they are refused here with a message that says why.
  const seen = new Set<string>();

  for (const title of titles) {
    if (seen.has(title)) {
      return fail(
        "duplicate_task",
        `"${title}" is already on tomorrow's list.`,
        { title },
      );
    }

    seen.add(title);
  }

  for (const title of titles) {
    const created = createTask({ date: "1970-01-01", title });

    if (!created.ok) {
      return fail(
        created.error.code,
        created.error.message,
        created.error.detail,
      );
    }
  }

  return ok(titles);
}

/** The one ordering rule in this module, written once. */
function byId(left: PlanTask, right: PlanTask): number {
  return left.id - right.id;
}
