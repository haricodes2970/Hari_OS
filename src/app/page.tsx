/**
 * The Dashboard: today's spend, and what is running low.
 *
 * A Server Component. It reads state and renders it and does nothing else — the PRD's
 * requirement that a day's first screen is not a blank mind is met by showing what is
 * already stored, not by this page deciding anything.
 *
 * Both figures come from `readDashboardSummary`, which applies the domain's own rules. The
 * "today" here is a UTC date, matching how every timestamp is stored; a local date would
 * quietly disagree with the expense rows near midnight.
 */
import { Nav } from "@/components/Nav";
import { readDashboardSummary } from "@/features/shared/queries";

export const metadata = { title: "Hari OS" };
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const summary = readDashboardSummary();

  return (
    <>
      <Nav currentPath="/" />
      <h1>Dashboard</h1>
      <p className="muted">{summary.date}</p>

      <div className="tiles">
        <section className="tile">
          <h2>Spent today</h2>
          <p className="tile-value">{summary.formattedTodaySpend}</p>
          <p className="muted">
            {summary.todayExpenseCount === 0
              ? "Nothing recorded yet."
              : `Across ${summary.todayExpenseCount} ${
                  summary.todayExpenseCount === 1 ? "entry" : "entries"
                }.`}
          </p>
        </section>

        <section className="tile">
          <h2>Tracked items</h2>
          <p className="tile-value">{summary.inventoryCount}</p>
          <p className="muted">
            {summary.inventoryCount === 0
              ? "Nothing tracked yet."
              : "In the kitchen."}
          </p>
        </section>
      </div>

      <h2>Running low</h2>
      {summary.lowStockItems.length === 0 ? (
        <p className="empty">
          Nothing is low right now. An empty list here means stock is healthy,
          not that anything is missing.
        </p>
      ) : (
        <ul className="list">
          {summary.lowStockItems.map((item) => (
            <li key={item.id}>
              <strong>{item.name}</strong> — {item.quantity} {item.unit}
              {item.lowThreshold === null ? null : (
                <span className="muted"> (alert at {item.lowThreshold})</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>Today&apos;s plan</h2>
      {summary.tasks.length === 0 ? (
        <p className="empty">
          No tasks planned for today. Task planning is not part of this phase,
          so this list stays empty until it is.
        </p>
      ) : (
        <ul className="list">
          {summary.tasks.map((task) => (
            <li key={task.id}>
              {task.title}{" "}
              {task.done ? <span className="muted">done</span> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
