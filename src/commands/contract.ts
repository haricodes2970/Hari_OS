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
 * Every command the application can act on.
 *
 * Only the two families with a deterministic domain operation and a real user sentence
 * behind them are modelled. Routine, sleep, skills, and habits are absent on purpose: no
 * domain operation exists for them, so a command type would have no execution path and would
 * be a promise the code cannot keep.
 */
export type Command = InventoryCommand | ExpenseCommand;

export type CommandKind = Command["kind"];

/** Every kind, for validation and for error messages that list what was expected. */
export const COMMAND_KINDS: readonly CommandKind[] = [
  "inventory.consume",
  "inventory.restock",
  "inventory.set_quantity",
  "inventory.recount_after_use",
  "expense.record",
];

/** Narrows an untrusted value's `kind` without validating the rest of the object. */
export function isCommandKind(value: unknown): value is CommandKind {
  return (
    typeof value === "string" &&
    (COMMAND_KINDS as readonly string[]).includes(value)
  );
}
