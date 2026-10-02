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
 * ## The bars do not add anything up
 *
 * The two breakdowns draw a bar per line using that line's own share of the day's total, and the
 * amount beside each bar is the domain's already-formatted figure. The bars are a way of seeing the
 * split; the numbers they sit next to are the numbers the daily bill prints. Nothing on this page
 * could produce a total the bill would disagree with, because nothing on this page computes a
 * total.
 *
 * ## What a negative balance means here
 *
 * It is shown as it is. ADR-021 decided an account may be overdrawn, because the PRD defines no
 * affordability rule and inventing one would refuse spends the user's own ledger allows. So there
 * is no warning, no clamp, and no rejection — the number is the number.
 */
import { CommandBox } from "@/components/CommandBox";
import { CommandForm, type CommandField } from "@/components/CommandForm";
import { OutcomeBanner } from "@/components/OutcomeBanner";
import {
  BreakdownRow,
  Card,
  CardGrid,
  CardLink,
  ColumnChart,
  Empty,
  PageHeader,
  Section,
  Status,
} from "@/components/ui";
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

const RETURN_TO = "/expenses";

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

/**
 * A share of the day's total, as the width of a bar.
 *
 * This is presentation geometry and nothing else: `line.total` divided by the bill's own total, so
 * the widest bar is always the whole day. It is not a rule about money — the domain owns that — and
 * it is never shown next to a figure it could contradict, because the figure beside it is the
 * domain's own formatted amount rather than anything computed here.
 */
function share(total: number, of: number): number {
  return of <= 0 ? 0 : Math.round((total / of) * 100);
}

