/**
 * The Dashboard: the day's command center.
 *
 * A Server Component. It renders what the application already knows and nothing else. Every value
 * on this page comes from `readDashboard`, which composes the Kitchen, Expenses, and Routine read
 * sides and reads `habit_log`; this file formats nothing, sums nothing, and compares nothing, so
 * the page cannot disagree with the Kitchen page, the Expenses page, the bill, or the Routine
 * page.
 *
 * ## The order on the screen is the order of the questions
 *
 * 1. **Say what happened** — the shared natural-language input, because in this application
 *    recording something is the first thing a person does.
 * 2. **What matters today** — the tasks written last night, and the first one not yet done.
 * 3. **How the night went** — the sleep actually recorded, so the morning starts from it.
 * 4. **What needs attention** — what is running low.
 * 5. **What changed** — today's spend, from the same rows the daily bill uses.
 *
 * ## What this page refuses to do
 *
 * - **It does not suggest a decision.** The "first action" is the first task the user wrote down
 *   that is not done. It is not ranked, scored, generated, or reordered, and no model is involved
 *   in producing any word on this page.
 * - **It does not fabricate a future module.** Skills, Habits, and Photo Diary are later phases.
 *   Where the PRD's Dashboard expects one, this page says plainly that it is not available yet,
 *   rather than showing an empty list that would read as "you have no skills" or "your laundry is
 *   fine".
 * - **It does not judge the night.** The sleep card reports what was recorded and counts
 *   consecutive days with a wake time in the PRD's range. It does not score sleep, grade it,
 *   compare it to a target, or turn a missing entry into a failure.
 * - **It does not mutate anything.** There is no Dashboard endpoint. Every change on this
 *   application goes through `POST /api/commands` or `POST /api/kitchen`, and the Dashboard only
 *   sends you there.
 */
import { ChatInput } from "@/components/ChatInput";
import { Nav } from "@/components/Nav";
import { OutcomeBanner } from "@/components/OutcomeBanner";
import { WAKE_WINDOW_END, WAKE_WINDOW_START } from "@/domain/sleep";
import { parserAvailability } from "@/features/chat/runtime";
import {
  readDashboard,
  type DashboardHabitLine,
  type DashboardTaskLine,
} from "@/features/dashboard/view";

export const metadata = { title: "Hari OS" };
export const dynamic = "force-dynamic";

/** How a habit type is written when a person reads it. */
const HABIT_LABELS: Readonly<Record<string, string>> = {
  cooking: "Cooking",
  dishes: "Dishes",
  laundry: "Laundry",
};

/**
 * The habits the PRD names for the Dashboard, in its own order.
 *
 * Rendered from this list rather than from whatever rows happen to exist, so an absent entry reads
 * as "not recorded" instead of vanishing. The difference matters: an entry that is missing is not
 * the same claim as an entry that says `done = 0`, and only the second one is a statement about
 * the user's day.
 */
const TRACKED_HABITS = ["dishes", "laundry"] as const;

function habitLabel(type: string): string {
  return HABIT_LABELS[type] ?? type;
}

function Tasks({ tasks }: { tasks: readonly DashboardTaskLine[] }) {
  return (
    <ol className="list">
      {tasks.map((task) => (
        <li key={task.id}>
          {task.title} {task.done ? <span className="muted">done</span> : null}
        </li>
      ))}
    </ol>
  );
}

