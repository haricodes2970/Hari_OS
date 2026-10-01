/**
 * Kitchen inventory: the pure rules for stock.
 *
 * Field-for-field with the `inventory_item` and `inventory_event` tables created in
 * micro-phase 1.1. Nothing here reads or writes SQLite — this module decides what a stock
 * change *means*, and a later layer decides where to store it.
 *
 * Two PRD requirements shape this file: stock arithmetic must be deterministic code rather
 * than LLM arithmetic, and every change is stored as a log entry so it can be corrected.
 * The second is why every operation returns an `InventoryChange` carrying the before, after,
 * and delta — a correction needs all three to be meaningful.
 */
import { normaliseZero } from "./decimal.ts";
import {
  addQuantities,
  parseQuantity,
  subtractQuantities,
  type Quantity,
} from "./quantity.ts";
import { fail, ok, type Result } from "./result.ts";

/** One tracked thing in the kitchen, matching the `inventory_item` row. */
export type InventoryItem = {
  readonly id: number;
  readonly name: string;
  readonly quantity: Quantity;
  /** The item's unit, e.g. `piece` or `kg`. Free text, exactly as the schema stores it. */
  readonly unit: string;
  /** At or below this quantity the item is low on stock. `null` when no threshold is set. */
  readonly lowThreshold: Quantity | null;
};

/**
 * A stock movement, matching the `inventory_event` row.
 *
 * `delta` is signed and carries no unit: negative consumes, positive restocks. This mirrors
 * the schema, which stores a signed `NUMERIC` with no sign constraint, so consumption and
 * restock are the same kind of record.
 *
 * `timestamp` and `sourceText` are supplied by the caller. The domain never reads the clock
 * and never inspects the sentence an event came from — deciding what text means is the
 * command layer's job, and a domain result that depended on "now" could not be tested.
 */
export type InventoryEventDraft = {
  readonly itemId: number;
  readonly delta: number;
  readonly timestamp: string;
  readonly sourceText: string | null;
};

/**
 * The deterministic record of one stock change: what moved, from what, to what.
 *
 * This is the correctability representation. It is produced without a timestamp because the
 * domain does not read the clock; `stampInventoryChange` attaches the identity of the moment
 * and, when there is one, the sentence the change came from.
 */
export type InventoryChange = {
  readonly kind: "inventory";
  readonly itemId: number;
  readonly itemName: string;
  readonly unit: string;
  readonly before: Quantity;
  readonly after: Quantity;
  readonly delta: number;
};

/** An `InventoryChange` carrying the event identity that will be persisted with it. */
export type StampedInventoryChange = InventoryChange & {
  readonly event: InventoryEventDraft;
};

/** Fields needed to start tracking an item. The caller supplies the id. */
export type NewInventoryItem = {
  readonly id: number;
  readonly name: string;
  readonly quantity: Quantity;
  readonly unit: string;
  readonly lowThreshold?: Quantity | null;
};

/**
 * Confirms a unit is the one this item is tracked in.
 *
 * Units are compared as trimmed strings and nothing else. `piece` is not `kg`, and the
 * domain does not try to know whether `g` and `kg` are convertible — that would be
 * inference. Canonicalising what a user wrote ("pcs", "PCS", "pieces") belongs to whatever
 * introduces the item, so one spelling means one unit and a mismatch is reported rather
 * than guessed at.
 */
export function checkInventoryUnit(
  item: InventoryItem,
  unit: string,
): Result<string> {
  const requested = unit.trim();

  if (requested === "") {
    return fail("invalid_unit", "An inventory operation needs a unit.", {
      unit,
    });
  }

  if (requested !== item.unit) {
    return fail(
      "invalid_unit",
      `Unit mismatch: "${item.name}" is tracked in ${item.unit}, not ${requested}.`,
      { item: item.name, expected: item.unit, received: requested },
    );
  }

  return ok(item.unit);
}

/**
 * Starts tracking an item.
 *
 * Requires an explicit id and quantity rather than defaulting either: the schema assigns ids,
 * and a new item's true stock is a fact only the user knows.
 */
