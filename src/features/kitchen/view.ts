/**
 * Read-side helpers for the Kitchen page.
 *
 * Presentation only, like `features/shared/queries.ts`: rows are fetched, existing domain rules
 * are applied, and the result is shaped for rendering. No page queries the database itself, and
 * nothing here decides whether an item is low — that is the domain's `isLowStock`, called once
 * here so the Kitchen page and the Dashboard cannot disagree about it.
 *
 * A correction is a stock movement, so correcting one is not a read and does not appear here.
 * It goes through the command pipeline; see `features/kitchen/correction.ts`.
 *
 * Server-only.
 */
import "server-only";

import { isLowStock, type InventoryItem } from "@/domain/inventory";

import { getRepositories } from "../shared/command-runtime.ts";

/** One stock line, with everything the page shows about it. */
export type KitchenStockLine = {
  readonly id: number;
  readonly name: string;
  readonly quantity: number;
  readonly unit: string;
  readonly lowThreshold: number | null;
  readonly lowStock: boolean;
};

/** One entry from the change log, shaped for display. */
export type KitchenHistoryLine = {
  /** Present so a correction can address this exact entry. Never rendered. */
  readonly id: number;
  readonly itemName: string;
  /** Signed: negative consumed, positive added. */
  readonly delta: number;
  readonly unit: string;
  readonly timestamp: string;
  readonly sourceText: string | null;
  /**
   * Whether this entry reads as a correction.
   *
   * A label, not a flag in the database. The log records what happened; this only notes that
   * the sentence attached to it says so.
   */
  readonly isCorrection: boolean;
};

/** The date and time part of an ISO instant, for a history line. */
function readableMoment(timestamp: string): string {
  return timestamp.replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function toStockLine(item: InventoryItem): KitchenStockLine {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    lowThreshold: item.lowThreshold,
    lowStock: isLowStock(item),
  };
}

/**
 * Everything the page knows about the item it is editing, by id.
 *
 * By id rather than by name because the forms post a hidden id. A name can be edited, so a form
 * that identified its subject by name would act on the wrong item the moment a rename happened;
 * an id cannot be re-pointed. The id is never displayed.
 */
export function findKitchenItemById(itemId: number): KitchenStockLine | null {
  for (const item of listKitchenStock()) {
    if (item.id === itemId) {
      return item;
    }
  }

  return null;
}

/** Every tracked item, ordered by name. */
export function listKitchenStock(): KitchenStockLine[] {
  return getRepositories().display.listInventory().map(toStockLine);
}

/**
 * The most recent changes, newest first.
 *
 * Capped rather than complete on purpose: this is a page for understanding what changed, not
 * an audit-log product, and an unbounded list on a page is a page nobody can read.
 */
export function listKitchenHistory(limit = 20): KitchenHistoryLine[] {
  const units = new Map(
    listKitchenStock().map((item) => [item.name, item.unit] as const),
  );

  return getRepositories()
    .display.recentInventoryEvents(limit)
    .map((event) => ({
      id: event.id,
      itemName: event.itemName,
      delta: event.delta,
      unit: units.get(event.itemName) ?? "",
      timestamp: readableMoment(event.timestamp),
      sourceText: event.sourceText,
      isCorrection: (event.sourceText ?? "").startsWith(
        "correction of entry #",
      ),
    }));
}
