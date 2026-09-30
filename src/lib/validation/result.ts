/**
 * The validation result vocabulary.
 *
 * Deliberately shaped like `Result` in `src/domain`, and deliberately not the same type.
 *
 * Conflating the two would be a real bug waiting to happen: a caller asking "why was this
 * rejected?" would be unable to tell "the model sent something malformed" from "there are
 * only 3 onions". Those demand completely different responses — one is a prompt or contract
 * problem, the other is a real-world fact the user needs to hear. Keeping them separate
 * types means the mistake is a compile error rather than a misread error message.
 *
 * The shape is the same on purpose so that handling a failure looks identical in both cases.
 */

export type ValidationIssueCode =
  /** The value was not an object, or was an array or null where an object is required. */
  | "not_an_object"
  /** The `kind` field is absent, or is not one of the supported commands. */
  | "unknown_command_kind"
  /** A required field is absent. */
  | "missing_field"
  /** A field is present with the wrong primitive type. */
  | "wrong_type"
  /** A field the command does not define is present. */
  | "unexpected_field"
  /** A string field is present but empty or only whitespace. */
  | "empty_string"
  /** A quantity is not a representable quantity. */
  | "invalid_quantity"
  /** An amount is not a representable money value. */
  | "invalid_money"
  /** An account name is not one of the three accounts. */
  | "invalid_account"
  /** `version` is present but is not the current contract version. */
  | "unsupported_version";

/** One specific thing wrong with an untrusted object, located by a dotted path. */
export type ValidationIssue = {
  /** Where the problem is, e.g. `amount` or `kind`. Empty string means the whole object. */
  readonly path: string;
  readonly code: ValidationIssueCode;
  readonly message: string;
};

export type ValidationError = {
  readonly code: "invalid_command";
  readonly issues: readonly ValidationIssue[];
};

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ValidationError };

export function valid<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

/**
 * Builds a failure from every issue found.
 *
 * Collecting all issues rather than stopping at the first is a deliberate choice at this
 * boundary. The usual caller is a language model that has to try again, and one reported
 * problem per attempt turns a two-error payload into two round trips. The cost is a little
 * more code in the validator, which is the cheap place to pay it.
 */
export function invalid(
  issues: readonly ValidationIssue[],
): ValidationResult<never> {
  return { ok: false, error: { code: "invalid_command", issues } };
}