export function createInventoryItem(
  input: NewInventoryItem,
): Result<InventoryItem> {
  if (input.name.trim() === "") {
    return fail("unknown_item", "An inventory item needs a non-empty name.", {
      name: input.name,
    });
  }

  const unit = input.unit.trim();

  if (unit === "") {
    return fail("invalid_unit", "An inventory item needs a non-empty unit.", {
      name: input.name,
      unit: input.unit,
    });
  }

  const quantity = parseQuantity(input.quantity);

  if (!quantity.ok) {
    return quantity;
  }

  const threshold = input.lowThreshold ?? null;
  let lowThreshold: Quantity | null = null;

  if (threshold !== null) {
    const parsed = parseQuantity(threshold);

    if (!parsed.ok) {
      return parsed;
    }

    lowThreshold = parsed.value;
  }

  return ok({
    id: input.id,
    name: input.name.trim(),
    quantity: quantity.value,
    unit,
    lowThreshold,
  });
}

function change(
  item: InventoryItem,
  delta: number,
  after: Quantity,
): InventoryChange {
  return {
    kind: "inventory",
    itemId: item.id,
    itemName: item.name,
    unit: item.unit,
    before: item.quantity,
    after,
    delta: normaliseZero(delta),
  };
}

/**
 * Sets the quantity to an absolute value.
 *
 * The PRD's "I had 10 onions" — a recount that states what is true now rather than a
 * movement. The delta is derived, so the persisted event still explains how the value got
 * here.
 */
export function setInventoryQuantity(
  item: InventoryItem,
  quantity: Quantity,
): Result<InventoryChange> {
  const target = parseQuantity(quantity);

  if (!target.ok) {
    return target;
  }

  return ok(change(item, target.value - item.quantity, target.value));
}

/**
 * The PRD's compound sentence: "I had 10 onions, used 2".
 *
 * Two facts were stated — a count and a consumption — and the result is their difference. The
 * subtraction is performed *here*, which is the whole point: a language model reading this
 * sentence can report `10` and `2` because both are things the user said, and must never
 * report `8`, because that is a calculation it has no business performing. The contract
 * therefore carries two facts and no result, and this function is the only place the two meet.
 *
 * Implemented against the *current* quantity rather than by replaying a recount followed by a
 * consumption, because only one log entry is written: the movement from where stock actually
 * is to where the sentence says it should be.
 */
export function recountAfterUse(
  item: InventoryItem,
  countedQuantity: Quantity,
  usedAmount: Quantity,
  unit: string,
): Result<InventoryChange> {
  const counted = parseQuantity(countedQuantity);

  if (!counted.ok) {
    return counted;
  }

  const used = parseQuantity(usedAmount);

  if (!used.ok) {
    return used;
  }

  const checked = checkInventoryUnit(item, unit);

  if (!checked.ok) {
    return checked;
  }

  // The same primitive `consumeInventory` uses, so "cannot use more than was counted" is
  // refused here for the same reason and with the same wording.
  const remaining = subtractQuantities(counted.value, used.value);

  if (!remaining.ok) {
    return remaining;
  }

  return ok(change(item, remaining.value - item.quantity, remaining.value));
}

/**
 * Consumes stock, the PRD's "used 2 onions".
 *
 * The unit is required rather than assumed, because the unit in a sentence is a fact the
 * caller read from somewhere and the domain has to be able to reject it when it contradicts
 * how the item is tracked. Consuming the exact remaining amount is allowed and leaves zero.
 */
export function consumeInventory(
  item: InventoryItem,
  amount: Quantity,
  unit: string,
): Result<InventoryChange> {
  const requested = parseQuantity(amount);

  if (!requested.ok) {
    return requested;
  }

  const checked = checkInventoryUnit(item, unit);

  if (!checked.ok) {
    return checked;
  }

  const remaining = subtractQuantities(item.quantity, requested.value);

  if (!remaining.ok) {
    return remaining;
  }

  return ok(change(item, -requested.value, remaining.value));
}

/**
 * Adds stock, for a restock or a correction that increases quantity.
 *
 * A restock needs no dedicated concept: from the schema's point of view it is the same
 * record as a consumption with the other sign.
 */
export function restockInventory(
  item: InventoryItem,
  amount: Quantity,
  unit: string,
): Result<InventoryChange> {
  const added = parseQuantity(amount);

  if (!added.ok) {
    return added;
  }

  const checked = checkInventoryUnit(item, unit);

  if (!checked.ok) {
    return checked;
  }

  const total = addQuantities(item.quantity, added.value);

  if (!total.ok) {
    return total;
  }

  return ok(change(item, added.value, total.value));
}

