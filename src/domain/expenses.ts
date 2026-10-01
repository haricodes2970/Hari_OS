/**
 * The daily bill: the PRD's "total spent, breakdown by item and payment method".
 *
 * ## Why this is a domain file and not a query
 *
 * The PRD asks for a bill whose total must equal the day's entries and whose breakdown must
 * reconcile with that total. That is arithmetic, so it belongs here rather than in SQL or in a
 * view. `SUM(amount)` in a query would be the wrong place: it would be a second, independent
 * implementation of the same rule, and the page and the Dashboard would then be able to
 * disagree about how much was spent — which is the one thing a money screen must never do.
 *
 * Every sum goes through the domain's own `addMinorUnits`, so a total that would exceed the exact
 * integer range is **refused** rather than silently rounded. `SUM` in SQLite would return a
 * float and quietly lose precision instead.
 *
 * ## Determinism is the whole point
 *
 * This is a bill to send to somebody. The same expenses must produce the same text, in the same
 * order, every time — so every ordering decision here is total and none of them depends on
 * object iteration or on the order rows happened to arrive in:
 *
 * - breakdown lines are sorted by amount descending, then by label;
 * - grouping is case-insensitive, so `Banana` and `banana` are one line rather than two that
 *   differ only in capitalisation;
 * - the displayed spelling of a group is the alphabetically first one present, which does not
 *   depend on which entry was recorded first.
 *
 * ## This computes a day, not a balance
 *
 * A day's spend and an account balance are different numbers and are deliberately not derived
 * from each other. A day's spend is the sum of that day's expense amounts; a balance is whatever
 * the account holds now, which includes everything spent on every previous day. Nothing here
 * reads or writes a balance, and no correction of one is implied.
 *
 * ## The day boundary
 *
 * `isEntryOnDate` compares the date prefix of a stored timestamp, which is the same comparison
 * the repository performs in SQL. It is repeated here deliberately: this module must be correct
 * even when handed rows that were not filtered, because the alternative is a bill that silently
 * includes yesterday's shopping. `scripts/expenses-test.mjs` asserts the two implementations
 * agree on the rows they share.
 *
 * Pure. No clock, no database, no network, no formatting of the result text — the wording is
 * presentation and lives in `src/features/expenses/`.
 */
import { addMinorUnits, isMoneyAmount, type MinorUnits } from "./money.ts";
import { fail, ok, type Result } from "./result.ts";
import type { AccountName } from "./accounts.ts";

/**
 * One persisted spend, as the daily bill needs to see it.
 *
 * The same facts `accounts.ExpenseDraft` holds, minus the account id: a bill talks about payment
 * methods by name, and the id is internal.
 */
export type BillableExpense = {
  readonly timestamp: string;
  readonly item: string;
  readonly amount: MinorUnits;
  readonly accountName: AccountName;
};

/** One row of a breakdown: a label and everything that rolled up into it. */
export type BreakdownLine = {
  /** How the group is written out. Chosen deterministically; see the module comment. */
  readonly label: string;
  readonly total: MinorUnits;
  /** How many entries are behind this line, which is not the same as how much. */
  readonly count: number;
};

/** Everything the PRD's daily bill contains. */
export type DailyBill = {
  /** The calendar day this bill covers, as `YYYY-MM-DD`. */
  readonly date: string;
  /** The day's total spend, equal to the sum of every included entry. */
  readonly total: MinorUnits;
  readonly count: number;
  /** Grouped by what was bought, as the PRD's "breakdown by item". */
  readonly byItem: readonly BreakdownLine[];
  /** Grouped by how it was paid, as the PRD's "breakdown by payment method". */
  readonly byAccount: readonly BreakdownLine[];
};

/** The length of the `YYYY-MM-DD` prefix of a stored timestamp. */
const DATE_LENGTH = 10;

/**
 * Whether a stored timestamp falls on the given calendar day.
 *
 * `timestamp` is the ISO string the execution clock produced, so its first ten characters are the
 * UTC date. The repository filters the same way in SQL; see the module comment.
 */
export function isEntryOnDate(timestamp: string, date: string): boolean {
  return timestamp.slice(0, DATE_LENGTH) === date;
}

