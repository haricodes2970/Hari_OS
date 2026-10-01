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
import type { DomainError } from "@/domain/result";

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
  | { readonly kind: "expense"; readonly change: AccountChange };

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