/** One breakdown, as labelled bars. */
function Breakdown({
  title,
  lines,
  total,
  label,
  empty,
}: {
  readonly title: string;
  readonly lines: readonly BreakdownView[];
  /** The day's total, taken from the bill rather than summed from these lines. */
  readonly total: number;
  readonly label: (name: string) => string;
  readonly empty: string;
}) {
  return (
    <Card title={title}>
      {lines.length === 0 ? (
        <Empty compact>{empty}</Empty>
      ) : (
        <div className="viz">
          {lines.map((line) => (
            <BreakdownRow
              key={line.label}
              label={label(line.label)}
              value={line.formattedTotal}
              share={share(line.total, total)}
            />
          ))}
        </div>
      )}
    </Card>
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

  /*
    The lines the chart draws. It is the day's own bill, grouped by the domain, and a line with
    nothing in it is dropped rather than drawn as an empty bar. The chart turns these amounts into
    heights; this page works out no total of its own.
  */
  const chartLines = (bill === null ? [] : bill.byItem).filter(
    (line) => line.total > 0,
  );

  return (
    <div className="page">
      <PageHeader
        title="Expenses"
        description="What each account holds, what today cost, and everything that has been spent."
        aside={
          <a className="button button-accent" href="#record-expense">
            <span aria-hidden="true">+</span> Add expense
          </a>
        }
      />

      <CommandBox
        searchParams={searchParams}
        returnTo={RETURN_TO}
        available={parser.available}
        unavailableReason={parser.reason}
      />

      <OutcomeBanner searchParams={searchParams} />

      <Section
        title="Today"
        description="The day's total, which is a different number from what an account holds."
      >
        <CardGrid>
          <Card title="Today's spend" icon={<WalletGlyph />}>
            {bill === null ? (
              <Empty compact>
                Today&apos;s total could not be computed from the recorded
                entries. Nothing has been changed.
              </Empty>
            ) : (
              <div className="metric">
                <span className="metric-value">{bill.formattedTotal}</span>
                <span className="metric-note">
                  {bill.count === 0
                    ? "Nothing has been spent today."
                    : `Spent across ${bill.count} ${
                        bill.count === 1 ? "entry" : "entries"
                      } today.`}{" "}
                  This is the day&apos;s total, not an account balance.
                </span>
              </div>
            )}
          </Card>

          {/* Titled "Balances" because that is what these numbers are: what an account holds. */}
          <Card title="Balances" icon={<WalletGlyph />}>
            {accounts.length === 0 ? (
              <Empty compact>
                No accounts exist yet. Run <code>npm run db:setup</code> to
                create cash, bank1, and bank2 at zero.
              </Empty>
            ) : (
              <div className="viz">
                {accounts.map((account) => (
                  <div key={account.id} className="row-between">
                    <span className="row-title">
                      {accountLabel(account.name)}
                    </span>
                    <span
                      className={
                        account.balance < 0
                          ? "figure amount-negative"
                          : "figure"
                      }
                    >
                      {account.formattedBalance}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </CardGrid>
      </Section>

      {bill === null ? null : (
        <Section
          title="Today's breakdown"
          description={
            <>
              The item lines and the payment-method lines each add up to{" "}
              {bill.formattedTotal}.{" "}
              <a href="/expenses/daily-bill">Open today&apos;s bill as text</a>{" "}
              to copy or send it.
            </>
          }
        >
          {/*
            The same bill, as columns. This is not a second breakdown of the data: the two cards
            below group it by item and by payment method, and this groups it by item too, drawn
            vertically. There is no time axis and no history, because there is no stored history to
            draw — one column per line the domain produced for today, and nothing invented to fill
            the space either side of them.
          */}
          {chartLines.length === 0 ? null : (
            <Card title="Today at a glance" icon={<ChartGlyph />}>
              <ColumnChart
                columns={chartLines.map((line) => ({
                  label: line.label,
                  total: line.total,
                  value: line.formattedTotal,
                }))}
              />
            </Card>
          )}

          <CardGrid>
            <Breakdown
              title="By item"
              lines={bill.byItem}
              total={bill.total}
              label={(name) => name}
              empty="No items to break down yet."
            />
            <Breakdown
              title="By payment method"
              lines={bill.byAccount}
              total={bill.total}
              label={accountLabel}
              empty="No payment methods used yet."
            />
          </CardGrid>
        </Section>
      )}

      <Section title="Record an expense" id="record-expense">
        <div className="form-grid">
          <CommandForm
            kind="expense.record"
            returnTo={RETURN_TO}
            submitLabel="Record expense"
            fields={FIELDS}
          />
        </div>
      </Section>

      <Section
        title="Recent expenses"
        description="Newest first."
        actions={<Status>{expenses.length} shown</Status>}
      >
        {expenses.length === 0 ? (
          <Empty>Nothing spent yet.</Empty>
        ) : (
          <ul className="row-list">
            {expenses.map((expense, index) => (
              <li key={`${expense.timestamp}-${index}`} className="row">
                <div className="row-main">
                  <span className="row-title">
                    {expense.item}
                    {expense.category === null ? null : (
                      <>
                        {" "}
                        · <span className="tag">{expense.category}</span>
                      </>
                    )}
                  </span>
                  <span className="meta">
                    {expense.timestamp.slice(0, 16).replace("T", " ")} ·{" "}
                    {accountLabel(expense.accountName)}
                  </span>
                </div>
                <div className="row-aside">
                  <span className="figure">{expense.formattedAmount}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Correcting a mistake">
        <Card>
          <p className="muted">
            The expense ledger stores one entry per spend and each amount is a
            real spend, so a wrong entry cannot be reversed without deleting
            financial history. That is why there is no &quot;undo&quot; button
            here, unlike on the Kitchen page: inventory is a signed delta log
            and can be corrected honestly, and this ledger is not. Recording the
            corrected spend and adjusting the account balance manually remains
            the honest path today.
          </p>
          <CardLink href="/expenses/daily-bill">
            Read today&apos;s bill as text
          </CardLink>
        </Card>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Glyphs

   Inline SVG rather than an icon library: the application has no icon dependency and adding one
   for two shapes would be a larger change than the shapes. Each is `aria-hidden`, because the card
   it sits beside already names the thing in words.
   --------------------------------------------------------------------------- */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function WalletGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <path d="M4 7.5A2.5 2.5 0 016.5 5H18v3" />
      <rect x="4" y="7.5" width="16" height="12" rx="2.5" />
      <path d="M15 13.5h2.5" />
    </svg>
  );
}

function ChartGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <path d="M4 20h16" />
      <rect x="6" y="12" width="3.2" height="5" rx="0.8" />
      <rect x="11.4" y="8" width="3.2" height="9" rx="0.8" />
      <rect x="16.8" y="4.5" width="3.2" height="12.5" rx="0.8" />
    </svg>
  );
}
