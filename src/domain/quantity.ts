/**
 * Inventory quantities.
 *
 * A quantity is a non-negative amount of one thing, measured in that item's unit. The PRD
 * needs both whole counts (`onions: 8 pieces`) and fractional weights (`rice: kg`), which
 * is why the schema stores `NUMERIC` rather than `INTEGER` (ADR-024).
 *
 * **The honest limitation.** Binary floating point cannot represent most decimal fractions
 * exactly, so `0.1 + 0.2` is `0.30000000000000004`. ADR-024 accepted this deliberately:
 * storing thousandths instead would be exact but would push a conversion bug into every
 * caller. This module makes the error bounded and deterministic rather than pretending it
 * is absent:
 *
 * - **Inputs** must already be within `QUANTITY_DECIMAL_PLACES`. An over-precise input is
 *   rejected, never silently rounded.
 * - **Results** of arithmetic are rounded to that scale exactly once.
 * - Above `MAX_MAGNITUDE` a value is refused, because decimal scaling stops being exact.
 *
 * So the same input always produces the same output, and an operation applied to its own
 * output changes nothing.
 */
import {
  decimalPlacesOf,
  hasAtMostDecimalPlaces,
  roundToScale,
} from "./decimal.ts";
import { fail, ok, type Result } from "./result.ts";

/** A non-negative amount of one unit, within `QUANTITY_DECIMAL_PLACES`. */
export type Quantity = number;

/**
 * Decimal places a quantity may carry.
 *
 * Six is far finer than any kitchen measurement and fine enough to represent common weights
 * (`0.25`, `1.5`) exactly.
 */
export const QUANTITY_DECIMAL_PLACES = 6;

/**
 * Upper bound on magnitude. Beyond this, scaling by 10^6 is no longer exact, so the value is
 * refused rather than silently losing precision. Far above any real stock count.
 */
export const MAX_MAGNITUDE = 1e9;

/**
 * A valid quantity: finite, non-negative, within scale, within magnitude.
 *
 * Mirrors the `inventory_item.quantity` CHECK in the schema.
 */
export function isQuantity(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    Math.abs(value) <= MAX_MAGNITUDE &&
    hasAtMostDecimalPlaces(value, QUANTITY_DECIMAL_PLACES)
  );
}

/**
 * Validates a quantity, returning the reason it was refused.
 *
 * Reports the *specific* problem rather than one generic message, because the difference
 * between "you typed a negative number" and "that number has too many decimal places" is
 * the difference between a correctable entry and a mystery.
 */
export function parseQuantity(value: number): Result<Quantity> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(
      "invalid_quantity",
      `Quantity must be a finite number, received ${String(value)}.`,
      { quantity: String(value) },
    );
  }

  if (value < 0) {
    return fail(
      "invalid_quantity",
      `Quantity must not be negative, received ${value}.`,
      {
        quantity: value,
      },
    );
  }

  if (Math.abs(value) > MAX_MAGNITUDE) {
    return fail(
      "invalid_quantity",
      `Quantity must not exceed ${MAX_MAGNITUDE}, received ${value}.`,
      { quantity: value, maxMagnitude: MAX_MAGNITUDE },
    );
  }

  const decimals = decimalPlacesOf(value);

  if (decimals === null) {
    return fail(
      "invalid_quantity",
      `Quantity is outside the range this domain handles precisely, received ${value}.`,
      { quantity: value },
    );
  }

  if (decimals > QUANTITY_DECIMAL_PLACES) {
    return fail(
      "invalid_quantity",
      `Quantity must have at most ${QUANTITY_DECIMAL_PLACES} decimal places, received ${value}.`,
      {
        quantity: value,
        decimalPlaces: decimals,
        allowed: QUANTITY_DECIMAL_PLACES,
      },
    );
  }

  return ok(value);
}

/**
 * Adds two quantities, rounding the result to `QUANTITY_DECIMAL_PLACES`.
 *
 * Zero is a valid quantity, and so is a result of zero: exhausting the stock is a real state,
 * not a failure.
 */
export function addQuantities(a: Quantity, b: Quantity): Result<Quantity> {
  const left = parseQuantity(a);
  const right = parseQuantity(b);

  if (!left.ok) {
    return left;
  }

  if (!right.ok) {
    return right;
  }

  return parseQuantity(
    roundToScale(left.value + right.value, QUANTITY_DECIMAL_PLACES),
  );
}

/**
 * Subtracts `b` from `a`, refusing a negative result.
 *
 * A negative result means the recorded stock and the claimed consumption disagree, which is
 * a data-entry error rather than a quantity. The PRD describes stock as a known reality
 * ("know what is in the kitchen"), so the domain refuses the operation instead of letting
 * the stock go negative and hiding the mistake.
 *
 * Returning exactly the whole quantity is allowed and yields zero.
 */
export function subtractQuantities(a: Quantity, b: Quantity): Result<Quantity> {
  const left = parseQuantity(a);
  const right = parseQuantity(b);

  if (!left.ok) {
    return left;
  }

  if (!right.ok) {
    return right;
  }

  const remaining = roundToScale(
    left.value - right.value,
    QUANTITY_DECIMAL_PLACES,
  );

  if (remaining < 0) {
    return fail(
      "insufficient_inventory",
      `Cannot use ${right.value} when only ${left.value} is available.`,
      { available: left.value, requested: right.value, remaining },
    );
  }

  return parseQuantity(remaining);
}
