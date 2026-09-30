/**
 * Exact numeric helpers for money and quantities.
 *
 * Money and quantities both have a fixed decimal scale, and both need to answer "how many
 * decimal places does this value actually have?" without doing floating-point arithmetic
 * to find out. Multiplying to shift the decimal point is the trap: `1.15 * 100` is
 * `114.99999999999999`, and `1.005 * 100` is `100.49999999999999`, so a naive conversion
 * rounds the wrong way.
 *
 * Instead these helpers read the value's own canonical decimal string. `String(1.005)` is
 * `"1.005"`, which states the precision exactly, with no arithmetic involved. That lets the
 * money and quantity modules *reject* an over-precise input rather than silently rounding
 * it, and convert a permitted value exactly.
 *
 * Internal to the domain. Not part of any public contract.
 */

/**
 * Removes negative zero.
 *
 * Negating a zero amount yields `-0`, which behaves like `0` in arithmetic but is *not*
 * `Object.is`-equal to it, and serialises inconsistently between runtimes. A zero-amount
 * spend should report a plain `0` delta, so every computed delta is normalised here rather
 * than at each call site where the sign could be reintroduced.
 */
export function normaliseZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * The number of decimal places in the canonical decimal form of `value`.
 *
 * Returns `null` when the value has no plain decimal form: non-finite values, and values
 * JavaScript writes in exponent form (`1e-7`, `1.5e21`). Exponent form means the value is
 * outside the range this domain handles precisely, so callers reject it.
 */
export function decimalPlacesOf(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (Number.isInteger(value)) {
    return 0;
  }

  const text = String(Math.abs(value));

  if (text.includes("e") || text.includes("E")) {
    return null;
  }

  const dot = text.indexOf(".");

  return dot === -1 ? 0 : text.length - dot - 1;
}

/** True when `value` is finite and has no more than `places` decimal places. */
export function hasAtMostDecimalPlaces(value: number, places: number): boolean {
  const decimals = decimalPlacesOf(value);

  return decimals !== null && decimals <= places;
}

/**
 * Rounds the result of an arithmetic operation to `places` decimal places.
 *
 * This is applied exactly once, to the *result* of an addition or subtraction, and never to
 * an input. Inputs are validated instead, so a caller can never lose precision silently to
 * rounding on the way in.
 *
 * `toFixed` rounds the binary value that actually exists, which is what makes the result
 * stable: the same inputs always produce the same output, and re-running an operation on
 * its own output is a no-op.
 */
export function roundToScale(value: number, places: number): number {
  return Number(value.toFixed(places));
}
