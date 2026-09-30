/**
 * The expense ledger: accounts and spends.
 *
 * Field-for-field with the `account` and `expense` tables from micro-phase 1.1. The PRD's
 * example — "bought banana 10 rupees cash" reducing the cash balance — is `applyExpense`
 * below, and its arithmetic happens only in `money.ts`.
 *
 * **A documented limitation.** The PRD asks for every change to be stored so it can be
 * corrected. Inventory can do that exactly, because `inventory_event` is a signed delta log.
 * The expense ledger cannot, and this micro-phase does not pretend otherwise: `expense`
 * holds non-negative spends and nothing else. There is no income row, no refund row, and no
 * reversal column, so a correcting entry has nowhere to live. Inventing one would mean
 * changing the schema, which is not this micro-phase's job. `expense` rows are instead the
 * log — the balance is derived from them, so correcting a wrong spend means removing or
 * replacing the row. See the session report.
 */
import { normaliseZero } from "./decimal.ts";
import {
  addMinorUnits,
  isBalance,
  isMoneyAmount,
  type MinorUnits,
} from "./money.ts";
import { fail, ok, type Result } from "./result.ts";

/**
 * The three accounts the PRD defines, and the same closed set the `account.name` CHECK
 * enforces in the schema.
 */
export const ACCOUNT_NAMES = ["cash", "bank1", "bank2"] as const;

export type AccountName = (typeof ACCOUNT_NAMES)[number];

export function isAccountName(value: string): value is AccountName {
  return (ACCOUNT_NAMES as readonly string[]).includes(value);
}

/** One balance the user spends from, matching the `account` row. */
export type Account = {
  readonly id: number;
  readonly name: AccountName;
  /** Whole minor units. May be negative: being overdrawn is a real state (ADR-021). */
  readonly balance: MinorUnits;
};

/**
 * A spend, matching the `expense` row.
 *
 * `timestamp` is supplied by the caller and the domain never reads the clock. Unlike
 * `inventory_event`, `expense` has no `source_text` column, so the sentence an entry came
 * from has nowhere to be stored — another reason the ledger's correctability is incomplete
 * and is documented rather than faked.
 */
export type ExpenseDraft = {
  readonly timestamp: string;
  readonly item: string;
  readonly amount: MinorUnits;
  readonly accountId: number;
  readonly category: string | null;
};

/**
 * The deterministic record of one balance change.
 *
 * `before`, `after`, and `delta` fully describe what happened to the balance. `delta` is
 * negative for a spend, which lets a reader check before and after against each other.
 */
export type AccountChange = {
  readonly kind: "account";
  readonly accountId: number;
  readonly accountName: AccountName;
  readonly before: MinorUnits;
  readonly after: MinorUnits;
  readonly delta: MinorUnits;
};

/**
 * A balance change that is also a stored spend.
 *
 * Kept separate from `AccountChange` because a manual balance correction genuinely has no
 * `expense` row — and could not have one, since a correction can move a balance upwards and
 * the schema only accepts non-negative amounts. A single merged type would have had to invent
 * a row the database would reject.
 */
export type ExpenseChange = AccountChange & {
  readonly expense: ExpenseDraft;
};

/** Fields needed to open an account. The caller supplies the id. */
export type NewAccount = {
  readonly id: number;
  readonly name: AccountName;
  readonly balance: MinorUnits;
};

/** What the caller knows about a spend, before any validation. */
export type ExpenseInput = {
  readonly item: string;
  readonly amount: MinorUnits;
  readonly accountId: number;
  readonly timestamp: string;
  readonly category?: string | null;
};

/**
 * Opens an account at a starting balance.
 *
 * The PRD has the user set all three balances manually at the start, so there is no default:
 * a guessed starting balance is exactly the kind of invented number this project avoids.
 */
