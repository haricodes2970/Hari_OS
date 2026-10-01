/**
 * Kitchen setup: the operations that are deliberately **not** commands.
 *
 * ## Why these do not go through the command contract
 *
 * Everything that *moves stock* is a command, and already was: consume, restock, recount,
 * and correction all enter through `runCommand` and are validated, computed by `src/domain`,
 * and logged by the executor. That path is not widened here.
 *
 * The three operations in this file are different in kind. Starting to track an item, changing
 * what "low" means for it, and correcting its spelling change **no quantity**, so there is no
 * movement to log, no before-and-after to record, and nothing for a language model to have
 * stated. Forcing them through the command contract would mean inventing a command kind per
 * administrative action, and — worse — a model could then be asked to produce them, which
 * would make "rename this item" something a sentence can trigger. ADR-039 already made this
 * call for initial setup; this file applies the same reasoning to the rest.
 *
 * What they still obey, without exception:
 *
 * - the domain decides. `createInventoryItem`, `setLowStockThreshold`, and
 *   `editInventoryDetails` are called for their validation, and this file adds no rule of its
 *   own;
 * - failures are structured. A refusal is returned as an `ExecutionError` of kind `domain`,
 *   which is the same vocabulary the executor uses, so `describeResult` renders it with the
 *   existing wording instead of a second set of sentences;
 * - persistence failures are reported as such, never swallowed;
 * - nothing is computed here. No quantity, no threshold arithmetic, no unit conversion.
 *
 * Server-only.
 */
import "server-only";

import type { InventoryItem } from "@/domain/inventory";
import type { InventoryEventRow } from "@/lib/db/repositories";
import {
  createInventoryItem,
  editInventoryDetails,
  setLowStockThreshold,
} from "@/domain/inventory";
import type { Quantity } from "@/domain/quantity";
import type { DomainError } from "@/domain/result";
import type { ExecutionError } from "@/commands/executor";

import {
  getRepositories,
  nowTimestamp,
  releaseDatabase,
} from "../shared/command-runtime.ts";

/**
 * The outcome shape shared with the executor, so `describeResult` renders these results with
 * the wording Phase 1 and Phase 2 already established.
 */
export type KitchenResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly error: ExecutionError };

function saved(message: string): KitchenResult {
  return { ok: true, message };
}

/**
 * Wraps a domain refusal as an execution error of kind `domain`.
 *
 * The cast is safe because `Result`'s failure branch carries exactly a `DomainError`, which is
 * what the `domain` branch of `ExecutionError` expects. Nothing is being reinterpreted: the
 * same error object travels, in the vocabulary the renderer already understands.
 */
function refused(result: {
  readonly ok: false;
  readonly error: DomainError;
}): KitchenResult {
  return {
    ok: false,
    error: { kind: "domain", error: result.error },
  };
}

function storageFailure(cause: unknown): KitchenResult {
  return {
    ok: false,
    error: {
      kind: "persistence",
      message: cause instanceof Error ? cause.message : String(cause),
    },
  };
}

/**
 * Starts tracking an item.
 *
 * The opening quantity is a fact only the user knows, so it is required rather than defaulted
 * to zero, and it is written as the item's first log entry so that the stored quantity is
 * always explainable from the log. The id comes from the database rather than from the caller:
 * the schema assigns ids, and `createInventoryItem` deliberately demands one.
 */
export function addKitchenItem(input: {
  readonly name: string;
  readonly quantity: Quantity;
  readonly unit: string;
  readonly lowThreshold: Quantity | null;
  readonly sourceText: string | null;
}): KitchenResult {
  const repositories = getRepositories();
  const created = createInventoryItem({
    id: repositories.inventory.nextItemId(),
    name: input.name,
    quantity: input.quantity,
    unit: input.unit,
    lowThreshold: input.lowThreshold,
  });

  if (!created.ok) {
    return refused(created);
  }

  const item: InventoryItem = created.value;
  const stored = repositories.inventory.insertItem(item, {
    timestamp: nowTimestamp(),
    sourceText: input.sourceText,
  });

  if (!stored.ok) {
    // A duplicate name lands here, because the schema's UNIQUE constraint is the only place
    // that can decide it atomically. Reported as a persistence failure rather than as
    // `unknown_item`, because nothing is unknown — the item very much exists.
    return storageFailure(
      /UNIQUE/i.test(stored.error.message)
        ? `"${item.name}" is already tracked.`
        : stored.error.message,
    );
  }

  return saved(
    item.quantity === 0
      ? `Now tracking ${item.name}.`
      : `Now tracking ${item.name}, starting at ${item.quantity} ${item.unit}.`,
  );
}

/**
 * Changes, or clears, the quantity at or below which an item counts as low.
 *
 * The rule itself is the domain's `isLowStock` and is unchanged. This only decides what the
 * threshold *is* — it is the user telling the application their own definition, so it is
 * stored as metadata and produces no event.
 */
export function changeLowThreshold(
  itemId: number,
  threshold: Quantity | null,
): KitchenResult {
  const repositories = getRepositories();
  const found = repositories.inventory.findById(itemId);

  if (!found.ok) {
    return refused(found);
  }

  const updated = setLowStockThreshold(found.value, threshold);

  if (!updated.ok) {
    return refused(updated);
  }

  const stored = repositories.inventory.saveLowThreshold(updated.value);

  if (!stored.ok) {
    return storageFailure(stored.error.message);
  }

  return saved(
    updated.value.lowThreshold === null
      ? `${updated.value.name} is no longer flagged as low stock.`
      : `${updated.value.name} is low at ${updated.value.lowThreshold} ${updated.value.unit} or below.`,
  );
}

/**
 * Renames an item or changes the unit it is measured in.
 *
 * Refuses a unit change while stock remains, because `8 piece` is not `8 kg` and this domain
 * does not convert. The user sets the quantity to zero, changes the unit, and restocks — three
 * deliberate steps rather than one silent reinterpretation of a stored number.
 */
export function editKitchenItem(
  itemId: number,
  details: { readonly name: string; readonly unit: string },
): KitchenResult {
  const repositories = getRepositories();
  const found = repositories.inventory.findById(itemId);

  if (!found.ok) {
    return refused(found);
  }

  const updated = editInventoryDetails(found.value, details);

  if (!updated.ok) {
    return refused(updated);
  }

  const stored = repositories.inventory.saveDetails(updated.value);

  if (!stored.ok) {
    return storageFailure(
      /UNIQUE/i.test(stored.error.message)
        ? `"${updated.value.name}" is already tracked.`
        : stored.error.message,
    );
  }

  return saved(`Saved ${updated.value.name}.`);
}

/** One logged event, found for correction. */
export function readInventoryEvent(eventId: number): InventoryEventRow | null {
  return getRepositories().inventory.findEvent(eventId);
}

/**
 * Re-exported so a script that imports this module can release the handle it opened.
 *
 * The same function `command-runtime` exposes; here only so the Kitchen test file has one
 * import to close.
 */
export { releaseDatabase };
