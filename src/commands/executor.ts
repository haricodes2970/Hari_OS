/**
 * Command execution: turning a validated command into persisted state.
 *
 * This is the orchestration layer, and it is deliberately thin. For each command it:
 *
 *  1. resolves the names the command carries to real rows, because the command may not
 *     supply database ids;
 *  2. calls the matching `src/domain` operation, which decides the outcome and every number
 *     involved;
 *  3. persists the change the domain produced, atomically;
 *  4. reports what happened, or exactly which kind of thing failed.
 *
 * The order matters. **The domain runs before any write.** Nothing is written until the
 * domain has already decided the result, so a refusal such as "only 3 onions" can never leave
 * a transaction half-open, and the executor never has to undo a change the domain declined to
 * make.
 *
 * The executor calculates nothing. If a balance or a remaining quantity appears in this
 * file's output, it arrived from `src/domain` or from a column it just read.
 *
 * ## What the command is not trusted with
 *
 * A validated command carries facts, never results (ADR-029). It has no id, no timestamp, no
 * balance, and no resulting quantity. Identity comes from the row the repository loaded, the
 * timestamp from the execution clock, and every outcome number from the domain. A command
 * that tried to supply any of those could not get past `parseCommand`, which rejects unknown
 * fields outright.
 */
import "server-only";

import type { AccountChange, ExpenseChange } from "@/domain/accounts";
import { applyExpense } from "../domain/accounts.ts";
import { calendarDateOf } from "../domain/calendar.ts";
import type { TaskChange } from "../domain/routine";
import {
  createTask,
  resolveDayReference,
  setTaskDone,
} from "../domain/routine.ts";
import type {
  InventoryChange,
  InventoryItem,
  StampedInventoryChange,
} from "@/domain/inventory";
import {
  consumeInventory,
  recountAfterUse,
  restockInventory,
  setInventoryQuantity,
  stampInventoryChange,
} from "../domain/inventory.ts";
import type { HabitChange, HabitLog, PrivateLogEntry } from "@/domain/habits";
import { recordHabit, recordPrivateEntry } from "../domain/habits.ts";
import type { Skill, SkillLog } from "@/domain/skills";
import { createSkill, logSkillUse } from "../domain/skills.ts";
import type { DomainError, Result } from "@/domain/result";
import type { NapLog, SleepChange } from "@/domain/sleep";
import { endNap, recordNightTime, startNap } from "../domain/sleep.ts";

import type { Repositories } from "../lib/db/repositories.ts";
import { parseCommand } from "../lib/validation/command.ts";
import type { ValidationIssue } from "@/lib/validation/result";

import {
  consumeArguments,
  expenseArguments,
  recountAfterUseArguments,
  restockArguments,
  setQuantityArguments,
} from "./domain-input.ts";
import type { Command } from "./contract.ts";

/**
 * The execution-time clock.
 *
 * Injected rather than read from `Date.now()` so the executor stays deterministic and
 * testable, and so `hari-os/command-boundary` can keep the command layer free of ambient
 * time. Whatever composes the executor supplies the real clock; that is where "now" is read
 * (ADR-034).
 */
export type ExecutionClock = () => string;

/**
 * Everything execution needs from the outside world.
 *
 * Two values, not a container. The executor genuinely cannot determine the current quantity,
 * the account balance, a row's identity, or the time without them, so passing them is honest
 * rather than dependency-injection ceremony.
 */
export type ExecutionDependencies = {
  readonly repositories: Repositories;
  readonly now: ExecutionClock;
};

/**
 * Why an execution failed, kept apart by kind.
 *
 * The three kinds are genuinely different problems with different owners. A validation
 * failure means the producer is broken. A domain failure means the request is a real-world
 * impossibility the user needs to hear about. A persistence failure means the request may be
 * perfectly valid and the system could not store it, which is the one case where retrying
 * makes sense.
 */
export type ExecutionError =
  | { readonly kind: "validation"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "domain"; readonly error: DomainError }
  | { readonly kind: "persistence"; readonly message: string };

