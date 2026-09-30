/**
 * The domain failure vocabulary.
 *
 * Domain operations are pure functions, so they cannot "throw away" a wrong answer: a
 * validation failure must come back as a value the caller has to deal with. Every operation
 * in `src/domain` therefore returns a `Result` rather than an exception, and every failure
 * carries a stable `code`.
 *
 * The codes are a closed set. Callers switch on `error.code`, never on `error.message`,
 * which is human-readable and may be reworded.
 *
 * Note what is deliberately absent: there is no code here for a database error, because
 * domain code cannot cause one. Anything infrastructure-related surfaces at the layer that
 * owns it, never as a `DomainError`.
 */

/**
 * A stable, exhaustive reason a domain operation refused.
 *
 * - `invalid_quantity` — not a number, not finite, negative where only non-negative is
 *   meaningful, or carrying more decimal places than the quantity scale allows.
 * - `invalid_money` — not a whole number of minor units, or negative where the schema
 *   requires a non-negative amount.
 * - `invalid_money_precision` — a rupee amount that cannot be represented exactly as
 *   minor units (more than two decimal places, or written in exponent form).
 * - `invalid_unit` — a missing unit, or an operation that mixed two different units.
 * - `insufficient_inventory` — consuming more than the recorded stock.
 * - `unknown_item` — no inventory item matched the requested name.
 * - `missing_account` — no account matched the requested name.
 */
export type DomainErrorCode =
  | "invalid_quantity"
  | "invalid_money"
  | "invalid_money_precision"
  | "invalid_unit"
  | "insufficient_inventory"
  | "unknown_item"
  | "missing_account";

/** Extra machine-readable context, for assertions and for showing the user what was wrong. */
export type DomainErrorDetail = Readonly<Record<string, string | number>>;

export type DomainError = {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly detail?: DomainErrorDetail;
};

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DomainError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(
  code: DomainErrorCode,
  message: string,
  detail?: DomainErrorDetail,
): Result<T> {
  return detail === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, detail } };
}
