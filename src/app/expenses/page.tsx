/**
 * The Expenses page: balances, today's spend, the daily bill, and the record of what was spent.
 *
 * A Server Component, like the Kitchen page. Every figure below comes from
 * `src/features/expenses/view`, which reads persisted rows and applies the domain's own rules —
 * `formatMinorUnits` for money, `summariseDay` for the day. This file formats nothing, sums
 * nothing, and compares nothing, so there is no way for the page to disagree with the bill text
 * or with the Dashboard.
 *
 * ## The two numbers on this page are different numbers
 *
 * **A balance** is what an account holds now, across every day. **Today's spend** is only what
 * was spent today. They are shown separately and neither is derived from the other, because
 * conflating them is the most common way a money screen misleads: a large balance and a quiet day
 * are both normal, and neither implies the other.
 *
 * ## What a negative balance means here
 *
 * It is shown as it is. ADR-021 decided an account may be overdrawn, because the PRD defines no
 * affordability rule and inventing one would refuse spends the user's own ledger allows. So there
 * is no warning, no clamp, and no rejection — the number is the number.
 */
import { ChatInput } from "@/components/ChatInput";
import { CommandForm, type CommandField } from "@/components/CommandForm";
import { Nav } from "@/components/Nav";
import { OutcomeBanner } from "@/components/OutcomeBanner";
import { parserAvailability } from "@/features/chat/runtime";
import {
  accountLabel,
  listAccounts,
  listRecentExpenses,
  readDailyBill,
  type BreakdownView,
} from "@/features/expenses/view";

export const metadata = { title: "Expenses · Hari OS" };
export const dynamic = "force-dynamic";

const FIELDS: CommandField[] = [
  { name: "item", label: "What for", kind: "text", placeholder: "banana" },
  { name: "amount", label: "Rupees", kind: "number", min: "0", step: "0.01" },
  {
    name: "accountName",
    label: "Account",
    kind: "select",
    options: [
      { value: "cash", label: "Cash" },
      { value: "bank1", label: "Bank 1" },
      { value: "bank2", label: "Bank 2" },
    ],
  },
  {
    name: "category",
    label: "Category (optional)",
    kind: "text",
    placeholder: "groceries",
  },
];

function Breakdown({
  heading,
  lines,
  label,
  empty,
}: {
  heading: string;
  lines: readonly BreakdownView[];
  label: (name: string) => string;
  empty: string;
}) {
  return (
    <>
      <h3>{heading}</h3>
      {lines.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">What</th>
              <th scope="col">Amount</th>
              <th scope="col">Entries</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.label}>
                <th scope="row">{label(line.label)}</th>
                <td>{line.formattedTotal}</td>
                <td>{line.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export default function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const accounts = listAccounts();
  const expenses = listRecentExpenses();
  const bill = readDailyBill();
  const parser = parserAvailability();

  return (
    <>
      <Nav currentPath="/expenses" />
      <ChatInput
        searchParams={searchParams}
        returnTo="/expenses"
        available={parser.available}
        unavailableReason={parser.reason}
      />
      <h1>Expenses</h1>
      <OutcomeBanner searchParams={searchParams} />

      <h2>Balances</h2>
      {accounts.length === 0 ? (
        <p className="empty">
          No accounts exist yet. Run <code>npm run db:setup</code> to create
          cash, bank1, and bank2 at zero.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Balance</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <th scope="row">{accountLabel(account.name)}</th>
                {/* A negative balance is shown as it is. Balances may go negative, and hiding
                    that behind a clamp or a colour would misrepresent the account. */}
                <td
                  className={
                    account.balance < 0 ? "amount-negative" : undefined
                  }
                >
                  {account.formattedBalance}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <CommandForm
        kind="expense.record"
        returnTo="/expenses"
        heading="Record an expense"
        submitLabel="Record expense"
        fields={FIELDS}
      />

      <h2>Today&apos;s spend</h2>
      {bill === null ? (
        <p className="empty">
          Today&apos;s total could not be computed from the recorded entries.
          Nothing has been changed.
        </p>
      ) : (
        <>
          <p className="tile-value">{bill.formattedTotal}</p>
          <p className="muted">
            {bill.count === 0
              ? "Nothing has been spent today. This is the day's total, not an account balance."
              : `Spent across ${bill.count} ${bill.count === 1 ? "entry" : "entries"} today. This is the day's total, not an account balance.`}
          </p>

          <Breakdown
            heading="By item"
            lines={bill.byItem}
            label={(name) => name}
            empty="No items to break down yet."
          />
          <Breakdown
            heading="By payment method"
            lines={bill.byAccount}
            label={accountLabel}
            empty="No payment methods used yet."
          />

          <p className="muted">
            The item lines and the payment-method lines each add up to{" "}
            {bill.formattedTotal}.{" "}
            <a href="/expenses/daily-bill">Open today&apos;s bill as text</a> to
            copy or send it.
          </p>
        </>
      )}

      <h2>Recent expenses</h2>
      {expenses.length === 0 ? (
        <p className="empty">Nothing spent yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">What</th>
              <th scope="col">Account</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((expense, index) => (
              <tr key={`${expense.timestamp}-${index}`}>
                <td>{expense.timestamp.slice(0, 16).replace("T", " ")}</td>
                <th scope="row">
                  {expense.item}
                  {expense.category === null ? null : (
                    <span className="tag"> {expense.category}</span>
                  )}
                </th>
                <td>{accountLabel(expense.accountName)}</td>
                <td>{expense.formattedAmount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Correcting a mistake</h2>
      <p className="muted">
        The expense ledger stores one entry per spend and each amount is a real
        spend, so a wrong entry cannot be reversed without deleting financial
        history. That is why there is no &quot;undo&quot; button here, unlike on
        the Kitchen page: inventory is a signed delta log and can be corrected
        honestly, and this ledger is not. Recording the corrected spend and
        adjusting the account balance manually remains the honest path today.
      </p>
    </>
  );
}
