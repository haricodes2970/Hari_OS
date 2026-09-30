/**
 * The Expenses page: balances, and the record of what was spent.
 *
 * A Server Component, like the Kitchen page. Balances are read from the account rows and
 * formatted by the domain's own `formatMinorUnits`, which is what `listAccountViews` already
 * did — so no view repeats the money formatting, and no view recomputes a balance.
 */
import { CommandForm, type CommandField } from "@/components/CommandForm";
import { Nav } from "@/components/Nav";
import { OutcomeBanner } from "@/components/OutcomeBanner";
import {
  listAccountViews,
  listRecentExpenses,
} from "@/features/shared/queries";

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

export default function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const accounts = listAccountViews();
  const expenses = listRecentExpenses();

  return (
    <>
      <Nav currentPath="/expenses" />
      <h1>Expenses</h1>
      <OutcomeBanner searchParams={searchParams} />

      <h2>Balances</h2>
      {accounts.length === 0 ? (
        <p className="empty">No accounts exist yet.</p>
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
                <th scope="row">{account.name}</th>
                {/* A negative balance is shown as it is. Balances may go negative, and
                    hiding that behind a colour or a clamp would misrepresent the account. */}
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
                <td>{expense.accountName}</td>
                <td>{expense.formattedAmount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
