/**
 * The natural-language command parser: an untrusted text-to-facts boundary.
 *
 * A language model reads a sentence and proposes what the user meant. This module defines
 * what a parser may be, what a proposal may contain, and how a proposal becomes the object
 * the *existing* validator already understands. It is the whole trust model in one file.
 *
 * ## The model is an interpreter, never an authority
 *
 * Three things are structurally impossible from here, and each is enforced by construction
 * rather than by instruction:
 *
 * 1. **The model cannot do arithmetic.** For an expense the model reports `amountRupees`,
 *    the number the user actually said. The conversion into whole minor units is
 *    `toMinorUnits`, in `src/domain`. A model that answers "5000" instead has not calculated
 *    anything — it has produced a field the contract does not accept, and validation refuses
 *    the command.
 * 2. **The model cannot supply identity, time, or outcomes.** `candidateToCommand` copies a
 *    fixed allowlist of fields and nothing else, so `id`, `timestamp`, `balance`, and
 *    `sourceText` in a model response are dropped before they can reach a command. Ids come
 *    from the row the repository loaded, the timestamp from the server clock, and every
 *    resulting number from the domain.
 * 3. **The model cannot decide whether anything executes.** Nothing here calls the executor,
 *    the domain, or the database. The output of this module is an unvalidated plain object,
 *    which is exactly what `parseCommand` is designed to receive, and the caller is
 *    responsible for running it through the existing gate. There is no second validation
 *    system and no shortcut around the first.
 *
 * ## Why a sanitising step exists at all
 *
 * The provider can be instructed to return JSON and can be trusted to follow that
 * instruction most of the time. "Most of the time" is the problem. A provider may return
 * prose, a fenced code block, `null`, an array, a command kind that does not exist, or an
 * object with fifty invented fields. So the response is never handed to the validator
 * directly. It is read as `unknown`, and only a shape that fits the candidate contract is
 * allowed to become a command candidate. Anything else becomes an explicit refusal, so the
 * application reports "I could not read that" instead of executing a fragment.
 *
 * ## Ambiguity is a first-class result
 *
 * "spent 50" has no account. "used some onions" has no quantity. These are not edge cases,
 * they are the normal state of a one-line input, so they have their own outcome rather than
 * being coerced into a command. The parser is told to name *which* facts were missing, from a
 * closed set, and the application turns that into a sentence. It cannot invent a default
 * account, a quantity, or a price, and it never asks the model to choose one.
 *
 * ## One sentence, one command
 *
 * A single input yields at most one command. There is no batch planning, no chaining, and no
 * conversation state, so nothing here accumulates context between calls.
 *
 * No provider import appears in this file, and none may be added: the parser is a port, and
 * `src/features/chat/openrouter.ts` is one implementation of it behind this interface.
 */

import type { MinorUnits } from "@/domain/money";
import { toMinorUnits } from "../domain/money.ts";
import { COMMAND_VERSION, isCommandKind } from "./contract.ts";
import type { CommandKind } from "./contract.ts";

/**
 * A text-to-facts port.
 *
 * `parse` returns `unknown` on purpose. The whole point of the boundary is that whatever
 * comes back is untrusted, and typing it as anything more specific would invite the rest of
 * the application to start trusting it. Implementations report their own failures as a value
 * rather than by throwing, so a provider outage is an ordinary outcome and not a crash.
 */
export type NaturalLanguageParser = {
  readonly parse: (text: string) => Promise<ParserResult>;
};

/**
 * Why a parser could not produce a proposal at all.
 *
 * These are transport and configuration problems, distinct from a model that answered with
 * something unusable. Keeping them apart is what lets the application say "the service is
 * unavailable" rather than "I did not understand you", which are different problems for the
 * user and different things to look at when diagnosing.
 */
export type ParserFailure = {
  /** No credentials configured. The user cannot fix this by rephrasing. */
  readonly kind: "unconfigured" | "unavailable" | "unreadable";
  readonly message: string;
};

export type ParserResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: ParserFailure };

/** The closed set of facts a proposal may report as missing. */
export type MissingFact =
  "itemName" | "item" | "quantity" | "unit" | "amount" | "accountName";

/**
 * What a proposal turned out to be.
 *
 * `command` is an unvalidated candidate, not a command. It has the shape the contract
 * expects and nothing more, but whether it is *legal* is decided later by `parseCommand`.
 * This module is not that gate and does not try to be.
 */
