/**
 * The Dashboard: the day's command centre.
 *
 * A Server Component. It renders what the application already knows and nothing else. Every value
 * below comes from a feature's read side — `readDashboard` for the day's own composition, plus
 * `readSkills` for the replacement list — and this file formats text, sums nothing, compares
 * nothing, and ranks nothing. That is why the page cannot disagree with the Kitchen page, the
 * Expenses page, the bill, or the Routine page: there is no second calculation anywhere on it.
 *
 * ## The order on the screen is the order of the questions
 *
 * 1. **Say what happened** — the command box, because recording something is the first thing a
 *    person does.
 * 2. **What do I need to know right now** — one card per module, each answering its own question.
 *
 * Each card is sized to its content rather than filling a grid cell, so a day with nothing in it
 * does not leave a row of empty boxes.
 *
 * ## What this page refuses to do
 *
 * - **It does not suggest a decision.** The "first action" is the first task the user wrote down
 *   that is not done. It is not ranked, scored, generated, or reordered, and no model is involved
 *   in producing any word on this page.
 * - **It does not carry private content.** The diary and the private log are read in exactly one
 *   place each — their own pages — and `npm run lint` refuses any other reader. The Diary card
 *   below is therefore a *link*, with no photograph, no note, and no count of entries. A count
 *   would still be a statement about rows this page has no business holding.
 * - **It does not judge the night.** The sleep card reports what was recorded and counts
 *   consecutive days with a wake time in the PRD's range. It does not score sleep, grade it,
 *   compare it to a target, or turn a missing entry into a failure.
 * - **It does not show account balances.** Today's spend is the day's total, which is a different
 *   number from what an account holds. The Expenses page owns balances; this page reports what was
 *   spent today.
 * - **It does not mutate anything.** There is no Dashboard endpoint. Every change goes through
 *   `POST /api/commands`, `POST /api/commands/parse`, or `POST /api/kitchen`.
 */
import { CommandBox } from "@/components/CommandBox";
import { OutcomeBanner } from "@/components/OutcomeBanner";
import {
  Card,
  CardGrid,
  CardLink,
  Empty,
  PageHeader,
  Section,
  Stat,
  Status,
} from "@/components/ui";
import { WAKE_WINDOW_END, WAKE_WINDOW_START } from "@/domain/sleep";
import { parserAvailability } from "@/features/chat/runtime";
import { readDashboard } from "@/features/dashboard/view";
import { readSkills } from "@/features/skills/view";
import { nowTimestamp } from "@/features/shared/command-runtime";

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

/**
 * The greeting, from the hour.
 *
 * Three bands rather than five: "good morning" covers getting up, "good afternoon" covers the
 * middle of the day, and "good evening" covers everything after. A finer scale would be showing
 * off. The hour is read from the one module allowed to read a clock, and only the word is derived
 * here — no rule about what a day is lives in this file.
 */
function greeting(): string {
  const hour = Number.parseInt(nowTimestamp().slice(11, 13), 10);

  if (hour < 12) {
    return "Good morning";
  }

  return hour < 17 ? "Good afternoon" : "Good evening";
}