/** Two labels are the same group when they differ only in case or surrounding spaces. */
function groupKey(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * The spelling to show for a group.
 *
 * The alphabetically first spelling present, compared case-insensitively first and then exactly,
 * so the choice does not depend on which entry was recorded first. Without this, the same ledger
 * could print "Banana" on one day and "banana" on another depending on row order.
 */
function preferredLabel(current: string, candidate: string): string {
  const lowered = candidate.toLowerCase();
  const currentLowered = current.toLowerCase();

  if (lowered < currentLowered) {
    return candidate;
  }

  return lowered === currentLowered && candidate < current
    ? candidate
    : current;
}

/**
 * Accumulates amounts into labelled groups.
 *
 * Each addition is validated, so a malformed entry fails the whole bill rather than producing a
 * total that quietly disagrees with the entries behind it.
 */
function accumulate(
  entries: readonly BillableExpense[],
  labelOf: (entry: BillableExpense) => string,
): Result<Map<string, BreakdownLine>> {
  const groups = new Map<string, BreakdownLine>();

  for (const entry of entries) {
    if (!isMoneyAmount(entry.amount)) {
      return fail(
        "invalid_money",
        `An expense amount must be a non-negative whole number of minor units, received ${String(
          entry.amount,
        )}.`,
        { amount: String(entry.amount) },
      );
    }

    const rawLabel = labelOf(entry);
    const key = groupKey(rawLabel);
    const existing = groups.get(key);
    const label =
      existing === undefined
        ? rawLabel
        : preferredLabel(existing.label, rawLabel);
    const sum = addMinorUnits(existing?.total ?? 0, entry.amount);

    if (!sum.ok) {
      return fail(
        "invalid_money",
        `The total for "${label}" would exceed the exact integer range and is no longer deterministic.`,
        { label, amount: entry.amount },
      );
    }

    groups.set(key, {
      label,
      total: sum.value,
      count: (existing?.count ?? 0) + 1,
    });
  }

  return ok(groups);
}

/**
 * Turns accumulated groups into ordered lines.
 *
 * Amount descending, then label ascending. Largest first, because a bill is read as a ranking of
 * where the money went, and the label tie-break keeps the order total for equal amounts.
 */
function orderedLines(
  groups: ReadonlyMap<string, BreakdownLine>,
): BreakdownLine[] {
  return [...groups.values()].sort((left, right) => {
    if (left.total !== right.total) {
      return right.total - left.total;
    }

    return left.label.localeCompare(right.label);
  });
}

/**
 * Sums amounts, validating every addition.
 *
 * The refusal matters more than it looks. Adding past `Number.MAX_SAFE_INTEGER` does not throw;
 * it quietly stops being an integer, and a total that is not an integer is not money. So this
 * returns the `Result` of the domain's own addition rather than an accumulator.
 */
function sumOf(amounts: readonly MinorUnits[]): Result<MinorUnits> {
  return amounts.reduce<Result<MinorUnits>>(
    (sum, amount) => (sum.ok ? addMinorUnits(sum.value, amount) : sum),
    ok(0),
  );
}

/**
 * Builds the PRD's daily bill from persisted expense rows.
 *
 * Entries outside `date` are ignored, so the result is correct even if the caller hands over more
 * than one day. The three parts are reconciled by construction: `total` is the sum of the
 * included entries, and both breakdowns are partitions of those same entries, so the item lines
 * sum to the total and the payment-method lines sum to the total.
 *
 * A day with nothing on it is a bill of zero, not a failure — an empty ledger is a normal state
 * and the page has to render it.
 */
export function summariseDay(
  entries: readonly BillableExpense[],
  date: string,
): Result<DailyBill> {
  const onDay = entries.filter((entry) => isEntryOnDate(entry.timestamp, date));

  const byItem = accumulate(onDay, (entry) => entry.item);

  if (!byItem.ok) {
    return byItem;
  }

  const byAccount = accumulate(onDay, (entry) => entry.accountName);

  if (!byAccount.ok) {
    return byAccount;
  }

  const total = sumOf(onDay.map((entry) => entry.amount));

  if (!total.ok) {
    return total;
  }

  return ok({
    date,
    total: total.value,
    count: onDay.length,
    byItem: orderedLines(byItem.value),
    byAccount: orderedLines(byAccount.value),
  });
}
