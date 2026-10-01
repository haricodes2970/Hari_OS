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
 * - `invalid_time` — a clock time that is not `HH:MM` on a 24-hour clock. Phase 6.
 * - `invalid_time_order` — two stated times that cannot both be true of the same event: a
 *   nap that ends before it starts, or a night at least a full day long. Phase 6.
 * - `invalid_date` — a calendar date that is not a real `YYYY-MM-DD` day. Phase 6.
 * - `unknown_task` — no planned task matched the requested title and day. Phase 6.
 * - `duplicate_task` — that title is already planned for that day. Phase 6.
 * - `unknown_nap` — there is no nap to end on that day. Phase 6.
 * - `nap_already_ended` — the last nap on that day already has an end time. Phase 6.
 * - `invalid_task_selection` — a night check-in with no tasks, or with more than the
 *   three the PRD asks for. Phase 6.
 *
 * Every code here is a refusal the *user* can act on. None of them is an infrastructure
 * problem: a database failure surfaces at the layer that owns it, never as a `DomainError`.
 */
export type DomainErrorCode =
  | "invalid_quantity"
  | "invalid_money"
  | "invalid_money_precision"
  | "invalid_unit"
  | "insufficient_inventory"
  | "unknown_item"
  | "missing_account"
  | "invalid_time"
  | "invalid_time_order"
  | "invalid_date"
  | "unknown_task"
  | "duplicate_task"
  | "unknown_nap"
  | "nap_already_ended"
  | "invalid_task_selection";

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