/** What a successful execution did, in terms the caller can act on. */
export type ExecutionOutcome =
  | { readonly kind: "inventory"; readonly change: InventoryChange }
  | { readonly kind: "expense"; readonly change: AccountChange }
  | { readonly kind: "task"; readonly change: TaskChange }
  | { readonly kind: "sleep"; readonly change: SleepChange }
  | {
      readonly kind: "skill";
      readonly change:
        | { readonly action: "created"; readonly skill: Skill }
        | {
            readonly action: "logged";
            readonly skill: Skill;
            readonly log: SkillLog;
          };
    }
  | { readonly kind: "habit"; readonly change: HabitChange }
  | {
      readonly kind: "private";
      readonly change: {
        readonly date: string;
        readonly type: PrivateLogEntry["type"];
        readonly happened: boolean;
      };
    };

export type ExecutionResult =
  | { readonly ok: true; readonly value: ExecutionOutcome }
  | { readonly ok: false; readonly error: ExecutionError };

function fail(error: ExecutionError): ExecutionResult {
  return { ok: false, error };
}

function succeed(value: ExecutionOutcome): ExecutionResult {
  return { ok: true, value };
}

function domainFailure(error: DomainError): ExecutionResult {
  return fail({ kind: "domain", error });
}

/**
 * Persists a computed stock change: the new quantity and its log entry, together.
 *
 * Both writes share one transaction because a quantity without its event is an unexplained
 * number, and an event without its quantity is a lie. The domain has already decided the
 * outcome by the time this runs, so there is nothing to roll back on a domain refusal.
 */
