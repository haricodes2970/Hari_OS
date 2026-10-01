/**
 * Turning an execution outcome into something a person can read.
 *
 * This module maps *codes* to text. It deliberately contains no rules: it does not decide
 * what counts as low stock, whether a balance may go negative, or how much stock is left. It
 * translates an outcome that the domain and the executor already decided, and every string
 * here is wording. If a rule ever moved into this file, the same disagreement could appear
 * between a screen and a calculation.
 *
 * The PRD asks for failures a user can act on, which is why each kind gets its own message
 * instead of a shared apology. "You only have 3 onions" tells the user what to do next;
 * "Something went wrong" does not.
 *
 * Not server-only, because it is plain data and text. It imports nothing at all.
 */
import type { ExecutionError } from "@/commands/executor";

/**
 * A short token safe to put in a URL after a form submission.
 *
 * The form posts to a route handler which redirects back with one of these, so the page can
 * render the outcome without any client-side JavaScript.
 */
export type OutcomeToken =
  | "ok"
  | "invalid_command"
  | "unknown_item"
  | "missing_account"
  | "insufficient_inventory"
  | "invalid_unit"
  | "invalid_quantity"
  | "invalid_money"
  | "invalid_time"
  | "invalid_time_order"
  | "invalid_date"
  | "unknown_task"
  | "duplicate_task"
  | "unknown_nap"
  | "nap_already_ended"
  | "invalid_task_selection"
  | "persistence_failed";

/** The first thing a person needs to know, in their own terms. */
export type OutcomeMessage = {
  readonly tone: "ok" | "error";
  readonly title: string;
  readonly detail: string;
};

/** Every domain error code that can reach a user, with wording for it. */
const DOMAIN_MESSAGES: Record<string, string> = {
  unknown_item: "That item is not in your kitchen yet. Add it before using it.",
  missing_account:
    "That account does not exist. It must be cash, bank1, or bank2.",
  insufficient_inventory:
    "You do not have that much. Check the quantity shown in the Kitchen.",
  invalid_unit:
    "That unit does not match how the item is tracked. Use the unit shown there.",
  invalid_quantity: "The quantity must be a number of zero or more.",
  invalid_money:
    "The amount must be a whole number of rupees and paise, zero or more.",
  // Phase 6. Each of these is about a stated time or a stated task, and each says what to
  // change rather than merely that something was wrong.
  invalid_time: "Write the time on a 24-hour clock, like 23:30.",
  invalid_time_order:
    "Those two times cannot both be true. Check the start and the end.",
  invalid_date: "That day is not a real calendar date.",
  unknown_task: "That task is not on the list for that day.",
  duplicate_task: "That task is already on the list for that day.",
  unknown_nap: "There is no nap to end on that day.",
  nap_already_ended: "That nap already has an end time.",
  invalid_task_selection:
    "The check-in takes one to three task titles, each one a line of text.",
};

function isDomainMessage(code: string): code is keyof typeof DOMAIN_MESSAGES {
  return code in DOMAIN_MESSAGES;
}

/**
 * The token for a failed execution.
 *
 * The three failure kinds stay distinguishable, because they mean different things: the
 * submission was malformed, the request was impossible, or the system could not store it.
 */
export function tokenForError(error: ExecutionError): OutcomeToken {
  if (error.kind === "validation") {
    return "invalid_command";
  }

  if (error.kind === "persistence") {
    return "persistence_failed";
  }

  return error.error.code as OutcomeToken;
}

/** The field a validation failure is about, reduced to characters safe for a URL. */
export function fieldForError(error: ExecutionError): string | null {
  if (error.kind !== "validation" || error.issues.length === 0) {
    return null;
  }

  return error.issues[0].path.replace(/[^A-Za-z0-9_.]/g, "") || null;
}

/**
 * The result shape, described structurally.
 *
 * Components may not import from `src/commands` — the boundary rule in `eslint.config.mjs`
 * exists to stop the presentation layer reaching into execution internals. Describing the
 * shape here instead of importing it keeps that rule intact: a component depends on "a result
 * that is either ok or carries an error", which is all it actually uses, and the real
 * `ExecutionResult` satisfies it without either type being named here.
 */
export type OutcomeLike =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ExecutionError };

/**
 * Wording for a result, in one call.
 *
 * The shape a component needs: null when there is nothing to say, otherwise the tone, a
 * title, and a sentence that says what to do about it.
 */
export function describeResult(result: OutcomeLike): OutcomeMessage | null {
  if (result.ok) {
    return { tone: "ok", title: "Saved.", detail: "The change is stored." };
  }

  return describeOutcome(
    tokenForError(result.error),
    fieldForError(result.error),
  );
}

/**
 * Wording for a token, plus a `field` naming which input to correct when one applies.
 *
 * Unknown tokens render as a neutral failure rather than as raw text from the URL, so a
 * hand-edited query string cannot put arbitrary content on the page.
 */
export function describeOutcome(
  token: string | null,
  field: string | null,
): OutcomeMessage | null {
  if (token === null || token === "") {
    return null;
  }

  if (token === "ok") {
    return { tone: "ok", title: "Saved.", detail: "The change is stored." };
  }

  if (token === "invalid_command") {
    return {
      tone: "error",
      title: "That could not be read.",
      detail:
        field === null
          ? "Check the values and try again."
          : `Check the "${field}" value and try again.`,
    };
  }

  if (token === "persistence_failed") {
    return {
      tone: "error",
      title: "Not saved.",
      detail:
        "The database could not store this change. Nothing was written — try again.",
    };
  }

  if (isDomainMessage(token)) {
    return {
      tone: "error",
      title: "Not saved.",
      detail: DOMAIN_MESSAGES[token],
    };
  }

  return {
    tone: "error",
    title: "Not saved.",
    detail: "The change was refused.",
  };
}
