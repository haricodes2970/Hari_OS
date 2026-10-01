/**
 * The structured command contract.
 *
 * This is the shape a future parser must produce, and the only shape the application will
 * ever act on. Natural language enters the system at the top and stops here: everything below
 * this file receives structured facts.
 *
 * **The contract holds facts, never prose.** A command says "consume 2 piece of onions", not
 * "used 2 onions". The original sentence travels alongside as `sourceText` purely so the
 * application can show the user what it understood, which is what makes a wrong parse
 * correctable. Nothing ever reads `sourceText` to decide what a command means.
 *
 * **Nothing here computes an outcome.** A command carries a quantity or an amount because
 * that is a fact the user stated. The balance after a spend, and the stock after a
 * consumption, are calculated later in `src/domain`. The PRD is explicit that the model
 * interprets and proposes while deterministic code decides and persists, so no field here
 * may be derived, and no command may name a result.
 *
 * This file is types only. There is no runtime behaviour, which is deliberate: the contract
 * is a shared vocabulary, and a module that merely declares one cannot acquire a side effect.
 * Runtime enforcement lives in `src/lib/validation`.
 *
 * ## Why there is a version field
 *
 * These objects are produced by a language model working from a prompt, so the shape of
 * what comes back can change when the prompt changes. Without a version marker, a payload
 * from an older prompt would be validated field by field and could be silently reinterpreted
 * as a different command — for example, an `amount` that used to mean rupees and now means
 * minor units. One required field that must equal the current version lets the validator
 * reject that outright. It is a single literal, with no compatibility machinery and no
 * support for any version but the current one (ADR-030).
 */
import type { AccountName } from "@/domain/accounts";
import type { MinorUnits } from "@/domain/money";
import type { Quantity } from "@/domain/quantity";
import type { LoggableHabitType, PrivateType } from "@/domain/habits";
import type { DayReference } from "@/domain/routine";
import type { SleepField } from "@/domain/sleep";

/**
 * The only contract version that exists.
 *
 * A payload carrying anything else is rejected rather than adapted. Supporting a second
 * version later would be a deliberate, separate decision.
 */
export const COMMAND_VERSION = 1;

/** Fields every command carries, whatever it does. */
export type CommandBase = {
  /** Must equal `COMMAND_VERSION`. See the note above on why this exists. */
  readonly version: typeof COMMAND_VERSION;
  /**
   * The sentence this was derived from, kept for display and correction.
   *
   * Optional, and never interpreted. `null` is correct for a command built by a form rather
   * than by chat, so requiring it would be wrong.
   */
  readonly sourceText?: string | null;
};

/**
 * Identifies a tracked item by name.
 *
 * A name, not a database id. A language model reading "used 2 onions" cannot know an id, and
 * asking one to invent one would be asking it to fabricate a fact. Resolving a name to a row
 * is execution's job, in a later micro-phase, and is a `missing_account`-style domain failure
 * when nothing matches — not a validation failure.
 */
export type ItemReference = {
  readonly itemName: string;
};

/** Consumes stock: the PRD's "used 2 onions". */
export type InventoryConsumeCommand = CommandBase &
  ItemReference & {
    readonly kind: "inventory.consume";
    /** How much to remove, in the item's own unit. */
    readonly amount: Quantity;
    /**
     * The unit the user implied.
     *
     * Carried because it can disagree with how the item is tracked, and that disagreement is
     * exactly what the user needs to be told. Checking it needs the item, so it happens at
     * execution.
     */
    readonly unit: string;
  };

/** Adds stock: the PRD's restock after buying groceries. */
export type InventoryRestockCommand = CommandBase &
  ItemReference & {
    readonly kind: "inventory.restock";
    readonly amount: Quantity;
    readonly unit: string;
  };

/**
 * States what is on the shelf now, as an absolute count: the PRD's "I had 10 onions".
 *
 * Deliberately not a movement. A recount and a purchase of the same amount mean different
 * things to the user's history, and the resulting delta is derived later by the domain.
 */
export type InventorySetQuantityCommand = CommandBase &
  ItemReference & {
    readonly kind: "inventory.set_quantity";
    readonly quantity: Quantity;
  };

