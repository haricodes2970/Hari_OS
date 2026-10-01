/**
 * The Expenses read side: balances, the day's spend, and the daily bill.
 *
 * ## Presentation, not arithmetic
 *
 * This module fetches persisted rows and applies domain rules to them. It adds no rules of its
 * own: today's spend is `summariseDay`, every amount is formatted by `formatMinorUnits`, and a
 * day is identified by the runtime's own `currentUtcDate`. Nothing here adds, subtracts, or
 * compares money, and nothing here reads a clock of its own.
 *
 * **A day's spend is not a balance.** They are separate reads and they are allowed to disagree in
 * the way the user expects: a balance is what an account holds now, including every earlier day,
 * while a day's spend is only what was spent on that day. Nothing in this file derives one from
 * the other.
 *
 * ## Why the rows are read rather than summed in SQL
 *
 * The bill needs the individual entries to break them down, and the breakdown must reconcile
 * with the total. Reading the rows and aggregating in the domain means one implementation of that
 * rule, so the bill's total and the Dashboard's figure come from the same arithmetic.
 *
 * Server-only.
 */
import "server-only";

import type { AccountName } from "@/domain/accounts";
import type { BreakdownLine, DailyBill } from "@/domain/expenses";
import { summariseDay } from "@/domain/expenses";
import { formatMinorUnits, type MinorUnits } from "@/domain/money";

import { currentUtcDate, getRepositories } from "../shared/command-runtime.ts";

import { accountLabel, dailyBillText } from "./bill.ts";

/** Re-exported so a view can label an account without keeping its own map. */
export { accountLabel };

/** One account line, as the Expenses page needs it. */
export type AccountLine = {
  readonly id: number;
  readonly name: AccountName;
  readonly balance: MinorUnits;
  /** Pre-formatted, so no view has to invent a way to show money. */
  readonly formattedBalance: string;
};

/** One past spend. */
export type ExpenseLine = {
  readonly timestamp: string;
  readonly item: string;
  readonly amount: MinorUnits;
  readonly formattedAmount: string;
  readonly accountName: AccountName;
  readonly category: string | null;
};

export type BreakdownView = {
  readonly label: string;
  readonly formattedTotal: string;
  readonly total: MinorUnits;
  readonly count: number;
};

export type DailyBillView = {
  readonly date: string;
  readonly total: MinorUnits;
  readonly formattedTotal: string;
  readonly count: number;
  readonly byItem: readonly BreakdownView[];
  readonly byAccount: readonly BreakdownView[];
  /** The same bill as plain text, byte-identical across runs over the same data. */
  readonly text: string;
};

function toBreakdownView(lines: readonly BreakdownLine[]): BreakdownView[] {
  return lines.map((line) => ({
    label: line.label,
    total: line.total,
    formattedTotal: formatMinorUnits(line.total),
    count: line.count,
  }));
}

export function listAccounts(): AccountLine[] {
  return getRepositories()
    .display.listAccounts()
    .map((account) => ({
      id: account.id,
      name: account.name,
      balance: account.balance,
      formattedBalance: formatMinorUnits(account.balance),
    }));
}

export function listRecentExpenses(limit = 10): ExpenseLine[] {
  return getRepositories()
    .display.recentExpenses(limit)
    .map((expense) => ({
      timestamp: expense.timestamp,
      item: expense.item,
      amount: expense.amount,
      formattedAmount: formatMinorUnits(expense.amount),
      accountName: expense.accountName,
      category: expense.category,
    }));
}

/**
 * The bill for one day, built from that day's persisted rows.
 *
 * A day is passed in rather than read here, so a caller can render any date and the function stays
 * free of ambient time.
 *
 * Returns `null` if the domain refuses — which it can only do for a malformed amount or a total
 * past the exact integer range. A caller must render that as "the bill could not be computed", not
 * as a zero total: reporting ₹0.00 for a day whose entries were never added up would tell the
 * user nothing was spent, which is a claim this application cannot make.
 */
export function readDailyBill(
  date: string = currentUtcDate(),
): DailyBillView | null {
  const rows = getRepositories().display.expensesForDate(date);
  const bill = summariseDay(rows, date);

  if (!bill.ok) {
    return null;
  }

  return toBillView(bill.value);
}

export function toBillView(bill: DailyBill): DailyBillView {
  return {
    date: bill.date,
    total: bill.total,
    formattedTotal: formatMinorUnits(bill.total),
    count: bill.count,
    byItem: toBreakdownView(bill.byItem),
    byAccount: toBreakdownView(bill.byAccount),
    text: dailyBillText(bill),
  };
}
