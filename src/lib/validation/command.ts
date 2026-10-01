/**
 * The validation boundary for untrusted command objects.
 *
 * This is the gate an LLM's output passes through before the application is allowed to act
 * on it. It decides one thing only: is this a well-formed command of a kind we support, with
 * every field the right type? It does not decide whether the command makes sense.
 *
 * ## What validation deliberately does not do
 *
 * - **It does not check existence.** "Is there really an account called cash?" needs the
 *   database, and a validator that queried SQLite could not be used from a test, a form, or a
 *   client component. Existence is a domain failure during execution.
 * - **It does not compute anything.** No balance is derived, no stock is recalculated, no
 *   amount is converted. Validation reads numbers; it never does arithmetic on them.
 * - **It does not guess.** An absent optional field becomes `null`, which is a documented
 *   default and not an inference. A wrong-typed value is a failure, never quietly repaired
 *   into something plausible. `quantity: "8"` is rejected, not read as 8.
 *
 * ## Strictness
 *
 * Unknown fields are rejected. That is what "fail closed" costs and it is worth paying here:
 * a model that invents an extra field is a model that is not following the contract, and
 * silently dropping the field would hide exactly the drift worth noticing. The
 * `expense.record` command, for instance, will not accept an invented `balance` field.
 *
 * Only own properties are ever read, so a poisoned prototype cannot inject a `kind` or an
 * `amount` that the object itself never had.
 *
 * No validation library is used. The job is checking the shape of four object types, and
 * hand-written guards here cost about as much as configuring a schema library and are easier
 * to read. See ADR-031.
 */
import { isAccountName, type AccountName } from "../../domain/accounts.ts";
import { isMoneyAmount } from "../../domain/money.ts";
import { isQuantity } from "../../domain/quantity.ts";
import { isDayReference, type DayReference } from "../../domain/routine.ts";
import { isSleepField, type SleepField } from "../../domain/sleep.ts";
import {
  COMMAND_KINDS,
  COMMAND_VERSION,
  isCommandKind,
  type Command,
} from "../../commands/contract.ts";
import {
  invalid,
  valid,
  type ValidationIssue,
  type ValidationResult,
} from "./result.ts";

/** Keys that are never a legitimate field, checked even though the allowlist covers them. */
const FORBIDDEN_KEYS = ["__proto__", "constructor", "prototype"];

const BASE_KEYS = ["version", "kind", "sourceText"] as const;

const KEYS_BY_KIND = {
  "inventory.consume": [...BASE_KEYS, "itemName", "amount", "unit"],
  "inventory.restock": [...BASE_KEYS, "itemName", "amount", "unit"],
  "inventory.set_quantity": [...BASE_KEYS, "itemName", "quantity"],
  "inventory.recount_after_use": [
    ...BASE_KEYS,
    "itemName",
    "countedQuantity",
    "usedAmount",
    "unit",
  ],
  "expense.record": [...BASE_KEYS, "accountName", "item", "amount", "category"],
  // Phase 6. `day` is a stated reference ("today" / "tomorrow" / "yesterday"), never a
  // date: the application resolves it, so a model cannot name a calendar day it computed.
  "task.create": [...BASE_KEYS, "title", "day"],
  "task.set_done": [...BASE_KEYS, "title", "done", "day"],
  "sleep.record": [...BASE_KEYS, "field", "time", "day"],
  "nap.start": [...BASE_KEYS, "time", "day"],
  "nap.end": [...BASE_KEYS, "time", "day"],
} as const satisfies Record<string, readonly string[]>;

const MISSING = Symbol("missing");

/** True for a non-null, non-array object — the only shape a command may be. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads an own property only.
 *
 * `value[key]` would happily return an inherited property, so an object with a poisoned
 * prototype could present a `kind` it never declared. Every field read in this file goes
 * through here.
 */
function ownValue(value: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key)
    ? value[key]
    : MISSING;
}

/** Reads a required non-empty string. */
function readString(
  path: string,
  value: unknown,
  issues: ValidationIssue[],
): unknown {
  if (value === MISSING) {
    issues.push({
      path,
      code: "missing_field",
      message: `\`${path}\` is required.`,
    });
    return MISSING;
  }

  if (typeof value !== "string") {
    issues.push({
      path,
      code: "wrong_type",
      message: `\`${path}\` must be a string, received ${typeof value}.`,
    });
    return MISSING;
  }

  if (value.trim() === "") {
    issues.push({
      path,
      code: "empty_string",
      message: `\`${path}\` must not be empty.`,
    });
    return MISSING;
  }

  return value;
}