/**
 * Applies a signed movement, refusing one that would leave the item negative.
 *
 * The single path every inventory change goes through, so the non-negative rule cannot be
 * bypassed by a caller reaching for this module directly.
 */
export function adjustInventory(
  item: InventoryItem,
  delta: number,
): Result<InventoryChange> {
  if (!Number.isFinite(delta)) {
    return fail(
      "invalid_quantity",
      `Stock movement must be a finite number, received ${delta}.`,
      {
        delta: String(delta),
      },
    );
  }

  const after =
    delta >= 0
      ? addQuantities(item.quantity, delta)
      : subtractQuantities(item.quantity, -delta);

  if (!after.ok) {
    return after;
  }

  return ok(change(item, delta, after.value));
}

/**
 * Replays a prepared event, validating that it belongs to this item and yields real stock.
 *
 * This is the path a persisted `inventory_event` row takes, so the timestamp and source text
 * the event already carries are preserved.
 */
export function applyInventoryEvent(
  item: InventoryItem,
  event: InventoryEventDraft,
): Result<StampedInventoryChange> {
  if (event.itemId !== item.id) {
    return fail(
      "unknown_item",
      `Event belongs to item ${event.itemId} but was applied to "${item.name}" (${item.id}).`,
      { expected: item.id, received: event.itemId },
    );
  }

  const applied = adjustInventory(item, event.delta);

  if (!applied.ok) {
    return applied;
  }

  return ok({
    ...applied.value,
    event: {
      itemId: event.itemId,
      delta: normaliseZero(event.delta),
      timestamp: event.timestamp,
      sourceText: event.sourceText,
    },
  });
}

/**
 * Attaches the moment and, when there is one, the sentence a change came from.
 *
 * Kept separate from the rules above because the domain must not read the clock: whoever
 * persists the change knows when it happened, and the tests pass a fixed string.
 */
export function stampInventoryChange(
  changeToStamp: InventoryChange,
  timestamp: string,
  sourceText: string | null = null,
): StampedInventoryChange {
  return {
    ...changeToStamp,
    event: {
      itemId: changeToStamp.itemId,
      delta: normaliseZero(changeToStamp.delta),
      timestamp,
      sourceText,
    },
  };
}

/**
 * The change that undoes another, computed from the item state the original left behind.
 *
 * Correction for stock is exact rather than best-effort: the inverse of "used 2" restores the
 * original quantity exactly. This works only because inventory is logged as deltas, which is
 * the reason the schema keeps an event log rather than just a current quantity.
 *
 * Refused only when the reversal itself is invalid, which means the inputs already disagreed.
 */
export function reverseInventoryChange(
  changeToReverse: InventoryChange,
): Result<InventoryChange> {
  const item: InventoryItem = {
    id: changeToReverse.itemId,
    name: changeToReverse.itemName,
    quantity: changeToReverse.after,
    unit: changeToReverse.unit,
    lowThreshold: null,
  };

  return adjustInventory(item, normaliseZero(-changeToReverse.delta));
}

/**
 * The change that undoes a *logged event*, computed from where stock is now.
 *
 * Distinct from `reverseInventoryChange`, which inverts a change whose `after` is still the
 * item's current quantity — an immediate undo. Correcting an entry from last week is a
 * different problem: other movements may have been applied since, so the inverse has to be
 * measured against the *current* quantity rather than the one the original change left behind.
 * Using the stale state would silently discard everything that happened in between.
 *
 * The result is an ordinary change with a signed delta, which is what makes a correction
 * indistinguishable in the log from any other movement — the original entry stays, and the
 * correction sits beside it. Nothing is deleted, and no quantity is overwritten.
 */
export function reverseInventoryEvent(
  item: InventoryItem,
  event: InventoryEventDraft,
): Result<InventoryChange> {
  if (event.itemId !== item.id) {
    return fail(
      "unknown_item",
      `Event belongs to item ${event.itemId} but "${item.name}" is item ${item.id}.`,
      { expected: item.id, received: event.itemId },
    );
  }

  if (normaliseZero(event.delta) === 0) {
    return fail(
      "invalid_quantity",
      "That entry records no change, so there is nothing to correct.",
      { itemId: item.id },
    );
  }

  return adjustInventory(item, -event.delta);
}