export type Interpretation =
  | {
      readonly kind: "command";
      /**
       * The kind, already confirmed to be one of the executable commands.
       *
       * Reported separately so the caller can choose the wording of a confirmation without
       * re-reading it out of the unvalidated object. It is a label for the command that was
       * attempted, never a decision about whether to run it.
       */
      readonly commandKind: CommandKind;
      /** Unvalidated. The existing validator is still the gate. */
      readonly command: Record<string, unknown>;
    }
  | { readonly kind: "clarification"; readonly missing: readonly MissingFact[] }
  | { readonly kind: "unsupported" }
  | { readonly kind: "unreadable" };

/** A number as a model might write it, e.g. `2`, `"2"`, or `2.0`. */
const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Field names a proposal may contribute, copied only when the command kind calls for it. */
const TEXT_FIELDS = [
  "itemName",
  "item",
  "unit",
  "accountName",
  "category",
  // Phase 6. `title` is the task as the user said it; `day` is the word they used ("tomorrow"),
  // never a date. `field` and `time` are the two stated facts of a sleep or nap sentence.
  "title",
  "day",
  "field",
  "time",
  // Phase 7. `name` is a skill as the user named it and `skillName` names one they are logging,
  // both in their own words. `type` is the habit or private behaviour the sentence named, and
  // `note` is the user's own words. None of these are ever derived, and none of them may carry a
  // number: `habit.record`'s `minutes` and `skill.log`'s are read below as numbers, not strings.
  "name",
  "skillName",
  "type",
  "note",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * A numeric field, or the untouched value when it is not recognisably a number.
 *
 * Fails closed for the same reason the form path does: a loose conversion would let a
 * malformed proposal become a plausible number applied to real state. Forwarding the original
 * means `parseCommand` rejects it and names the field.
 */
function asNumber(value: unknown): number | string | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "string" && NUMERIC.test(value)) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : value;
  }

  return value === undefined || value === null ? undefined : String(value);
}

/**
 * Rupees as the model reported them, into whole minor units.
 *
 * The multiplication is the domain's, not the model's. When `toMinorUnits` refuses — a
 * negative amount, or more precision than a paisa — the reported value is forwarded so the
 * failure surfaces as a validation issue against a field.
 */
function asMinorUnits(rupees: unknown): number | string | undefined {
  const value = asNumber(rupees);

  if (typeof value !== "number") {
    return value;
  }

  const converted: { ok: true; value: MinorUnits } | { ok: false } =
    toMinorUnits(value);

  return converted.ok ? converted.value : value;
}

/** Which facts a proposal claims are missing, filtered to the closed set. */
function readMissingFact(value: unknown): MissingFact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const allowed: readonly MissingFact[] = [
    "itemName",
    "item",
    "quantity",
    "unit",
    "amount",
    "accountName",
  ];

  return value.filter((entry): entry is MissingFact =>
    allowed.includes(entry as MissingFact),
  );
}

/**
 * Turns an untrusted proposal into a command candidate.
 *
 * The allowlist is the security property. Every field the candidate can contribute is named
 * explicitly; anything else a model returns — `id`, `timestamp`, `balance`, `after`,
 * `confidence`, `sql` — is simply never read. A model cannot smuggle a value into a command
 * by inventing a field, because no invented field is ever read.
 *
 * `sourceText` is the one field the application supplies and the model never does: the
 * sentence the user actually typed. That is what makes a stored change traceable back to the
 * words that caused it, which is how a wrong entry gets found and corrected.
 */