/** Reads a required finite number, rejecting `NaN` and infinities. */
function readNumber(
  path: string,
  value: unknown,
  issues: ValidationIssue[],
): unknown {
  if (value === MISSING) {
    issues.push({
      path,
      code: "missing_field",
      message: `\`${path}\` is required.`,
    });
    return MISSING;
  }

  if (typeof value !== "number") {
    issues.push({
      path,
      code: "wrong_type",
      message: `\`${path}\` must be a number, received ${typeof value}.`,
    });
    return MISSING;
  }

  if (!Number.isFinite(value)) {
    issues.push({
      path,
      code: "wrong_type",
      message: `\`${path}\` must be a finite number, received ${value}.`,
    });
    return MISSING;
  }

  return value;
}

/**
 * Reads an optional string, absent becoming `null`.
 *
 * A present-but-wrong-typed value is still a failure: `sourceText: 42` means the producer
 * does not understand the contract, which is worth surfacing.
 */
function readOptionalString(
  path: string,
  value: unknown,
  issues: ValidationIssue[],
): string | null {
  if (value === MISSING || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    issues.push({
      path,
      code: "wrong_type",
      message: `\`${path}\` must be a string or null, received ${typeof value}.`,
    });
    return null;
  }

  return value;
}

/** Rejects fields the command does not define, plus prototype-pollution keys. */
function checkUnknownKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  issues: ValidationIssue[],
): void {
  for (const key of Object.getOwnPropertyNames(input)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      issues.push({
        path: key,
        code: "unexpected_field",
        message: `\`${key}\` is not a permitted field.`,
      });
      continue;
    }

    if (!allowed.includes(key)) {
      issues.push({
        path: key,
        code: "unexpected_field",
        message: `\`${key}\` is not a field of this command.`,
      });
    }
  }
}

function readVersion(
  input: Record<string, unknown>,
  issues: ValidationIssue[],
): typeof COMMAND_VERSION | null {
  const value = ownValue(input, "version");

  if (value === MISSING) {
    issues.push({
      path: "version",
      code: "missing_field",
      message: "`version` is required.",
    });
    return null;
  }

  if (typeof value !== "number") {
    issues.push({
      path: "version",
      code: "wrong_type",
      message: `\`version\` must be a number, received ${typeof value}.`,
    });
    return null;
  }

  if (value !== COMMAND_VERSION) {
    issues.push({
      path: "version",
      code: "unsupported_version",
      message: `Unsupported command version ${value}; this build accepts ${COMMAND_VERSION}.`,
    });
    return null;
  }

  return COMMAND_VERSION;
}

/** Validates a quantity, reusing the domain's own representation rule. */
function readQuantity(
  path: string,
  value: unknown,
  issues: ValidationIssue[],
): number | null {
  const number = readNumber(path, value, issues);

  if (number === MISSING) {
    return null;
  }

  if (!isQuantity(number as number)) {
    issues.push({
      path,
      code: "invalid_quantity",
      message: `\`${path}\` is not a valid quantity: ${number}.`,
    });
    return null;
  }

  return number as number;
}

/**
 * Validates a money amount, reusing the domain's own representation rule.
 *
 * `isMoneyAmount` is the domain's, not a second copy of it, so the command boundary and the
 * schema CHECK cannot drift apart.
 */
function readMoney(
  path: string,
  value: unknown,
  issues: ValidationIssue[],
): number | null {
  const number = readNumber(path, value, issues);

  if (number === MISSING) {
    return null;
  }

  if (!isMoneyAmount(number as number)) {
    issues.push({
      path,
      code: "invalid_money",
      message: `\`${path}\` is not a valid money amount in minor units: ${number}.`,
    });
    return null;
  }

  return number as number;
}

function readAccountName(
  input: Record<string, unknown>,
  issues: ValidationIssue[],
): AccountName | null {
  const name = readString(
    "accountName",
    ownValue(input, "accountName"),
    issues,
  );

  if (name === MISSING || typeof name !== "string") {
    // A wrong type has already been reported by readString.
    return null;
  }

  if (!isAccountName(name)) {
    issues.push({
      path: "accountName",
      code: "invalid_account",
      message: `\`accountName\` must be one of cash, bank1, bank2; received "${name}".`,
    });
    return null;
  }

  return name;
}

/**
 * Reads a stated day reference, an absent one becoming `today`.
 *
 * The default is documented rather than inferred, and it is the same treatment `category`
 * gets on `expense.record`. A *date* is never accepted here: `2026-10-02` is a value only
 * the application can produce, and letting one through would mean a sentence could pin a
 * task to a day the user never named.
 */
