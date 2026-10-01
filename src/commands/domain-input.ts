/**
 * Mapping from a validated command to a domain operation's arguments.
 *
 * These are pure translations and nothing else. Each one takes a command that has already
 * passed `parseCommand` plus the state the command refers to, and returns exactly the
 * arguments the corresponding `src/domain` operation expects. No lookup, no arithmetic, no
 * execution, no persistence — the result is a tuple, not a change.
 *
 * Two facts make this file necessary rather than decorative:
 *
 * - **A command names an account, the domain takes an id.** "cash" has to become the row the
 *   user actually has, and inventing an id at the command layer would be inventing data.
 * - **A command has no timestamp, the domain requires one.** "bought banana 10 rupees cash"
 *   happened at the moment the user logged it, which is not the moment a language model
 *   finished responding. The timestamp is supplied by whoever runs the command.
 *
 * Existence checks are absent by design. Resolving `itemName` to an `InventoryItem` needs the
 * database and belongs to a later micro-phase; these functions simply require the caller to
 * have already done it, and to handle a miss as a domain failure.
 */
import type { Account, ExpenseInput } from "../domain/accounts.ts";
import type { InventoryItem } from "../domain/inventory.ts";
import type { MinorUnits } from "../domain/money.ts";
import type { Quantity } from "../domain/quantity.ts";
import {
  consumeInventory,
  restockInventory,
  setInventoryQuantity,
} from "../domain/inventory.ts";
import { applyExpense } from "../domain/accounts.ts";
import { recountAfterUse } from "../domain/inventory.ts";
import type {
  ExpenseRecordCommand,
  InventoryConsumeCommand,
  InventoryRecountAfterUseCommand,
  InventoryRestockCommand,
  InventorySetQuantityCommand,
} from "./contract.ts";

/**
 * Compile-time proof that each command lines up with the domain operation it feeds.
 *
 * `Parameters<typeof consumeInventory>` is the exact argument list the domain demands, so if
 * a command's shape ever drifts — a field renamed, a unit removed — this stops compiling
 * before any runtime test notices. It costs nothing at runtime and cannot rot silently, which
 * is the failure mode a hand-maintained comment in a test would have.
 */
type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/** Arguments for `consumeInventory(item, amount, unit)`. */
export function consumeArguments(
  command: InventoryConsumeCommand,
  item: InventoryItem,
): [InventoryItem, Quantity, string] {
  return [item, command.amount, command.unit];
}

/** Arguments for `restockInventory(item, amount, unit)`. */
export function restockArguments(
  command: InventoryRestockCommand,
  item: InventoryItem,
): [InventoryItem, Quantity, string] {
  return [item, command.amount, command.unit];
}

/** Arguments for `setInventoryQuantity(item, quantity)`. */
export function setQuantityArguments(
  command: InventorySetQuantityCommand,
  item: InventoryItem,
): [InventoryItem, Quantity] {
  return [item, command.quantity];
}

/**
 * Arguments for `recountAfterUse(item, countedQuantity, usedAmount, unit)`.
 *
 * Both quantities come from the command unchanged. The difference between them is computed by
 * the domain, so there is no place in this layer where the two could be combined.
 */
export function recountAfterUseArguments(
  command: InventoryRecountAfterUseCommand,
  item: InventoryItem,
): [InventoryItem, Quantity, Quantity, string] {
  return [item, command.countedQuantity, command.usedAmount, command.unit];
}

/**
 * Arguments for `applyExpense(account, input)`.
 *
 * `accountId` comes from the resolved account rather than the command, so a command can never
 * claim to spend from an account the caller did not hand over. The timestamp is the caller's
 * for the same reason.
 */
export function expenseArguments(
  command: ExpenseRecordCommand,
  account: Account,
  timestamp: string,
): [Account, ExpenseInput] {
  const input: ExpenseInput = {
    item: command.item,
    amount: command.amount as MinorUnits,
    accountId: account.id,
    timestamp,
    category: command.category ?? null,
  };

  return [account, input];
}

// These are type-level assertions. They are erased at build time and enforce nothing at
// runtime, so nothing here can execute a domain operation.
export type ConsumeArgumentsMatchDomain = Expect<
  Equal<
    ReturnType<typeof consumeArguments>,
    Parameters<typeof consumeInventory>
  >
>;
export type RestockArgumentsMatchDomain = Expect<
  Equal<
    ReturnType<typeof restockArguments>,
    Parameters<typeof restockInventory>
  >
>;
export type SetQuantityArgumentsMatchDomain = Expect<
  Equal<
    ReturnType<typeof setQuantityArguments>,
    Parameters<typeof setInventoryQuantity>
  >
>;
export type RecountAfterUseArgumentsMatchDomain = Expect<
  Equal<
    ReturnType<typeof recountAfterUseArguments>,
    Parameters<typeof recountAfterUse>
  >
>;
export type ExpenseArgumentsMatchDomain = Expect<
  Equal<ReturnType<typeof expenseArguments>, Parameters<typeof applyExpense>>
>;