function candidateToCommand(
  kind: CommandKind,
  proposal: Record<string, unknown>,
  sourceText: string,
): Record<string, unknown> {
  const command: Record<string, unknown> = { kind, version: COMMAND_VERSION };

  for (const field of TEXT_FIELDS) {
    const value = asString(proposal[field]);
    if (value !== undefined) {
      command[field] = value;
    }
  }

  if (kind === "task.set_done") {
    // A completion is a fact the user stated. Only a real boolean is copied; a string, a
    // number, or a probability is forwarded unchanged so validation refuses it by name rather
    // than this layer guessing what was meant.
    if (typeof proposal.done === "boolean") {
      command.done = proposal.done;
    }
  }

  if (kind === "expense.record") {
    const amount = asMinorUnits(proposal.amountRupees);
    if (amount !== undefined) {
      command.amount = amount;
    }
  } else if (kind === "inventory.recount_after_use") {
    // Two stated facts, copied one at a time. The subtraction between them is the domain's;
    // there is deliberately no field here that could carry the difference.
    const countedQuantity = asNumber(proposal.countedQuantity);
    if (countedQuantity !== undefined) {
      command.countedQuantity = countedQuantity;
    }

    const usedAmount = asNumber(proposal.usedAmount);
    if (usedAmount !== undefined) {
      command.usedAmount = usedAmount;
    }
  } else if (kind === "inventory.set_quantity") {
    const quantity = asNumber(proposal.quantity);
    if (quantity !== undefined) {
      command.quantity = quantity;
    }
  } else if (
    kind === "sleep.record" ||
    kind === "nap.start" ||
    kind === "nap.end"
  ) {
    // The stated wall-clock time, as the user wrote it. `clockTime` is not a field the
    // candidate may contribute, and a duration is not a field either: both would be the model
    // doing arithmetic this application owns.
    const time = asString(proposal.time);
    if (time !== undefined) {
      command.time = time;
    }
  } else if (kind === "habit.record") {
    // A completion is a stated fact, on the same terms as `task.set_done`: a real boolean is
    // copied and anything else is forwarded so validation refuses it by name.
    if (typeof proposal.done === "boolean") {
      command.done = proposal.done;
    }

    // Screen time is entered by hand, so the model may report the number of minutes the user
    // said. Converting "90 minutes" to 90 is a string the validator already understands, and
    // nothing here derives, sums, or converts a duration.
    const minutes = asNumber(proposal.minutes);
    if (minutes !== undefined) {
      command.minutes = minutes;
    }
  } else if (kind === "private.log") {
    // Whether it happened is a stated fact, and a non-boolean is forwarded unchanged rather
    // than guessed at. There is no field here for a count, and none may be added: the contract
    // has nowhere to put one, which is what makes a private entry structurally incapable of
    // becoming a tally.
    if (typeof proposal.happened === "boolean") {
      command.happened = proposal.happened;
    }
  } else if (kind === "skill.log") {
    const minutes = asNumber(proposal.minutes);
    if (minutes !== undefined) {
      command.minutes = minutes;
    }
  } else if (kind === "skill.create") {
    // Nothing else is read. A proposed position, category, icon, or order would be a preference
    // the application has no business accepting, and the field is not in the allowlist above so
    // it never reaches the command even if the model sends one.
  } else {
    // consume and restock both take a quantity in the item's own unit, as `amount`.
    const amount = asNumber(proposal.amount);
    if (amount !== undefined) {
      command.amount = amount;
    }
  }

  // The user's sentence, supplied by the application. Never interpreted, never validated.
  command.sourceText = sourceText;

  return command;
}

/**
 * Reads whatever a parser returned and decides what it means.
 *
 * Rejects, in order: a non-object, an unknown `status`, and an `interpreted` proposal whose
 * `kind` is not one of the executable commands. A proposal claiming to be a command with a kind
 * the application cannot execute is `unreadable`, not `unsupported` — the model invented
 * something, which is a broken proposal rather than an unsupported request.
 */
export function interpret(
  proposal: unknown,
  sourceText: string,
): Interpretation {
  if (!isPlainObject(proposal)) {
    return { kind: "unreadable" };
  }

  const status = proposal.status;

  if (status === "unsupported") {
    return { kind: "unsupported" };
  }

  if (status === "needs_clarification") {
    return {
      kind: "clarification",
      missing: readMissingFact(proposal.missing),
    };
  }

  if (status !== "interpreted" || !isCommandKind(proposal.kind)) {
    return { kind: "unreadable" };
  }

  return {
    kind: "command",
    commandKind: proposal.kind,
    command: candidateToCommand(proposal.kind, proposal, sourceText),
  };
}

/**
 * A parser that always fails, used when no provider is configured.
 *
 * Returning this rather than constructing a broken client means the application reports a
 * configuration problem through its normal result path. There is deliberately no fallback
 * that guesses at intent: a fake parser would be indistinguishable from a working one, and
 * the failure would surface later as a wrong number in the database.
 */
export function unconfiguredParser(message: string): NaturalLanguageParser {
  return {
    parse: () =>
      Promise.resolve({ ok: false, error: { kind: "unconfigured", message } }),
  };
}