export function createAccount(input: NewAccount): Result<Account> {
  if (!isAccountName(input.name)) {
    return fail("missing_account", `Unknown account name "${input.name}".`, {
      name: input.name,
      allowed: ACCOUNT_NAMES.join(", "),
    });
  }

  if (!isBalance(input.balance)) {
    return fail(
      "invalid_money",
      `Balance must be a whole number of minor units, received ${input.balance}.`,
      { balance: input.balance },
    );
  }

  return ok({ id: input.id, name: input.name, balance: input.balance });
}

/**
 * Sets an account's balance outright.
 *
 * The manual correction path for money, and the PRD's "each set manually at the start". It
 * returns an `AccountChange` with no `expense`: the schema has no row to store a correction
 * in, so this reports the difference rather than pretending to be a spend.
 */
export function setAccountBalance(
  account: Account,
  balance: MinorUnits,
): Result<AccountChange> {
  if (!isBalance(balance)) {
    return fail(
      "invalid_money",
      `Balance must be a whole number of minor units, received ${balance}.`,
      { balance },
    );
  }

  return ok({
    kind: "account",
    accountId: account.id,
    accountName: account.name,
    before: account.balance,
    after: balance,
    delta: normaliseZero(balance - account.balance),
  });
}

/**
 * Records a spend against an account and reduces its balance.
 *
 * The PRD's "bought banana 10 rupees cash": the amount is validated as a non-negative whole
 * number of minor units, and the new balance is the old one less that amount.
 *
 * **The balance is allowed to go negative.** ADR-021 decided that deliberately, because
 * overdrawn is a real state for a personal ledger rather than a database error, and the PRD
 * never says a spend must be affordable. So there is no `insufficient_balance` error: adding
 * one would invent a business rule the PRD does not contain. Money is still never invented —
 * the balance goes to exactly `before - amount`, reported or refused.
 */
export function applyExpense(
  account: Account,
  input: ExpenseInput,
): Result<ExpenseChange> {
  if (!isMoneyAmount(input.amount)) {
    return fail(
      "invalid_money",
      `An expense amount must be a non-negative whole number of minor units, received ${input.amount}.`,
      { amount: String(input.amount) },
    );
  }

  if (input.item.trim() === "") {
    return fail("invalid_money", "An expense needs a non-empty item.", {
      item: input.item,
    });
  }

  if (input.accountId !== account.id) {
    return fail(
      "missing_account",
      `Expense references account ${input.accountId} but was applied to "${account.name}" (${account.id}).`,
      { expected: account.id, received: input.accountId },
    );
  }

  const after = addMinorUnits(account.balance, -input.amount);

  if (!after.ok) {
    return after;
  }

  return ok({
    kind: "account",
    accountId: account.id,
    accountName: account.name,
    before: account.balance,
    after: after.value,
    delta: normaliseZero(-input.amount),
    expense: {
      timestamp: input.timestamp,
      item: input.item.trim(),
      amount: input.amount,
      accountId: input.accountId,
      category: input.category ?? null,
    },
  });
}

/**
 * The account that would be reduced by a spend described only by name.
 *
 * A miss is an explicit `missing_account` failure. Falling back to cash, or creating an
 * account, would be the system choosing where the user's money goes.
 */
export function findAccount(
  accounts: readonly Account[],
  name: string,
): Result<Account> {
  const wanted = name.trim().toLowerCase();

  for (const account of accounts) {
    if (account.name.toLowerCase() === wanted) {
      return ok(account);
    }
  }

  return fail("missing_account", `No account named "${name.trim()}".`, {
    requested: name.trim(),
    known: accounts.map((account) => account.name).join(", "),
  });
}

/**
 * Replaces one account in a collection, returning a new collection.
 *
 * Like its inventory counterpart, this never mutates the caller's array or objects, which is
 * what lets the same starting balances replay to the same result.
 */
export function replaceAccount(
  accounts: readonly Account[],
  updated: Account,
): Result<readonly Account[]> {
  const index = accounts.findIndex((account) => account.id === updated.id);

  if (index === -1) {
    return fail("missing_account", `No account with id ${updated.id}.`, {
      id: updated.id,
    });
  }

  const next = [...accounts];

  next[index] = updated;

  return ok(next);
}