function Habits({ habits }: { habits: readonly DashboardHabitLine[] }) {
  const byType = new Map(habits.map((entry) => [entry.type, entry] as const));

  return (
    <ul className="list">
      {TRACKED_HABITS.map((type) => {
        const entry = byType.get(type);

        return (
          <li key={type}>
            {habitLabel(type)} —{" "}
            {entry === undefined ? (
              <span className="muted">not recorded</span>
            ) : entry.done ? (
              <span className="muted">
                recorded as done{entry.hasPhoto ? ", with a photo" : ""}
              </span>
            ) : (
              <span className="muted">recorded as not done</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const dashboard = readDashboard();
  const parser = parserAvailability();

  return (
    <>
      <Nav currentPath="/" />
      <ChatInput
        searchParams={searchParams}
        returnTo="/"
        available={parser.available}
        unavailableReason={parser.reason}
      />
      <h1>Dashboard</h1>
      <p className="muted">{dashboard.date}</p>
      <OutcomeBanner searchParams={searchParams} />

      <h2>Today&apos;s top {dashboard.taskCount === 1 ? "task" : "tasks"}</h2>
      {dashboard.taskCount === 0 ? (
        <p className="empty">
          Nothing is planned for today. Write tomorrow&apos;s tasks on the{" "}
          <a href="/routine">Routine page</a>, or say &quot;add buy milk
          tomorrow&quot; here. This application does not choose tasks for you,
          so an empty list stays empty until you write one.
        </p>
      ) : (
        <>
          <Tasks tasks={dashboard.tasks} />
          {dashboard.taskCount > dashboard.tasks.length ? (
            <p className="muted">
              Showing the first {dashboard.tasks.length} of{" "}
              {dashboard.taskCount} planned tasks.
            </p>
          ) : null}
        </>
      )}

      <h2>Suggested first action</h2>
      <p>
        {dashboard.suggestedFirstAction === null ? (
          dashboard.taskCount === 0 ? (
            <span className="muted">
              No suggestion, because no task is planned for today. Nothing is
              chosen for you.
            </span>
          ) : (
            <span className="muted">
              Everything planned for today is already done.
            </span>
          )
        ) : (
          dashboard.suggestedFirstAction
        )}
      </p>

      <h2>Last night</h2>
      {dashboard.sleep.recorded === false ? (
        <p className="empty">
          No sleep has been recorded for last night. Record it on the{" "}
          <a href="/routine">Routine page</a>, or say &quot;I woke up at
          07:10&quot;. A night that was not written down is not a bad night.
        </p>
      ) : (
        <ul className="list">
          <li>
            Went to bed{" "}
            {dashboard.sleep.bedtime ?? (
              <span className="muted">not recorded</span>
            )}
          </li>
          <li>
            Woke up{" "}
            {dashboard.sleep.wakeTime ?? (
              <span className="muted">not recorded</span>
            )}
          </li>
          <li>
            In bed{" "}
            {dashboard.sleep.inBed ?? (
              <span className="muted">waiting on a wake time</span>
            )}
          </li>
        </ul>
      )}
      {dashboard.consistencyDays > 0 ? (
        <p className="muted">
          {dashboard.consistencyDays} consecutive{" "}
          {dashboard.consistencyDays === 1 ? "day" : "days"} with a wake time
          between {WAKE_WINDOW_START} and {WAKE_WINDOW_END}. A record of what
          happened, not a target and not a score.
        </p>
      ) : null}
      <p className="muted">
        {dashboard.tomorrowPlanned ? (
          <>
            Tomorrow already has a plan, written last night.{" "}
            <a href="/routine">Change it</a> if the day moved.
          </>
        ) : (
          <>
            Tomorrow has no plan yet.{" "}
            <a href="/routine">Write tonight&apos;s check-in</a> so tomorrow
            morning opens on tasks you chose while writing them down.
          </>
        )}
      </p>

      <h2>Running low</h2>
      {dashboard.inventoryCount === 0 ? (
        <p className="empty">
          Nothing is tracked in the kitchen yet, so there is nothing to run low.
          Start tracking an item on the <a href="/kitchen">Kitchen page</a>.
        </p>
      ) : dashboard.lowStock.length === 0 ? (
        <p className="empty">
          Nothing is low right now. All {dashboard.inventoryCount} tracked{" "}
          {dashboard.inventoryCount === 1 ? "item is" : "items are"} above
          {dashboard.inventoryCount === 1 ? " its" : " their"} alert level. An
          empty list here means stock is healthy, not that anything is missing.
        </p>
      ) : (
        <ul className="list">
          {dashboard.lowStock.map((item) => (
            <li key={item.id}>
              <span className="badge badge-low">low</span>{" "}
              <strong>{item.name}</strong> — {item.quantity} {item.unit}
              {item.lowThreshold === null ? null : (
                <span className="muted"> (alert at {item.lowThreshold})</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>Today&apos;s spend</h2>
      {dashboard.spend.computed === false ? (
        <p className="empty">
          Today&apos;s total could not be computed from the recorded entries.
          Nothing has been changed, and this is not a zero.
        </p>
      ) : (
        <>
          <p className="tile-value">{dashboard.spend.formattedTotal}</p>
          <p className="muted">
            {dashboard.spend.count === 0
              ? "Nothing has been spent today. This is the day's total, not an account balance."
              : `Spent across ${dashboard.spend.count} ${
                  dashboard.spend.count === 1 ? "entry" : "entries"
                } today. This is the day's total, not an account balance.`}
          </p>
          <p className="muted">
            <a href="/expenses">Open Expenses</a> for balances and history, or{" "}
            <a href="/expenses/daily-bill">read today&apos;s bill as text</a>.
          </p>
        </>
      )}

      <h2>Dishes and laundry</h2>
      <Habits habits={dashboard.habits} />
      <p className="muted">
        <a href="/habits">Open Habits</a> to record dishes, cooking, and
        laundry, to enter screen time, and to read the private log and the Photo
        Diary. A line above reads as recorded only if a row already says so.
      </p>

      <h2>I feel like scrolling</h2>
      {dashboard.skillsAvailable ? (
        <p className="empty">
          <a href="/skills">Open the replacement list</a>. The full list is
          always shown, and you pick from it — nothing is ever chosen for you.
        </p>
      ) : (
        <p className="empty">
          The replacement-activity list is not available yet. It is part of the
          Skills module, which has not been built. When it exists it will list
          every skill and let you choose, because choosing is the point.
        </p>
      )}
    </>
  );
}