function persistInventoryChange(
  repositories: Repositories,
  change: StampedInventoryChange,
): ExecutionResult {
  try {
    repositories.transaction(() => {
      const quantity = repositories.inventory.saveQuantity(
        change.itemId,
        change.after,
      );

      if (!quantity.ok) {
        throw new Error(quantity.error.message);
      }

      const event = repositories.inventory.appendEvent(change.event);

      if (!event.ok) {
        throw new Error(event.error.message);
      }
    });
  } catch (cause) {
    return fail({
      kind: "persistence",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }

  return succeed({ kind: "inventory", change });
}

/**
 * Persists a spend: the expense record and the reduced balance, together.
 *
 * Atomic because the PRD's promise is a single fact — "the correct balance is reduced and the
 * entry is stored". An account that lost money with no expense row is money that vanished,
 * which is precisely the failure the event-log design exists to prevent.
 */
function persistExpenseChange(
  repositories: Repositories,
  change: ExpenseChange,
): ExecutionResult {
  try {
    repositories.transaction(() => {
      const record = repositories.expenses.insert(change.expense);

      if (!record.ok) {
        throw new Error(record.error.message);
      }

      const balance = repositories.accounts.saveBalance(
        change.accountId,
        change.after,
      );

      if (!balance.ok) {
        throw new Error(balance.error.message);
      }
    });
  } catch (cause) {
    return fail({
      kind: "persistence",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }

  return succeed({ kind: "expense", change });
}

/**
 * Executes a command against real persistence.
 *
 * Takes `unknown` rather than `Command` on purpose. The types already stop a bad command
 * reaching this function, but the real caller is a request handler holding a parsed model
 * response, and re-checking here means skipping validation is a runtime failure rather than
 * something a future refactor can quietly introduce. A command that fails validation is
 * reported as `kind: "validation"` and never reaches a repository.
 */
export function executeCommand(
  input: unknown,
  dependencies: ExecutionDependencies,
): ExecutionResult {
  const parsed = parseCommand(input);

  if (!parsed.ok) {
    return fail({ kind: "validation", issues: parsed.error.issues });
  }

  const command = parsed.value;
  const { repositories, now } = dependencies;

  if (command.kind === "task.create") {
    return executeTaskCreate(command, dependencies);
  }

  if (command.kind === "task.set_done") {
    return executeTaskSetDone(command, dependencies);
  }

  if (command.kind === "sleep.record") {
    return executeSleepRecord(command, dependencies);
  }

  if (command.kind === "skill.create") {
    return executeSkillCreate(command, dependencies);
  }

  if (command.kind === "skill.log") {
    return executeSkillLog(command, dependencies);
  }

  if (command.kind === "habit.record") {
    return executeHabitRecord(command, dependencies);
  }

  if (command.kind === "private.log") {
    return executePrivateLog(command, dependencies);
  }

  if (command.kind === "nap.start") {
    return executeNapStart(command, dependencies);
  }

  if (command.kind === "nap.end") {
    return executeNapEnd(command, dependencies);
  }

  if (command.kind === "expense.record") {
    const account = repositories.accounts.findByName(command.accountName);

    if (!account.ok) {
      return domainFailure(account.error);
    }

    // Both the account id and the timestamp come from here. The command supplied neither.
    const [resolvedAccount, expenseInput] = expenseArguments(
      command,
      account.value,
      now(),
    );
    const change = applyExpense(resolvedAccount, expenseInput);

    if (!change.ok) {
      return domainFailure(change.error);
    }

    return persistExpenseChange(repositories, change.value);
  }

  const item = repositories.inventory.findByName(command.itemName);

  if (!item.ok) {
    return domainFailure(item.error);
  }

  const resolved = item.value;

  const computed =
    command.kind === "inventory.consume"
      ? applyConsume(command, resolved)
      : command.kind === "inventory.restock"
        ? applyRestock(command, resolved)
        : command.kind === "inventory.recount_after_use"
          ? recountAfterUse(...recountAfterUseArguments(command, resolved))
          : setInventoryQuantity(...setQuantityArguments(command, resolved));

  if (!computed.ok) {
    return domainFailure(computed.error);
  }

  // The event carries the moment execution happened and the sentence it came from. The
  // domain was told neither, because neither is a fact about the stock.
  return persistInventoryChange(
    repositories,
    stampInventoryChange(computed.value, now(), command.sourceText ?? null),
  );
}

/**
 * The calendar day this execution is happening on.
 *
 * Derived from the same clock that stamps inventory events, so a task written at 23:50 and an
 * expense recorded at 23:50 cannot be filed on different days by two different readings of
 * "now". The command never supplied a date, and neither does this: the stated `day` reference
 * and this timestamp are the only two things that can decide it.
 */
function todayFrom(dependencies: ExecutionDependencies): Result<string> {
  return calendarDateOf(dependencies.now());
}

/**
 * Plans a task.
 *
 * A duplicate is refused by asking the repository first rather than by catching the schema's
 * UNIQUE violation, so the user hears "that is already on tomorrow's list" instead of a
 * constraint message. Both refuse the write, which is the part that matters.
 */
function executeTaskCreate(
  command: Extract<Command, { kind: "task.create" }>,
  dependencies: ExecutionDependencies,
): ExecutionResult {
  const { repositories } = dependencies;
  const today = todayFrom(dependencies);

  if (!today.ok) {
    return domainFailure(today.error);
  }

  const date = resolveDayReference(command.day ?? null, today.value);

  if (!date.ok) {
    return domainFailure(date.error);
  }

  const created = createTask({ date: date.value, title: command.title });

  if (!created.ok) {
    return domainFailure(created.error);
  }

  const existing = repositories.tasks.findByDateAndTitle(
    created.value.date,
    created.value.title,
  );

  if (existing.ok) {
    return domainFailure({
      code: "duplicate_task",
      message: `"${created.value.title}" is already planned for ${created.value.date}.`,
      detail: { title: created.value.title, date: created.value.date },
    });
  }

  try {
    const id = repositories.transaction(() => {
      const stored = repositories.tasks.insertTask(created.value);

      if (!stored.ok) {
        throw new Error(stored.error.message);
      }

      return stored.value;
    });

    return succeed({
      kind: "task",
      change: {
        kind: "task",
        task: {
          id,
          date: created.value.date,
          title: created.value.title,
          done: false,
        },
        after: false,
      },
    });
  } catch (cause) {
    return fail({
      kind: "persistence",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/** Marks a planned task done or not done. The row is found by title and day, never by id. */
function executeTaskSetDone(
  command: Extract<Command, { kind: "task.set_done" }>,
  dependencies: ExecutionDependencies,
): ExecutionResult {
  const { repositories } = dependencies;
  const today = todayFrom(dependencies);

  if (!today.ok) {
    return domainFailure(today.error);
  }

  const date = resolveDayReference(command.day ?? null, today.value);

  if (!date.ok) {
    return domainFailure(date.error);
  }

  const task = repositories.tasks.findByDateAndTitle(date.value, command.title);

  if (!task.ok) {
    return domainFailure(task.error);
  }

  const change = setTaskDone(task.value, command.done);

  if (!change.ok) {
    return domainFailure(change.error);
  }

  try {
    repositories.transaction(() => {
      const saved = repositories.tasks.saveTaskDone(
        task.value.id,
        change.value.after,
      );

      if (!saved.ok) {
        throw new Error(saved.error.message);
      }
    });
  } catch (cause) {
    return fail({
      kind: "persistence",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }

  return succeed({ kind: "task", change: change.value });
}

/**
 * Records one stated time of a night.
 *
 * Creating the row and setting the field are one transaction, so a night can never be left
 * existing with nothing in it — the state that would make "has the user logged a bedtime?"
 * ambiguous.
 */
function executeSleepRecord(
  command: Extract<Command, { kind: "sleep.record" }>,
  dependencies: ExecutionDependencies,
): ExecutionResult {
  const { repositories } = dependencies;
  const today = todayFrom(dependencies);

  if (!today.ok) {
    return domainFailure(today.error);
  }

  const date = resolveDayReference(command.day ?? null, today.value);

  if (!date.ok) {
    return domainFailure(date.error);
  }

  const existing = repositories.sleep.findNight(date.value) ?? {
    date: date.value,
    bedtime: null,
    sleepTime: null,
    wakeTime: null,
    phoneOutside: false,
  };
  const change = recordNightTime(existing, command.field, command.time);

  if (!change.ok) {
    return domainFailure(change.error);
  }

  try {
    repositories.transaction(() => {
      const created = repositories.sleep.ensureNight(date.value);

      if (!created.ok) {
        throw new Error(created.error.message);
      }

      // The parsed time comes from the domain, not from a lookup back through the night, and
      // it cannot be absent: `recordNightTime` refuses a time it cannot parse.
      const parsed = change.value.kind === "night" ? change.value.time : null;

      if (parsed === null) {
        throw new Error("The night change carried no time to store.");
      }

      const saved = repositories.sleep.saveNightTime(
        date.value,
        command.field,
        parsed,
      );

      if (!saved.ok) {
        throw new Error(saved.error.message);
      }
    });
  } catch (cause) {
    return fail({
      kind: "persistence",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }

  return succeed({ kind: "sleep", change: change.value });
}

function executeNapStart(
  command: Extract<Command, { kind: "nap.start" }>,
  dependencies: ExecutionDependencies,
): ExecutionResult {
  const { repositories } = dependencies;
  const today = todayFrom(dependencies);

  if (!today.ok) {
    return domainFailure(today.error);
  }

  const date = resolveDayReference(command.day ?? null, today.value);

  if (!date.ok) {
    return domainFailure(date.error);
  }

  // The most recent nap for that day, and only that one, is what makes "there is already a nap
  // running" answerable without inventing a status column.
  const last = repositories.naps.lastNapForDate(date.value);
  const change = startNap(last !== null && last.end === null ? last : null, {
    date: date.value,
    start: command.time,
  });

  if (!change.ok) {
    return domainFailure(change.error);
  }

  try {
    const id = repositories.transaction(() => {
      const stored = repositories.naps.insertNap(date.value, command.time);

      if (!stored.ok) {
        throw new Error(stored.error.message);
      }

      return stored.value;
    });

    return succeed({
      kind: "sleep",
      change: {
        kind: "nap",
        nap: { id, date: date.value, start: command.time, end: null },
      },
    });
  } catch (cause) {
    return fail({
      kind: "persistence",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function executeNapEnd(
  command: Extract<Command, { kind: "nap.end" }>,
  dependencies: ExecutionDependencies,
): ExecutionResult {
  const { repositories } = dependencies;
  const today = todayFrom(dependencies);

  if (!today.ok) {
    return domainFailure(today.error);
  }

  const date = resolveDayReference(command.day ?? null, today.value);

  if (!date.ok) {
    return domainFailure(date.error);
  }

  const last = repositories.naps.lastNapForDate(date.value);
  const change = endNap(last, command.time);

  if (!change.ok) {
    return domainFailure(change.error);
  }

  try {
    repositories.transaction(() => {
      const closed = last as NapLog;
      const saved = repositories.naps.saveNapEnd(closed.id, command.time);

      if (!saved.ok) {
        throw new Error(saved.error.message);
      }
    });
  } catch (cause) {
    return fail({
      kind: "persistence",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }

  return succeed({ kind: "sleep", change: change.value });
}

// Narrow, typed wrappers. The command union discriminates on `kind`, and routing through the
// 1.3 argument mappings keeps the exact domain signature visible at the call site rather than
// spread across a switch.
function applyConsume(
  command: Extract<Command, { kind: "inventory.consume" }>,
  item: InventoryItem,
) {
  return consumeInventory(...consumeArguments(command, item));
}

function applyRestock(
  command: Extract<Command, { kind: "inventory.restock" }>,
  item: InventoryItem,
) {
  return restockInventory(...restockArguments(command, item));
}

/**
 * Adds a skill to the user's list.
 *
 * The limit and the duplicate check both come from the domain, which is handed the stored list so
 * the decision is made from real rows. This function's only job is to supply those rows and write
 * the skill the domain returned.
 *
 * Note what is absent: nothing here sets a position, a category, or an order. The new skill goes
 * to the end of the user's list because that is the order they added things in, and no
 * preference is recorded.
 */
function executeSkillCreate(
  command: Extract<Command, { kind: "skill.create" }>,
  dependencies: ExecutionDependencies,
): ExecutionResult {
  const { repositories } = dependencies;

  const created = createSkill(
    { name: command.name },
    repositories.skills.listAll(),
  );

  if (!created.ok) {
    return domainFailure(created.error);
  }

  try {
    const stored = repositories.skills.insert(created.value.name);

    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    return succeed({
      kind: "skill",
      change: { action: "created", skill: stored.value },
    });
  } catch (cause) {
    return fail({
      kind: "persistence",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * Records one use of a skill.
 *
 * The skill is found by the name the user said, and the timestamp is the execution clock's — the
 * same clock the inventory events use, so nothing in the application stamps a log entry from a
 * time it inferred itself. An unrecognised name is `unknown_skill`, never a new skill: creating
 * one from a chat sentence would let a typo quietly become part of the user's list.
 */
function executeSkillLog(
  command: Extract<Command, { kind: "skill.log" }>,
  dependencies: ExecutionDependencies,
): ExecutionResult {
  const { repositories, now } = dependencies;
  const skill = repositories.skills.findByName(command.skillName);

  if (skill === null) {
    return domainFailure({
      code: "unknown_skill",
      message: `"${command.skillName}" is not on the skills list.`,
      detail: { name: command.skillName },
    });
  }

  const logged = logSkillUse(skill, { minutes: command.minutes ?? null });

  if (!logged.ok) {
    return domainFailure(logged.error);
  }

  try {
    const stored = repositories.skills.appendLog(
      skill.id,
      now(),
      logged.value.minutes,
    );

    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    return succeed({
      kind: "skill",
      change: { action: "logged", skill, log: stored.value },
    });
  } catch (cause) {
    return fail({
      kind: "persistence",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * Records a habit for a day.
 *
 * **The laundry photo is the interesting part.** The PRD requires one, and it arrives through
 * `POST /api/photos`, so this command cannot supply it. The executor therefore does not take the
 * user's word for it: it asks the repository whether a photo is already attached to that day's
 * laundry row, and passes that as the proof flag. A sentence that claims laundry is done without a
 * photo is stored as not done with a spoken reason, because the domain refuses it — the claim was
 * true as far as the sentence went and incomplete as far as the requirement goes.
 *
 * A replacement row keeps the photo the previous row had. Deleting it would orphan a file the user
 * uploaded and make a correction unrecoverable, which PRD principle 13 rules out.
 *
 * `habit_log` has no timestamp column, so `now()` is not called here: a habit is about a day, not
 * a moment, and reading the clock for a value nothing stores would be noise.
 */
function executeHabitRecord(
  command: Extract<Command, { kind: "habit.record" }>,
  dependencies: ExecutionDependencies,
): ExecutionResult {
  const { repositories } = dependencies;
  const today = todayFrom(dependencies);

  if (!today.ok) {
    return domainFailure(today.error);
  }

  const date = resolveDayReference(command.day ?? null, today.value);

  if (!date.ok) {
    return domainFailure(date.error);
  }

  const existing = repositories.habits.findForDay(date.value, command.type);
  const change = recordHabit({
    date: date.value,
    type: command.type,
    done: command.done,
    minutes: command.minutes ?? null,
    hasPhotoProof:
      command.type === "laundry" &&
      existing !== null &&
      existing.photoUrl !== null,
  });

  if (!change.ok) {
    return domainFailure(change.error);
  }

  /**
   * Re-recording a day rewrites the row and keeps the photo.
   *
   * The photo and the note are carried across explicitly, and both are there for the same reason:
   * a habit statement is an assertion about one day, and replacing it must not delete the
   * evidence and the words that go with it. The row is updated rather than replaced — see
   * `updateHabitForDay` for why an entry's id has to stay with its entry.
   */
  const replacement: HabitLog = {
    ...change.value.habit,
    photoUrl: existing?.photoUrl ?? null,
    photoNote: existing?.photoNote ?? null,
  };

  try {
    const saved = repositories.transaction(() => {
      if (existing !== null) {
        const updated = repositories.habits.updateHabitForDay(
          date.value,
          command.type,
          {
            done: replacement.done,
            photoUrl: replacement.photoUrl,
            photoNote: replacement.photoNote,
            minutes: replacement.minutes,
          },
        );

        if (!updated.ok) {
          throw new Error(updated.error.message);
        }

        return updated.value;
      }

      const stored = repositories.habits.insertHabit(replacement);

      if (!stored.ok) {
        throw new Error(stored.error.message);
      }

      return stored.value;
    });

    return succeed({
      kind: "habit",
      change: { ...change.value, habit: saved },
    });
  } catch (cause) {
    return fail({
      kind: "persistence",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * Writes one private entry.
 *
 * `happened: false` is not stored. The PRD asks for a yes/no, and the useful reading of "no" is
 * that there is nothing to write down: a row saying "did not happen" would become an entry, and
 * entries are what the page lists. So a negative answer **deletes** the day's entry for that type
 * if one exists, which is also the only way to correct a mistaken entry.
 *
 * Deleting rather than rewriting is the point: a private log that keeps rows marked "did not
 * happen" is a list that grows with the number of times nothing occurred, and every count drawn
 * from it would be a count of entries the user never made.
 *
 * Nothing here computes a count, and the outcome carries no number the user could read back as
 * one. `now()` is not even called: the entry is dated by the day reference, and the stored row has
 * no timestamp column to fill.
 */
function executePrivateLog(
  command: Extract<Command, { kind: "private.log" }>,
  dependencies: ExecutionDependencies,
): ExecutionResult {
  const { repositories } = dependencies;
  const today = todayFrom(dependencies);

  if (!today.ok) {
    return domainFailure(today.error);
  }

  const date = resolveDayReference(command.day ?? null, today.value);

  if (!date.ok) {
    return domainFailure(date.error);
  }

  const existing = repositories.privateLog.findForDay(date.value, command.type);

  if (!command.happened) {
    if (existing !== null) {
      try {
        repositories.transaction(() => {
          const removed = repositories.privateLog.removeForDay(
            date.value,
            command.type,
          );

          if (!removed.ok) {
            throw new Error(removed.error.message);
          }
        });
      } catch (cause) {
        return fail({
          kind: "persistence",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }

    return succeed({
      kind: "private",
      change: { date: date.value, type: command.type, happened: false },
    });
  }

  const entry = recordPrivateEntry({
    date: date.value,
    type: command.type,
    note: command.note ?? null,
  });

  if (!entry.ok) {
    return domainFailure(entry.error);
  }

  try {
    const stored = repositories.transaction(() => {
      const written = repositories.privateLog.insertEntry(entry.value);

      if (!written.ok) {
        throw new Error(written.error.message);
      }

      return written.value;
    });

    return succeed({
      kind: "private",
      change: { date: stored.date, type: stored.type, happened: true },
    });
  } catch (cause) {
    return fail({
      kind: "persistence",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