function readDayReference(
  value: unknown,
  issues: ValidationIssue[],
): DayReference | null {
  if (value === MISSING || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    issues.push({
      path: "day",
      code: "wrong_type",
      message: `\`day\` must be a string or null, received ${typeof value}.`,
    });
    return null;
  }

  if (!isDayReference(value)) {
    issues.push({
      path: "day",
      code: "wrong_type",
      message: `\`day\` must be "today", "tomorrow", or "yesterday"; received "${value}".`,
    });
    return null;
  }

  return value;
}

/** Reads which of the night's three times this command records. */
function readSleepField(
  value: unknown,
  issues: ValidationIssue[],
): SleepField | null {
  if (value === MISSING || value === undefined) {
    issues.push({
      path: "field",
      code: "missing_field",
      message: "`field` is required.",
    });
    return null;
  }

  if (typeof value !== "string") {
    issues.push({
      path: "field",
      code: "wrong_type",
      message: `\`field\` must be a string, received ${typeof value}.`,
    });
    return null;
  }

  if (!isSleepField(value)) {
    issues.push({
      path: "field",
      code: "wrong_type",
      message: `\`field\` must be "bedtime", "sleep_time", or "wake_time"; received "${value}".`,
    });
    return null;
  }

  return value;
}

/**
 * Reads a boolean.
 *
 * Only a real boolean is accepted — `"true"` and `1` are failures, not coercions. The value
 * decides whether a task reads as finished, and a form checkbox's string arriving as a
 * truthy value would be exactly the kind of "repaired" input this boundary exists to refuse.
 * `formToCommand` converts the checkbox's text into a real boolean before it gets here.
 */
function readBoolean(
  path: string,
  value: unknown,
  issues: ValidationIssue[],
): boolean | null {
  if (value === MISSING || value === null) {
    issues.push({
      path,
      code: "missing_field",
      message: `\`${path}\` is required.`,
    });
    return null;
  }

  if (typeof value !== "boolean") {
    issues.push({
      path,
      code: "wrong_type",
      message: `\`${path}\` must be true or false, received ${typeof value}.`,
    });
    return null;
  }

  return value;
}

/**
 * Validates an untrusted value into a command, or explains every problem with it.
 *
 * Returns a value or a list of issues. It never throws, and it never touches the clock, the
 * filesystem, the network, or the database, so the same input always produces the same
 * result.
 *
 * The wrapper exists so the boundary fails *closed*. Reading a property off an untrusted
 * object can throw — a getter, a Proxy, a revoked reference — and an exception escaping here
 * would take down whatever request or form triggered it, which is precisely the outcome a
 * validation step exists to prevent. Anything that throws while being read becomes a rejected
 * command, with whatever issues were already found kept alongside it.
 */
export function parseCommand(input: unknown): ValidationResult<Command> {
  const issues: ValidationIssue[] = [];

  try {
    return readCommand(input, issues);
  } catch {
    issues.push({
      path: "",
      code: "wrong_type",
      message:
        "The command could not be read: a field threw while being accessed.",
    });

    return invalid(issues);
  }
}