/**
 * Sets or clears the low-stock threshold.
 *
 * Changes no quantity and produces no event, because it is not a movement: it is the user
 * telling the application what "low" means for this item. `null` removes the threshold, which
 * puts the item back in the never-flagged state rather than flagging it at zero.
 */
export function setLowStockThreshold(
  item: InventoryItem,
  threshold: Quantity | null,
): Result<InventoryItem> {
  if (threshold === null) {
    return ok({ ...item, lowThreshold: null });
  }

  const parsed = parseQuantity(threshold);

  if (!parsed.ok) {
    return parsed;
  }

  return ok({ ...item, lowThreshold: parsed.value });
}

/**
 * Renames an item or changes the unit it is measured in.
 *
 * Never changes the quantity. A quantity is a movement, and movements are logged; letting a
 * metadata edit move stock would put a number in the log with no event explaining it. If the
 * user wants to change how much there is, that is a recount.
 *
 * The unit is only allowed to change when the quantity is zero, because `8 kg` cannot become
 * `8 piece` without a conversion, and this domain does not convert between units.
 */
export function editInventoryDetails(
  item: InventoryItem,
  details: { readonly name: string; readonly unit: string },
): Result<InventoryItem> {
  const name = details.name.trim();

  if (name === "") {
    return fail("unknown_item", "An inventory item needs a non-empty name.", {
      name: details.name,
    });
  }

  const unit = details.unit.trim();

  if (unit === "") {
    return fail("invalid_unit", "An inventory item needs a non-empty unit.", {
      name,
      unit: details.unit,
    });
  }

  if (unit !== item.unit && normaliseZero(item.quantity) !== 0) {
    return fail(
      "invalid_unit",
      `"${item.name}" still has ${item.quantity} ${item.unit}. Use the quantity form to change the unit once the item is empty.`,
      { item: item.name, current: item.unit, requested: unit },
    );
  }

  return ok({ ...item, name, unit });
}

/**
 * Whether an item is at or below its low-stock threshold.
 *
 * The PRD's Dashboard flag. Strictly "at or below": an item sitting exactly on its threshold
 * is already short, and a `null` threshold means the user never set one, so it is never
 * flagged.
 */
export function isLowStock(item: InventoryItem): boolean {
  if (item.lowThreshold === null) {
    return false;
  }

  return item.quantity <= item.lowThreshold;
}

/**
 * Looks up an item by name, case-insensitively.
 *
 * A miss is an explicit `unknown_item` failure rather than a silent new item. Inventing an
 * item the user never mentioned would be the assistant deciding something on their behalf,
 * which the PRD forbids.
 */
export function findInventoryItem(
  items: readonly InventoryItem[],
  name: string,
): Result<InventoryItem> {
  const wanted = name.trim().toLowerCase();

  for (const item of items) {
    if (item.name.toLowerCase() === wanted) {
      return ok(item);
    }
  }

  return fail("unknown_item", `No inventory item named "${name.trim()}".`, {
    requested: name.trim(),
    known: items.map((item) => item.name).join(", "),
  });
}

/**
 * Looks up one item by its id.
 *
 * The same miss-is-a-failure rule as `findInventoryItem`, and for a sharper reason: a form
 * identifies the row it is editing by id precisely because a name can be changed. If a rename
 * happened while a threshold form sat on the page, a name-keyed lookup would resolve to a
 * different item — or to nothing — and the user's next click would edit the wrong row.
 */
export function findInventoryItemById(
  items: readonly InventoryItem[],
  id: number,
): Result<InventoryItem> {
  for (const item of items) {
    if (item.id === id) {
      return ok(item);
    }
  }

  return fail("unknown_item", `No inventory item with id ${id}.`, { id });
}

/**
 * Replaces one item in a collection, returning a new collection.
 *
 * The input array and every item in it are left untouched — the domain never mutates
 * something the caller still holds, which is what lets a sequence of changes replay
 * reproducibly from the same starting state.
 */
export function replaceInventoryItem(
  items: readonly InventoryItem[],
  updated: InventoryItem,
): Result<readonly InventoryItem[]> {
  const index = items.findIndex((item) => item.id === updated.id);

  if (index === -1) {
    return fail("unknown_item", `No inventory item with id ${updated.id}.`, {
      id: updated.id,
    });
  }

  const next = [...items];

  next[index] = updated;

  return ok(next);
}