/**
 * The PRD's compound sentence: "I had 10 onions, used 2", which leaves 8.
 *
 * One command, two stated facts, and deliberately **no resulting quantity**. `countedQuantity`
 * and `usedAmount` are both things the user said, so a language model may report either; `8`
 * is the difference between them and is therefore the one thing it may never report. `src/domain`
 * subtracts. That is why this command exists rather than being handled by two commands in a
 * row: applying them separately would need the executor to hold intermediate state across
 * submissions, and a batch of commands would let one model response move stock twice.
 *
 * The unit is carried for the same reason as on `inventory.consume` — it can disagree with how
 * the item is tracked, and that disagreement is what the user needs to hear about.
 */
export type InventoryRecountAfterUseCommand = CommandBase &
  ItemReference & {
    readonly kind: "inventory.recount_after_use";
    /** The count the user stated, before the use. */
    readonly countedQuantity: Quantity;
    /** How much they then used, in the item's own unit. */
    readonly usedAmount: Quantity;
    readonly unit: string;
  };

/**
 * Records a spend: the PRD's "bought banana 10 rupees cash".
 *
 * `accountName` is the account as the user said it, and `amount` is already in whole minor
 * units. Both are facts, not results: the contract does not carry the account's current
 * balance and does not state what the balance becomes.
 *
 * Converting "10 rupees" into minor units is not this layer's job either. Whoever produced
 * this command had a decimal amount to read, and `toMinorUnits` in `src/domain` is the only
 * correct way to do that conversion — a parser that divided by 100 itself would be doing
 * arithmetic it has no business doing.
 */
export type ExpenseRecordCommand = CommandBase & {
  readonly kind: "expense.record";
  readonly accountName: AccountName;
  /** What was bought, as the user said it. */
  readonly item: string;
  readonly amount: MinorUnits;
  /** Optional in the PRD, so optional here. Absent means "not categorised". */
  readonly category?: string | null;
};

export type InventoryCommand =
  | InventoryConsumeCommand
  | InventoryRestockCommand
  | InventorySetQuantityCommand
  | InventoryRecountAfterUseCommand;

export type ExpenseCommand = ExpenseRecordCommand;

/**
 * Plans a task for a day: the PRD's "tomorrow I need to finish the report".
 *
 * `day` is the one field here that looks like a time and is not. It is a **stated** day
 * reference — "tomorrow", "today", "yesterday" — not a date. A date is a conclusion drawn
 * from that word and a clock, and only the application may draw it, so the model reports the
 * word and `src/domain/routine.ts` resolves it against the server's current day. This is the
 * smallest representation that lets a sentence place a task on the right day without the
 * model ever emitting a timestamp.
 *
 * `title` is what the user said the task is. It is not a priority, a rank, or an ordering
 * instruction: the order tasks are written in is the order they matter in.
 */
export type TaskCreateCommand = CommandBase & {
  readonly kind: "task.create";
  readonly title: string;
  /** Absent means today, which is a documented default rather than an inference. */
  readonly day?: DayReference | null;
};

/** Marks a planned task done or not done. */
export type TaskSetDoneCommand = CommandBase & {
  readonly kind: "task.set_done";
  readonly title: string;
  /** The completion the user stated. Both values are facts; neither is a decision. */
  readonly done: boolean;
  readonly day?: DayReference | null;
};

/**
 * Records one stated time of a night: bedtime, the time sleep began, or the wake time.
 *
 * `time` is a wall-clock `HH:MM` the user said. It is **not** the moment the command was
 * received: "went to bed at 11" and "posted at 23:04" are different facts, and conflating
 * them would let a check-in written at 1 AM book a wake time an hour before bedtime. The
 * execution timestamp stays where it has always been — the server's clock, never this
 * command's — and the duration between two stated times is computed in `src/domain/sleep.ts`.
 *
 * `day` selects **the night**, meaning the day the night began.
 */
export type SleepRecordCommand = CommandBase & {
  readonly kind: "sleep.record";
  readonly field: SleepField;
  readonly time: string;
  readonly day?: DayReference | null;
};

/** Opens a nap. The end time is a separate command, because it arrives separately. */
export type NapStartCommand = CommandBase & {
  readonly kind: "nap.start";
  readonly time: string;
  readonly day?: DayReference | null;
};

/**
 * Closes the most recent nap on that day.
 *
 * No id: the model cannot know one, and the row is found by being the last nap. Ending a
 * nap that is not open is a domain refusal, not a guess about which one was meant.
 */
export type NapEndCommand = CommandBase & {
  readonly kind: "nap.end";
  readonly time: string;
  readonly day?: DayReference | null;
};

