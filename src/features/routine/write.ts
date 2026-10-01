/**
 * The night check-in: the one deliberate act that closes the day and opens the next.
 *
 * ## What it is, and why it is not a command
 *
 * The PRD's ritual is two things at once — write tomorrow's three tasks, and confirm the
 * phone is charging outside the bedroom. That makes it a **transaction over several rows**,
 * and the command contract is deliberately one stated fact per command (ADR-021): a
 * three-task write is three facts, and a command that carried them as a list would be the
 * first multi-fact command in the system and would need its own validation, its own executor
 * branch, and its own parser support for a shape no sentence produces.
 *
 * So the check-in is an **operation**, dispatched from `POST /api/routine` the same way the
 * Kitchen's add-a-item and correct-an-entry operations are, and it reuses the same domain
 * rules the command path uses. A task can also be planned one at a time from chat
 * (`task.create`); this is the other door to the same room, not a different room.
 *
 * ## Atomicity
 *
 * All three writes — clear the old list, insert the new one, record the phone confirmation —
 * run in a single transaction. A check-in that stored two of three tasks would leave a plan
 * that is partly the one the user just wrote and partly yesterday's, with nothing on screen
 * saying so. If any write fails, nothing is written.
 *
 * ## The phone confirmation is a fact, not a judgement
 *
 * The user says where the phone is. Nothing here decides whether they are telling the truth,
 * and nothing anywhere turns the answer into a score. The column's `false` means "not
 * confirmed" as often as it means "inside", and the screens say so rather than accusing.
 *
 * Server-only: it reaches storage through the composition root.
 */
import "server-only";

import { nextDate } from "@/domain/calendar";
import { createTask, nightCheckInTitles } from "@/domain/routine";

import { getRepositories } from "../shared/command-runtime.ts";

/**
 * A refusal carries the domain's own code as a token.
 *
 * `string` rather than the `OutcomeToken` union, for the same reason the Kitchen operations
 * use one: the domain's vocabulary is the authority on why a request was refused, and a second
 * closed set in this layer would have to be kept in step with it. `describeOutcome` maps the
 * code to a sentence, and an unknown code renders as a neutral failure rather than as raw
 * text from a URL.
 */
export type RoutineOperationResult =
  | { readonly ok: true; readonly message: string }
  | {
      readonly ok: false;
      readonly token: string;
      readonly error: string;
    };

function refused(token: string, error: string): RoutineOperationResult {
  return { ok: false, token, error };
}

/**
 * Writes tomorrow's plan and records tonight's phone confirmation.
 *
 * `today` is passed in rather than read here, so the whole operation stays testable against
 * any day and this file contains no clock. The caller supplies it from the composition root,
 * which is the only module allowed to know what time it is.
 *
 * Replacing an earlier check-in clears tomorrow's **undone** tasks and leaves completed ones
 * alone. A completed task is a record that something happened; a second check-in must not be
 * able to erase it.
 */
export function runNightCheckIn(input: {
  readonly today: string;
  readonly titles: readonly string[];
  readonly phoneOutside: boolean;
}): RoutineOperationResult {
  const repositories = getRepositories();

  const tomorrow = nextDate(input.today);

  if (!tomorrow.ok) {
    return refused("invalid_date", tomorrow.error.message);
  }

  const date = tomorrow.value;
  const titles = nightCheckInTitles(input.titles);

  if (!titles.ok) {
    return refused(titles.error.code, titles.error.message);
  }

  // Validate every title through the same domain operation the command path uses, so a title
  // that chat would refuse cannot slip in through the form.
  for (const title of titles.value) {
    const created = createTask({ date, title });

    if (!created.ok) {
      return refused(created.error.code, created.error.message);
    }
  }

  const existing = repositories.tasks.listForDate(date);
  const taken = new Set(existing.map((task) => task.title));

  for (const title of titles.value) {
    if (taken.has(title)) {
      return refused(
        "duplicate_task",
        `"${title}" is already on ${date}'s list.`,
      );
    }
  }

  try {
    repositories.transaction(() => {
      const cleared = repositories.tasks.deleteUndoneForDate(date);

      if (!cleared.ok) {
        throw new Error(cleared.error.message);
      }

      for (const title of titles.value) {
        const inserted = repositories.tasks.insertTask({ date, title });

        if (!inserted.ok) {
          throw new Error(inserted.error.message);
        }
      }

      const night = repositories.sleep.ensureNight(input.today);

      if (!night.ok) {
        throw new Error(night.error.message);
      }

      const phone = repositories.sleep.savePhoneOutside(
        input.today,
        input.phoneOutside,
      );

      if (!phone.ok) {
        throw new Error(phone.error.message);
      }
    });
  } catch {
    // The driver's message is deliberately not shown. A persistence failure says what
    // happened to the user's data, and nothing about SQLite is a fact they can act on.
    return refused(
      "persistence_failed",
      "The check-in could not be stored, so nothing was changed.",
    );
  }

  return {
    ok: true,
    message: `Planned ${titles.value.length} ${
      titles.value.length === 1 ? "task" : "tasks"
    } for ${date}.`,
  };
}