function readCommand(
  input: unknown,
  issues: ValidationIssue[],
): ValidationResult<Command> {
  if (!isPlainObject(input)) {
    issues.push({
      path: "",
      code: "not_an_object",
      message: `A command must be an object, received ${
        input === null
          ? "null"
          : Array.isArray(input)
            ? "an array"
            : typeof input
      }.`,
    });
    return invalid(issues);
  }

  const version = readVersion(input, issues);

  if (version === null) {
    // A payload built for a different contract cannot be interpreted at all, so there is
    // nothing to gain from reporting its other problems in the same breath.
    return invalid(issues);
  }

  const kind = ownValue(input, "kind");

  if (kind === MISSING) {
    issues.push({
      path: "kind",
      code: "missing_field",
      message: "`kind` is required.",
    });
    return invalid(issues);
  }

  if (typeof kind !== "string") {
    issues.push({
      path: "kind",
      code: "wrong_type",
      message: `\`kind\` must be a string, received ${typeof kind}.`,
    });
    return invalid(issues);
  }

  if (!isCommandKind(kind)) {
    issues.push({
      path: "kind",
      code: "unknown_command_kind",
      message: `Unknown command kind "${kind}". Expected one of: ${COMMAND_KINDS.join(", ")}.`,
    });
    return invalid(issues);
  }

  // `isCommandKind` is a type guard, so the remaining comparisons narrow properly.
  const allowed = KEYS_BY_KIND[kind];

  checkUnknownKeys(input, allowed, issues);

  const sourceText = readOptionalString(
    "sourceText",
    ownValue(input, "sourceText"),
    issues,
  );

  let command: Command | null = null;

  if (kind === "inventory.consume" || kind === "inventory.restock") {
    const itemName = readString(
      "itemName",
      ownValue(input, "itemName"),
      issues,
    );
    const amount = readQuantity("amount", ownValue(input, "amount"), issues);
    const unit = readString("unit", ownValue(input, "unit"), issues);

    if (itemName !== MISSING && amount !== null && unit !== MISSING) {
      // The two commands carry identical fields, so one literal satisfies both. The cast is
      // safe because `kind` was already narrowed against COMMAND_KINDS.
      command = {
        version,
        kind,
        sourceText,
        itemName: itemName as string,
        amount: amount as number,
        unit: unit as string,
      } as Command;
    }
  } else if (kind === "inventory.recount_after_use") {
    const itemName = readString(
      "itemName",
      ownValue(input, "itemName"),
      issues,
    );
    const countedQuantity = readQuantity(
      "countedQuantity",
      ownValue(input, "countedQuantity"),
      issues,
    );
    const usedAmount = readQuantity(
      "usedAmount",
      ownValue(input, "usedAmount"),
      issues,
    );
    const unit = readString("unit", ownValue(input, "unit"), issues);

    if (
      itemName !== MISSING &&
      countedQuantity !== null &&
      usedAmount !== null &&
      unit !== MISSING
    ) {
      command = {
        version,
        kind,
        sourceText,
        itemName: itemName as string,
        countedQuantity: countedQuantity as number,
        usedAmount: usedAmount as number,
        unit: unit as string,
      } as Command;
    }
  } else if (kind === "inventory.set_quantity") {
    const itemName = readString(
      "itemName",
      ownValue(input, "itemName"),
      issues,
    );
    const quantity = readQuantity(
      "quantity",
      ownValue(input, "quantity"),
      issues,
    );

    if (itemName !== MISSING && quantity !== null) {
      command = {
        version,
        kind,
        sourceText,
        itemName: itemName as string,
        quantity: quantity as number,
      } as Command;
    }
  } else if (kind === "expense.record") {
    const accountName = readAccountName(input, issues);
    const item = readString("item", ownValue(input, "item"), issues);
    const amount = readMoney("amount", ownValue(input, "amount"), issues);
    const category = readOptionalString(
      "category",
      ownValue(input, "category"),
      issues,
    );

    if (accountName !== null && item !== MISSING && amount !== null) {
      command = {
        version,
        kind,
        sourceText,
        accountName,
        item: item as string,
        amount: amount as number,
        category,
      };
    }
  } else if (kind === "task.create") {
    const title = readString("title", ownValue(input, "title"), issues);
    const day = readDayReference(ownValue(input, "day"), issues);

    if (title !== MISSING) {
      command = {
        version,
        kind: "task.create",
        sourceText,
        title: title as string,
        day,
      };
    }
  } else if (kind === "task.set_done") {
    const title = readString("title", ownValue(input, "title"), issues);
    const done = readBoolean("done", ownValue(input, "done"), issues);
    const day = readDayReference(ownValue(input, "day"), issues);

    if (title !== MISSING && done !== null) {
      command = {
        version,
        kind: "task.set_done",
        sourceText,
        title: title as string,
        done,
        day,
      };
    }
  } else if (kind === "sleep.record") {
    const field = readSleepField(ownValue(input, "field"), issues);
    const time = readString("time", ownValue(input, "time"), issues);
    const day = readDayReference(ownValue(input, "day"), issues);

    if (field !== null && time !== MISSING) {
      command = {
        version,
        kind: "sleep.record",
        sourceText,
        field,
        time: time as string,
        day,
      };
    }
  } else {
    // nap.start and nap.end share their shape; only the kind differs.
    const time = readString("time", ownValue(input, "time"), issues);
    const day = readDayReference(ownValue(input, "day"), issues);

    if (time !== MISSING) {
      command = {
        version,
        kind: kind as "nap.start" | "nap.end",
        sourceText,
        time: time as string,
        day,
      };
    }
  }

  if (issues.length > 0 || command === null) {
    return invalid(issues);
  }

  return valid(command);
}

/**
 * Whether a value is a validated command.
 *
 * A convenience for the many places that need a boolean and do not care why validation
 * failed. Where the reason matters, call `parseCommand` and read the issues.
 */
export function isCommand(input: unknown): input is Command {
  return parseCommand(input).ok;
}