/** A date rendered the way a person writes one, from the UTC day the application stores. */
function readableDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }

  return parsed.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export default function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const dashboard = readDashboard();
  const skills = readSkills();
  const parser = parserAvailability();

  const doneTasks = dashboard.tasks.filter((task) => task.done).length;

  const habitByType = new Map(
    dashboard.habits.map((entry) => [entry.type, entry] as const),
  );

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        description={`${greeting()} — here is today.`}
        aside={<p className="meta">{readableDate(dashboard.date)}</p>}
      />

      <CommandBox
        searchParams={searchParams}
        returnTo="/"
        available={parser.available}
        unavailableReason={parser.reason}
      />

      <OutcomeBanner searchParams={searchParams} />

      <Section title="Today at a glance">
        <CardGrid wide>
          {/* --- Tasks ---------------------------------------------------- */}
          <Card
            title="Today's tasks"
            aside={
              dashboard.taskCount === 0 ? null : (
                <Status tone="accent">
                  {doneTasks}/{dashboard.taskCount} done
                </Status>
              )
            }
            foot={<CardLink href="/routine">Open Routine</CardLink>}
          >
            {dashboard.taskCount === 0 ? (
              <Empty compact>
                Nothing is planned for today. Write tomorrow&apos;s tasks on the{" "}
                <a href="/routine">Routine page</a>, or say &quot;add buy milk
                tomorrow&quot; here. This application does not choose tasks for
                you, so an empty list stays empty until you write one.
              </Empty>
            ) : (
              <ul className="list">
                {dashboard.tasks.map((task) => (
                  <li key={task.id} className="row-between">
                    <span className={task.done ? "muted" : undefined}>
                      {task.title}
                    </span>
                    {task.done ? (
                      <Status tone="positive">Done</Status>
                    ) : (
                      <Status>Not done</Status>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/*
              The first action is stated in every case, including the two that produce no action
              at all — and the two are worded differently, because "nothing is planned" and
              "everything is done" are different situations and the page must not blur them.
            */}
            <div className="stack-sm">
              {dashboard.taskCount > dashboard.tasks.length ? (
                <p className="meta">
                  Showing the first {dashboard.tasks.length} of{" "}
                  {dashboard.taskCount} planned tasks.
                </p>
              ) : null}
              <p className="meta">
                {dashboard.suggestedFirstAction === null
                  ? dashboard.taskCount === 0
                    ? "No suggestion, because no task is planned for today. Nothing is chosen for you."
                    : "Everything planned for today is already done."
                  : `Next: ${dashboard.suggestedFirstAction}`}
              </p>
            </div>
          </Card>

          {/* --- Kitchen -------------------------------------------------- */}
          <Card
            title="Kitchen"
            aside={
              <Status
                tone={dashboard.lowStock.length > 0 ? "warning" : "neutral"}
              >
                {dashboard.lowStock.length === 0
                  ? "Stock healthy"
                  : `${dashboard.lowStock.length} low`}
              </Status>
            }
            foot={<CardLink href="/kitchen">Open Kitchen</CardLink>}
          >
            {dashboard.inventoryCount === 0 ? (
              <Empty compact>
                Nothing is tracked in the kitchen yet, so there is nothing to
                run low. Start tracking an item on the{" "}
                <a href="/kitchen">Kitchen page</a>.
              </Empty>
            ) : dashboard.lowStock.length === 0 ? (
              <Empty compact>
                Nothing is low right now. All {dashboard.inventoryCount} tracked{" "}
                {dashboard.inventoryCount === 1 ? "item is" : "items are"} above
                {dashboard.inventoryCount === 1 ? " its" : " their"} alert
                level. An empty list here means stock is healthy, not that
                anything is missing.
              </Empty>
            ) : (
              <ul className="list">
                {dashboard.lowStock.map((item) => (
                  <li key={item.id} className="row-between">
                    <span className="row-main">
                      <span className="row-title">{item.name}</span>
                      {item.lowThreshold === null ? null : (
                        <span className="meta">
                          alert at {item.lowThreshold}
                        </span>
                      )}
                    </span>
                    <span className="row-aside">
                      <span className="figure">
                        {item.quantity} {item.unit}
                      </span>
                      <Status tone="warning">Low</Status>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* --- Expenses ------------------------------------------------- */}
          {/*
            Today's spend only. Balances belong to the Expenses page: a balance is what an
            account holds across every day, and putting the two numbers on one card is the most
            common way a money screen misleads.
          */}
          <Card
            title="Expenses"
            aside={
              dashboard.spend.computed ? (
                <Status>{dashboard.spend.count} entries</Status>
              ) : null
            }
            foot={<CardLink href="/expenses">Open Expenses</CardLink>}
          >
            {dashboard.spend.computed === false ? (
              <Empty compact>
                Today&apos;s total could not be computed from the recorded
                entries. Nothing has been changed, and this is not a zero.
              </Empty>
            ) : (
              <Stat
                label="Spent today"
                value={dashboard.spend.formattedTotal}
                size="lg"
                note={
                  dashboard.spend.count === 0
                    ? "Nothing has been spent today. This is the day's total, not an account balance."
                    : `Spent across ${dashboard.spend.count} ${
                        dashboard.spend.count === 1 ? "entry" : "entries"
                      } today. This is the day's total, not an account balance.`
                }
              />
            )}
          </Card>

          {/* --- Sleep ---------------------------------------------------- */}
          <Card
            title="Last night"
            aside={
              dashboard.sleep.recorded ? (
                <Status tone="positive">Recorded</Status>
              ) : (
                <Status>Not recorded</Status>
              )
            }
            foot={<CardLink href="/routine">Record sleep</CardLink>}
          >
            {dashboard.sleep.recorded === false ? (
              <Empty compact>
                No sleep has been recorded for last night. Record it on the{" "}
                <a href="/routine">Routine page</a>, or say &quot;I woke up at
                07:10&quot;. A night that was not written down is not a bad
                night.
              </Empty>
            ) : (
              <div className="stack">
                <div className="row-between">
                  <span className="muted">Went to bed</span>
                  <span className="figure">
                    {dashboard.sleep.bedtime ?? (
                      <span className="muted">not recorded</span>
                    )}
                  </span>
                </div>
                <div className="row-between">
                  <span className="muted">Woke up</span>
                  <span className="figure">
                    {dashboard.sleep.wakeTime ?? (
                      <span className="muted">not recorded</span>
                    )}
                  </span>
                </div>
                {dashboard.sleep.inBed === null ? null : (
                  <div className="row-between">
                    <span className="muted">In bed</span>
                    <span className="figure">{dashboard.sleep.inBed}</span>
                  </div>
                )}
                {dashboard.sleep.asleep === null ? null : (
                  <div className="row-between">
                    <span className="muted">Asleep</span>
                    <span className="figure">{dashboard.sleep.asleep}</span>
                  </div>
                )}
                {dashboard.consistencyDays > 0 ? (
                  <p className="meta">
                    {dashboard.consistencyDays} consecutive{" "}
                    {dashboard.consistencyDays === 1 ? "day" : "days"} with a
                    wake time between {WAKE_WINDOW_START} and {WAKE_WINDOW_END}.
                    A record of what happened, not a target and not a score.
                  </p>
                ) : null}
              </div>
            )}
          </Card>

          {/* --- Habits ---------------------------------------------------- */}
          <Card
            title="Habits"
            foot={<CardLink href="/habits">Open Habits</CardLink>}
          >
            <ul className="list">
              {TRACKED_HABITS.map((type) => {
                const entry = habitByType.get(type);

                return (
                  <li key={type} className="row-between">
                    <span className="row-title">{HABIT_LABELS[type]}</span>
                    {entry === undefined ? (
                      <span className="muted">not recorded</span>
                    ) : entry.done ? (
                      <Status tone="positive">
                        Done{entry.hasPhoto ? " · photo" : ""}
                      </Status>
                    ) : (
                      <Status>Not done</Status>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* --- Skills ---------------------------------------------------- */}
          <Card
            title="Skills"
            aside={<Status>{skills.count} added</Status>}
            foot={<CardLink href="/skills">Open the replacement list</CardLink>}
          >
            {skills.count === 0 ? (
              <Empty compact>
                Your list is empty, because you have not added anything yet.
                Skills are things you name yourself, and{" "}
                <strong>nothing is ever chosen for you</strong>.
              </Empty>
            ) : (
              <>
                <ul className="list">
                  {skills.skills.slice(0, 4).map((entry) => (
                    <li key={entry.skill.id} className="row-between">
                      <span className="row-title">{entry.skill.name}</span>
                      <span className="meta">
                        {entry.times === 0
                          ? "Not logged yet"
                          : `Logged ${entry.times} ${
                              entry.times === 1 ? "time" : "times"
                            }`}
                      </span>
                    </li>
                  ))}
                </ul>
                {skills.count > 4 ? (
                  <p className="meta">
                    and {skills.count - 4} more on the list.
                  </p>
                ) : null}
              </>
            )}
          </Card>

          {/* --- Diary ------------------------------------------------------ */}
          {/*
            A link, and nothing else.

            The diary is read in exactly one place — `src/features/habits/diary.ts` — and
            `npm run lint` refuses any other reader of it, including this page. So this card shows
            no photograph, no note, and no count of entries. It is a way in, which is the only thing
            the Dashboard is entitled to offer for content it must not hold.
          */}
          <Card
            title="Photo Diary"
            foot={<CardLink href="/diary">Open the diary</CardLink>}
          >
            <p className="muted">
              The day&apos;s photographs and the words written beside them. The
              diary is yours alone, so it is kept on its own page and is not
              summarised here.
            </p>
          </Card>
        </CardGrid>
      </Section>

      <Section title="Tonight">
        <Card>
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
        </Card>
      </Section>
    </div>
  );
}
