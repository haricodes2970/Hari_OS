/**
 * Correcting a mistaken inventory entry.
 *
 * ## The correction is a normal command, not a special one
 *
 * A correction moves stock, so it is executed by `runCommand` — the same entry point a form
 * post and a parsed sentence both use. That single decision is what keeps this feature from
 * becoming a second way to write inventory:
 *
 * - the command is built from the domain's `reverseInventoryEvent`, so the inverse is
 *   computed by `src/domain` and not by this file;
 * - it is validated by the existing `parseCommand`, so a malformed correction is refused
 *   before anything is touched;
 * - it is executed by the existing executor, so the new quantity and its log entry are written
 *   in one transaction exactly as any other movement is;
 * - it produces an ordinary `inventory_event`, indistinguishable in the log from a restock or a
 *   consumption.
 *
 * There is no separate "undo" table, no soft delete, and no overwrite of a stored quantity.
 *
 * ## Nothing is deleted
 *
 * The original entry stays exactly where it is. The correction appears beside it as an entry of
 * the opposite sign, so the history still shows what was believed and when. A user reading the
 * log sees "used 2" and later "correction: used 2", and can see why the number is what it is.
 * Deleting the original would destroy the only evidence that a mistake happened.
 *
 * ## The source text says what this was
 *
 * The command's `sourceText` is written by the application, never by a model — it is
 * `correction of entry #12`. `sourceText` is display-only and is never read to decide what a
 * command means, so using it as a label cannot influence execution.
 *
 * Server-only.
 */
import "server-only";

import { COMMAND_VERSION } from "@/commands/contract";
import type { InventoryChange } from "@/domain/inventory";
import { reverseInventoryEvent } from "@/domain/inventory";

import { getRepositories, runCommand } from "../shared/command-runtime.ts";

/** What a correction did, in words the page can show. */
export type CorrectionResult =
  | {
      readonly ok: true;
      readonly message: string;
      /** The resulting quantity, as the domain computed it. */
      readonly after: number;
      readonly unit: string;
      readonly itemName: string;
    }
  | {
      readonly ok: false;
      /** A closed-set token, so the outcome can travel in a URL as an enum. */
      readonly token: string;
      readonly error: string;
    };

/**
 * Corrects one logged entry by applying its inverse.
 *
 * The inverse is derived from the *current* quantity rather than from the state the original
 * entry left behind. Movements applied since then are unaffected, which is the only correct
 * choice: reversing against a stale snapshot would silently discard everything that happened
 * in between.
 */
export function correctInventoryEntry(eventId: number): CorrectionResult {
  const repositories = getRepositories();
  const event = repositories.inventory.findEvent(eventId);

  if (event === null) {
    return {
      ok: false,
      token: "unknown_item",
      error: "That entry no longer exists.",
    };
  }

  const item = repositories.inventory.findByName(event.itemName);

  if (!item.ok) {
    return { ok: false, token: item.error.code, error: item.error.message };
  }

  // The domain decides the inverse, including whether it is valid at all.
  const inverse: ReturnType<typeof reverseInventoryEvent> =
    reverseInventoryEvent(item.value, {
      itemId: event.itemId,
      delta: event.delta,
      timestamp: event.timestamp,
      sourceText: event.sourceText,
    });

  if (!inverse.ok) {
    return {
      ok: false,
      token: inverse.error.code,
      error: inverse.error.message,
    };
  }

  const change: InventoryChange = inverse.value;

  // Executed as an ordinary command. The two branches are the two existing movement commands
  // chosen by the sign of the inverse, so no new command kind and no new execution path exist.
  const command =
    change.delta > 0
      ? {
          kind: "inventory.restock" as const,
          itemName: change.itemName,
          amount: change.delta,
          unit: change.unit,
          sourceText: `correction of entry #${eventId}`,
        }
      : {
          kind: "inventory.consume" as const,
          itemName: change.itemName,
          amount: Math.abs(change.delta),
          unit: change.unit,
          sourceText: `correction of entry #${eventId}`,
        };

  // No re-read and no compare-and-swap. The executor resolves the item again and computes the
  // movement from the row it loads at that moment, so that row — not the one read above — is
  // the authority, and a guard here could only ever reject a correction the executor would
  // have handled correctly.
  const result = runCommand({ version: COMMAND_VERSION, ...command });

  if (!result.ok) {
    const error = result.error;

    return {
      ok: false,
      token:
        error.kind === "domain"
          ? error.error.code
          : error.kind === "validation"
            ? "invalid_command"
            : "persistence_failed",
      error:
        error.kind === "domain"
          ? error.error.message
          : error.kind === "validation"
            ? "That correction was not a valid command."
            : error.message,
    };
  }

  return {
    ok: true,
    message: `Corrected entry #${eventId}: ${change.itemName} is now ${change.after} ${change.unit}.`,
    after: change.after,
    unit: change.unit,
    itemName: change.itemName,
  };
}
