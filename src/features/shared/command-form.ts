/**
 * Translating submitted form fields into a command object.
 *
 * Pulled out of the route handler so it can be tested without an HTTP server, and so the
 * rules it follows are stated once in a place a reader will actually find.
 *
 * This is the **only** place that converts what a person typed into the shape the command
 * contract expects. Everything downstream — validation, the domain, the repositories — sees
 * contract fields and nothing else.
 *
 * ## The one conversion that happens
 *
 * A person types `50`, and an expense is stored in whole minor units, so `50` becomes
 * `5000`. That multiplication is `toMinorUnits`' job, from the domain, and is applied only
 * to an expense's amount.
 *
 * ## The trap this avoids
 *
 * `amount` means two different things in this contract. On `expense.record` it is money in
 * minor units; on `inventory.consume` and `inventory.restock` it is a quantity of stock.
 * Converting by amount name alone would multiply "2 onions" by 100 and restock two hundred
 * of them. So the conversion is chosen by command kind, not by field name.
 *
 * ## Failing closed
 *
 * Anything that is not recognisably the number it claims to be is forwarded as the raw
 * string. Validation then rejects it and names the field. The alternative — a loose
 * `Number()` — would turn `Number("")` into `0`, silently recording a free expense for an
 * empty amount, and would let a typo become a plausible number applied to real state.
 */
// Runtime imports use relative paths so the test scripts, which run under plain Node rather
// than the bundler, can resolve them. This matches the convention already used in
// `src/lib/db/repositories.ts`.
import { COMMAND_VERSION } from "../../commands/contract.ts";
import { toMinorUnits } from "../../domain/money.ts";

/** A number as a person writes it: an optional sign and digits, with optional decimals. */
const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Field names the contract already uses, copied across untouched. */
const TEXT_FIELDS = [
  "itemName",
  "item",
  "unit",
  "accountName",
  "category",
  // Phase 6. A task's title, a stated clock time, the stated day, and which of the night's
  // three times a sentence is about. All four are words the user chose, copied without
  // interpretation.
  "title",
  "time",
  "day",
  "field",
  // Phase 7. A skill's name, the skill a use refers to, which habit or private behaviour a
  // sentence named, and the user's own note. Copied as words, with no interpretation: the
  // executor resolves names to rows and the domain decides what is allowed.
  "name",
  "skillName",
  "type",
  "note",
] as const;

function text(form: FormData, name: string): string {
  const value = form.get(name);

  return typeof value === "string" ? value : "";
}

/** A numeric field as a number, or the untouched string when it is not recognisably one. */
function numberField(raw: string): number | string {
  if (!NUMERIC.test(raw)) {
    return raw;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : raw;
}

/** The two words a checkbox can produce, and nothing else. */
const BOOLEAN_WORDS = new Set(["true", "false"]);

/**
 * A checkbox's text into a real boolean.
 *
 * A form has no boolean type: `<input type="hidden" value="true">` arrives as the *string*
 * `"true"`, and validation refuses a string where it wants a boolean. So the conversion
 * happens here, in the one module that turns form fields into contract fields, and it happens
 * for exactly two words. Anything else is forwarded untouched and rejected by name, rather
 * than being read as truthy — a task marked "1" or "yes" is not a task marked done.
 */
function booleanField(raw: string): boolean | string {
  if (!BOOLEAN_WORDS.has(raw)) {
    return raw;
  }

  return raw === "true";
}

/**
 * Rupees as typed, into whole minor units.
 *
 * When the domain refuses the amount — negative, or more precise than a paisa — the raw text
 * is forwarded instead, so the failure surfaces as a validation issue against a field
 * rather than being decided here.
 */
function amountField(raw: string): number | string {
  if (!NUMERIC.test(raw)) {
    return raw;
  }

  const converted = toMinorUnits(Number(raw));

  return converted.ok ? converted.value : raw;
}

/**
 * Form fields as an untrusted command object.
 *
 * Deliberately returns a plain object and nothing more. It does not validate, does not
 * default, and does not repair: it renames fields the contract already names and converts
 * the one field that genuinely needs converting. Rejecting the result is the executor's job,
 * and it re-checks regardless.
 */
export function formToCommand(form: FormData): Record<string, unknown> {
  const kind = text(form, "kind");

  // `version` is a protocol constant rather than a user's input, so it is supplied here
  // instead of being asked for in a form. Every command carries it and a mismatched value
  // is rejected outright rather than adapted.
  const command: Record<string, unknown> = { kind, version: COMMAND_VERSION };

  for (const name of TEXT_FIELDS) {
    const value = text(form, name);
    if (value !== "") {
      command[name] = value;
    }
  }

  // Empty optional fields are omitted rather than sent as "", because an empty string is a
  // value the contract does not allow while an absent optional field is not one.
  const quantity = text(form, "quantity");
  if (quantity !== "") {
    command.quantity = numberField(quantity);
  }

  // `minutes` is a whole number of minutes the user stated. Not validated here: an hour and a
  // half is refused by the domain with a sentence about minutes, which is more useful than a
  // silent rounding to 90.
  const minutes = text(form, "minutes");
  if (minutes !== "") {
    command.minutes = numberField(minutes);
  }

  const amount = text(form, "amount");
  if (amount !== "") {
    command.amount =
      kind === "expense.record" ? amountField(amount) : numberField(amount);
  }

  // Same reasoning as `amount`, one field earlier: the wire format has no boolean.
  // `happened` is a private entry's yes/no and is treated the same way — for the same reason, and
  // because a checkbox that posts "1" is not a yes.
  const done = text(form, "done");
  if (done !== "") {
    command.done = booleanField(done);
  }

  const happened = text(form, "happened");
  if (happened !== "") {
    command.happened = booleanField(happened);
  }

  return command;
}

/** Where a failed or completed post should send the browser back to. */
export const DEFAULT_RETURN_PATH = "/kitchen";

/**
 * Only same-site paths.
 *
 * An open redirect on an app that renders messages a user trusts would be a real, if modest,
 * phishing primitive, and the fix is one test: a single leading slash, never a
 * protocol-relative `//host`, and never an absolute URL.
 */
export function safeReturnPath(candidate: string): string {
  return /^\/(?!\/)/.test(candidate) ? candidate : DEFAULT_RETURN_PATH;
}
