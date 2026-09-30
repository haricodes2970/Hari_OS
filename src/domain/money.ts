/**
 * Money, represented as integer minor units.
 *
 * The PRD requires balance arithmetic to be deterministic code and forbids LLM arithmetic.
 * A float cannot do that job: `0.1 + 0.2 !== 0.3`, so a balance stored as a `REAL` drifts
 * by a fraction of a paisa every time it is touched.
 *
 * Every amount here is therefore a whole number of minor units (paise) — the representation
 * ADR-021 chose for the schema. `MinorUnits` is a plain `number` rather than a branded type
 * so that it stays trivially assignable in tests and in plain JavaScript callers, but every
 * operation validates before it computes.
 *
 * The scale is fixed: 100 minor units per rupee, matching the rupee amounts the PRD uses.
 */
import { hasAtMostDecimalPlaces } from "./decimal.ts";
import { fail, ok, type Result } from "./result.ts";

/** A whole number of minor units. The only representation this module accepts or returns. */
export type MinorUnits = number;

/** Fixed scale. The PRD's amounts are rupees, and 1 rupee is 100 paise. */
export const MINOR_UNITS_PER_RUPEE = 100;

/**
 * A valid expense amount: a non-negative whole number of minor units.
 *
 * Mirrors the `expense.amount` CHECK in the schema. Non-negative because a spend cannot be
 * negative; a refund is not a negative expense, and the schema has no refund row.
 */
export function isMoneyAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * A valid balance: any whole number of minor units, including a negative one.
 *
 * Deliberately more permissive than `isMoneyAmount`. Being overdrawn is a real state for a
 * personal ledger, and ADR-021 decided the schema permits a negative balance rather than
 * treating it as a database error.
 */
export function isBalance(value: number): boolean {
  return Number.isSafeInteger(value);
}

/**
 * Converts a rupee amount to whole minor units, exactly.
 *
 * The conversion reads the decimal string rather than multiplying, because multiplying is
 * where rupee conversion normally goes wrong: `1.15 * 100` is `114.99999999999999`, which
 * rounds to 115 here only by luck of direction, and `1.005 * 100` is `100.49999999999999`,
 * which rounds to 100 when 101 was meant.
 *
 * An amount with more than two decimal places is **rejected**, not rounded. Half a paisa has
 * no meaning, so accepting it would quietly invent a different number of paise than the
 * caller wrote.
 *
 * Returns `invalid_money` for a value that is not finite, and `invalid_money_precision` for
 * one that cannot be represented exactly.
 */
export function toMinorUnits(rupees: number): Result<MinorUnits> {
  if (!Number.isFinite(rupees)) {
    return fail(
      "invalid_money",
      `Rupee amount must be a finite number, received ${String(rupees)}.`,
      { rupees: String(rupees) },
    );
  }

  if (Number.isInteger(rupees)) {
    return ok(rupees * MINOR_UNITS_PER_RUPEE);
  }

  if (!hasAtMostDecimalPlaces(rupees, 2)) {
    return fail(
      "invalid_money_precision",
      `Rupee amount must have at most 2 decimal places to be exact in minor units, received ${rupees}.`,
      { rupees, minorUnitsPerRupee: MINOR_UNITS_PER_RUPEE },
    );
  }

  const text = String(Math.abs(rupees));
  const [whole = "0", fraction = ""] = text.split(".");
  const sign = rupees < 0 ? -1 : 1;
  const paise = Number(fraction.padEnd(2, "0").slice(0, 2));

  return ok(sign * (Number(whole) * MINOR_UNITS_PER_RUPEE + paise));
}

/**
 * Adds a signed amount to a balance, exactly.
 *
 * Both operands must already be valid balances. The result is a safe integer, or the
 * operation is refused rather than silently losing precision past `Number.MAX_SAFE_INTEGER`.
 */
export function addMinorUnits(
  balance: MinorUnits,
  delta: MinorUnits,
): Result<MinorUnits> {
  if (!isBalance(balance)) {
    return fail(
      "invalid_money",
      `Balance must be a whole number of minor units, received ${balance}.`,
      {
        balance,
      },
    );
  }

  if (!isBalance(delta)) {
    return fail(
      "invalid_money",
      `Amount must be a whole number of minor units, received ${delta}.`,
      {
        delta,
      },
    );
  }

  const total = balance + delta;

  if (!isBalance(total)) {
    return fail(
      "invalid_money",
      "Balance would exceed the exact integer range and is no longer deterministic.",
      { balance, delta },
    );
  }

  return ok(total);
}
