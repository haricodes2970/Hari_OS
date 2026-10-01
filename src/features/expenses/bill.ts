/**
 * The daily bill as text: the PRD's shareable summary to send to somebody.
 *
 * ## This is application output, not generated prose
 *
 * The PRD wants a bill "as shareable text to send to his father". Every character below is
 * produced by this repository from persisted expense rows, through the domain's own
 * `summariseDay` and `formatMinorUnits`. No model is involved, at any point, in writing any of
 * it. That is not a stylistic preference: a summary whose words were chosen by a model is a
 * summary whose numbers can be influenced by a sentence someone typed an hour ago.
 *
 * ## Determinism
 *
 * The same expenses and the same date produce byte-identical text. That is what makes the text
 * safe to send to somebody: two copies of "today's bill" cannot disagree, and there is no
 * timestamp-of-generation, no random ordering, and no id in the output that would differ between
 * two runs over the same data.
 *
 * ## What it deliberately does not contain
 *
 * No internal account or expense ids, no database or file paths, no credentials, and nothing the
 * user did not record. The text is also written to be read on a phone by somebody who is not
 * going to read a table, so the breakdown is a flat list.
 *
 * Pure. No clock, no database, no network — the date is an argument, supplied by the caller.
 */
import type { BreakdownLine, DailyBill } from "@/domain/expenses";
import { formatMinorUnits } from "@/domain/money";

/**
 * How an account is written when a human reads the bill.
 *
 * A closed map rather than a transformation of the stored name: `bank1` becomes "Bank 1" and
 * nothing else does. The stored name is what the ledger records; this is only how it reads. An
 * account outside the map is impossible while the schema's CHECK holds, and it falls back to the
 * stored name rather than to an empty string, so a display can never go blank on money.
 *
 * The single source for this label: the page imports it from here rather than keeping its own
 * copy, because two maps that disagree would print the same payment method two different ways.
 */
const ACCOUNT_LABELS: Readonly<Record<string, string>> = {
  cash: "Cash",
  bank1: "Bank 1",
  bank2: "Bank 2",
};

/** How an account name reads in a sentence. */
export function accountLabel(name: string): string {
  return ACCOUNT_LABELS[name] ?? name;
}

/**
 * One breakdown line as text.
 *
 * The count is included when a line covers more than one entry, because "groceries ₹50.00
 * (2 entries)" is a materially different statement from "groceries ₹50.00" and a bill that hid
 * that would look like less was spent than was.
 */
function lineText(
  line: BreakdownLine,
  label: (name: string) => string,
): string {
  const amount = formatMinorUnits(line.total);
  const name = label(line.label);

  return line.count > 1
    ? `${name} — ${amount} (${line.count} entries)`
    : `${name} — ${amount}`;
}

/** A day's bill as plain text, ready to be copied or sent. */
export function dailyBillText(bill: DailyBill): string {
  const lines: string[] = [
    `Hari OS daily bill — ${bill.date}`,
    `Total spent: ${formatMinorUnits(bill.total)}`,
  ];

  if (bill.count === 0) {
    lines.push("Nothing was spent on this day.");

    return `${lines.join("\n")}\n`;
  }

  lines.push(`${bill.count} ${bill.count === 1 ? "entry" : "entries"}.`);

  if (bill.byItem.length > 0) {
    lines.push("", "By item:");
    for (const line of bill.byItem) {
      lines.push(`- ${lineText(line, (name) => name)}`);
    }
  }

  if (bill.byAccount.length > 0) {
    lines.push("", "By payment method:");
    for (const line of bill.byAccount) {
      lines.push(`- ${lineText(line, accountLabel)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