export type RoutineCommand =
  | TaskCreateCommand
  | TaskSetDoneCommand
  | SleepRecordCommand
  | NapStartCommand
  | NapEndCommand;

export type SleepCommand = SleepRecordCommand | NapStartCommand | NapEndCommand;

/**
 * Adds one of the user's own skills: PRD 6.5, "add my own skills".
 *
 * `name` is the user's own words, not a catalogue entry. Nothing else is carried — no category,
 * no icon, no order, no default, because the list's meaning is that it is the user's, and every
 * one of those fields would be a place for the application to express a preference.
 */
export type SkillCreateCommand = CommandBase & {
  readonly kind: "skill.create";
  readonly name: string;
};

/**
 * Records that one of the user's skills was done, optionally for a stated length of time.
 *
 * `skillName` is the name as the user said it, resolved to a row at execution; `unknown_skill`
 * is the honest answer when nothing matches, and inventing a skill would be worse than the
 * refusal. `minutes` is a fact the user stated, present only when they said it — the duration is
 * never derived from the difference between two timestamps, because when a skill started is not
 * something the application observes.
 */
export type SkillLogCommand = CommandBase & {
  readonly kind: "skill.log";
  readonly skillName: string;
  readonly minutes?: number | null;
};

/**
 * Records what the user said about one habit for one day.
 *
 * `type` is the habit they named. `done` is their statement, and for `screen_time` it is always
 * `true` — a measurement is not something that did not happen, which is why the domain forces it
 * rather than trusting the field.
 *
 * **`hasPhotoProof` is not a command field and is deliberately absent.** The PRD requires a photo
 * for laundry completion, and that photo arrives through `POST /api/photos`, not through chat.
 * A sentence cannot carry a file, so a command that claims a photo exists would be claiming
 * something it cannot know. The executor passes proof only when the photo row for that day was
 * actually written, which is why `habit.record` records laundry as not done rather than trusting
 * the claim.
 */
export type HabitRecordCommand = CommandBase & {
  readonly kind: "habit.record";
  readonly type: LoggableHabitType;
  readonly done: boolean;
  /** The user's own estimate of screen time. Ignored by the other three types. */
  readonly minutes?: number | null;
  readonly day?: DayReference | null;
};

/**
 * Writes one private entry: PRD 6.6's yes/no plus optional note.
 *
 * `type` is one of the two private behaviours, `note` is the user's own words and is optional,
 * and **there is no field for a count.** That absence is the contract's part of the PRD's rule
 * that a private entry is never a streak, a score, or a bar: if there were nowhere to state one,
 * a parser could not report one and no downstream code could sum them.
 */
export type PrivateLogCommand = CommandBase & {
  readonly kind: "private.log";
  readonly type: PrivateType;
  readonly happened: boolean;
  readonly note?: string | null;
  readonly day?: DayReference | null;
};

export type SkillsCommand = SkillCreateCommand | SkillLogCommand;

export type HabitsCommand = HabitRecordCommand;

export type PrivateCommand = PrivateLogCommand;

/**
 * Every command the application can act on.
 *
 * The families added in Phase 6 and Phase 7 carry the same discipline as the first two: a
 * stated time is a fact the user gave, a duration is never a field, a priority is never a field,
 * and no field names a result. What the model may extract is *which* time the user said, *what*
 * the task is, and *which* skill, habit, or private behaviour the user named. Everything else is
 * computed by `src/domain`.
 *
 * Two Phase 7 absences are deliberate rather than unfinished: no command can claim a photo
 * exists, and no private command can carry a count.
 */
export type Command =
  | InventoryCommand
  | ExpenseCommand
  | RoutineCommand
  | SleepCommand
  | SkillsCommand
  | HabitsCommand
  | PrivateCommand;

export type CommandKind = Command["kind"];

/** Every kind, for validation and for error messages that list what was expected. */
export const COMMAND_KINDS: readonly CommandKind[] = [
  "inventory.consume",
  "inventory.restock",
  "inventory.set_quantity",
  "inventory.recount_after_use",
  "expense.record",
  "task.create",
  "task.set_done",
  "sleep.record",
  "nap.start",
  "nap.end",
  "skill.create",
  "skill.log",
  "habit.record",
  "private.log",
];

/** Narrows an untrusted value's `kind` without validating the rest of the object. */
export function isCommandKind(value: unknown): value is CommandKind {
  return (
    typeof value === "string" &&
    (COMMAND_KINDS as readonly string[]).includes(value)
  );
}
