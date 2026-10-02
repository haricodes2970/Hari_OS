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
  ColumnChart,
  Empty,
  Mark,
  PageHeader,
  Section,
  SkillBars,
  Status,
} from "@/components/ui";
import {
  WAKE_WINDOW_END,
  WAKE_WINDOW_START,
  formatDuration,
} from "@/domain/sleep";
import { parserAvailability } from "@/features/chat/runtime";
import { readDashboard } from "@/features/dashboard/view";
import { readDailyBill } from "@/features/expenses/view";
import { readHabits } from "@/features/habits/view";
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

/** The clock, as a person reads it. The only other thing the header needs. */
function readableTime(): string {
  return nowTimestamp().slice(11, 16);
}

/** How many photos the Dashboard shows. Enough to fill the row, few enough to stay a summary. */
const PHOTO_LIMIT = 5;

/**
 * How many skills the card shows.
 *
 * Four, because the card is a summary and the full list lives on its own page. The card never
 * orders them by anything: they appear in the order the user added them, which is the order the
 * Skills page uses, so the two never disagree about which skill is first.
 */
const SKILL_LIMIT = 4;

export default function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const dashboard = readDashboard();
  const skills = readSkills();
  const habits = readHabits(dashboard.date);
  const parser = parserAvailability();

  const habitByType = new Map(
    dashboard.habits.map((entry) => [entry.type, entry] as const),
  );

  /*
    The day's own bill, for the card's breakdown.

    It is the same feature read the Expenses page uses, on the same day, so the two show the same
    numbers by construction rather than by agreement. Each line's amount is the one the domain
    formatted, and the chart turns those into bar heights; the page itself works out no total, so
    it cannot produce a figure the bill does not agree with. An empty bill draws no chart at all.
  */
  const bill = readDailyBill(dashboard.date);
  const byItem = (bill === null ? [] : bill.byItem).filter(
    (line) => line.total > 0,
  );

  /*
    The skills the card shows, in the order they were added. `formatDuration` writes the figure the
    domain already agreed on, so the number beside each bar and the bar's width come from one source.
  */
  const shownSkills = skills.skills.slice(0, SKILL_LIMIT);
  return (
    <div className="page">
      <PageHeader
        title={greeting()}
        description="Here's your day at a glance."
        aside={
          <div className="header-aside">
            <span className="eyebrow">Dashboard</span>
            <span className="header-date">{readableDate(dashboard.date)}</span>
            <span className="header-time">{readableTime()}</span>
          </div>
        }
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
            icon={<CheckboxGlyph />}
            aside={
              dashboard.taskCount === 0 ? null : `${dashboard.taskCount} total`
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
              <ul className="mini-list">
                {dashboard.tasks.map((task) => (
                  <li
                    className={task.done ? "mini-row row-done" : "mini-row"}
                    key={task.id}
                  >
                    <span className="mini-row-row">
                      <Mark done={task.done} />
                      <span className="mini-row-label">{task.title}</span>
                    </span>
                    <span className="mini-row-value">
                      {task.done ? "Done" : "Not done"}
                    </span>
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
            icon={<CartGlyph />}
            foot={<CardLink href="/kitchen">Open Kitchen</CardLink>}
          >
            {dashboard.inventoryCount === 0 ? (
              <Empty compact>
                Nothing is tracked in the kitchen yet, so there is nothing to
                run low. Start tracking an item on the{" "}
                <a href="/kitchen">Kitchen page</a>.
              </Empty>
            ) : (
              <>
                <div className="metric">
                  <span
                    className={
                      dashboard.lowStock.length > 0
                        ? "metric-value metric-value-negative"
                        : "metric-value"
                    }
                  >
                    {dashboard.lowStock.length === 0
                      ? "Stock healthy"
                      : "Low stock"}
                  </span>
                  <span className="metric-note">
                    {dashboard.lowStock.length === 0
                      ? `All ${dashboard.inventoryCount} tracked ${
                          dashboard.inventoryCount === 1
                            ? "item is"
                            : "items are"
                        } above ${dashboard.inventoryCount === 1 ? "its" : "their"} alert level.`
                      : `${dashboard.lowStock.length} of ${dashboard.inventoryCount} ${
                          dashboard.inventoryCount === 1
                            ? "item is"
                            : "items are"
                        } below the alert level.`}
                  </span>
                </div>

                {dashboard.lowStock.length === 0 ? (
                  <p className="meta">
                    Nothing is low right now. An empty list here means stock is
                    healthy, not that anything is missing.
                  </p>
                ) : (
                  <ul className="mini-list">
                    {dashboard.lowStock.map((item) => (
                      <li className="mini-row" key={item.id}>
                        <span className="mini-row-row">
                          <span className="mini-row-label">{item.name}</span>
                          {item.lowThreshold === null ? null : (
                            <span className="meta">
                              alert at {item.lowThreshold}
                            </span>
                          )}
                        </span>
                        <span className="mini-row-value mini-row-value-negative">
                          {item.quantity} {item.unit} left
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
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
            icon={<WalletGlyph />}
            aside={
              dashboard.spend.computed && dashboard.spend.count > 0
                ? `${dashboard.spend.count} ${
                    dashboard.spend.count === 1 ? "entry" : "entries"
                  }`
                : null
            }
            foot={<CardLink href="/expenses">Open Expenses</CardLink>}
          >
            {dashboard.spend.computed === false ? (
              <Empty compact>
                Today&apos;s total could not be computed from the recorded
                entries. Nothing has been changed, and this is not a zero.
              </Empty>
            ) : (
              <>
                <div className="metric metric-spend">
                  <span className="metric-value">
                    {dashboard.spend.formattedTotal}
                  </span>
                  <span className="metric-note">
                    {dashboard.spend.count === 0
                      ? "Nothing has been spent today."
                      : `Spent across ${dashboard.spend.count} ${
                          dashboard.spend.count === 1 ? "entry" : "entries"
                        } today.`}{" "}
                    This is the day&apos;s total, not an account balance.
                  </span>
                </div>

                {/*
                  The bars are drawn only when the bill actually has lines in it. One entry is
                  still a real breakdown and gets its single column; no entries gets no chart at
                  all, because an empty set of bars beside a total is a picture of a spend that was
                  never made.
                */}
                {byItem.length === 0 ? null : (
                  <>
                    <hr className="card-hairline" />
                    <ColumnChart
                      columns={byItem.map((line) => ({
                        label: line.label,
                        total: line.total,
                        value: line.formattedTotal,
                      }))}
                    />
                  </>
                )}
              </>
            )}
          </Card>

          {/* --- Sleep ---------------------------------------------------- */}
          <Card
            title="Last night"
            icon={<MoonGlyph />}
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
                {/*
                  The night as a line with three stops on it. Deliberately not proportional: a bar
                  whose width is the difference between two bedtime strings would be a calculation
                  on the page, and it would look more precise than "I went to bed around eleven".
                  The stops carry the times; the line carries the order.
                */}
                <div className="night" aria-hidden="true">
                  <span className="night-stop" />
                  <span className="night-line" />
                  <span className="night-stop night-stop-mid" />
                  <span className="night-line" />
                  <span className="night-stop" />
                </div>

                <ul className="mini-list">
                  <li className="mini-row">
                    <span className="mini-row-label">Went to bed</span>
                    <span className="mini-row-value">
                      {dashboard.sleep.bedtime ?? (
                        <span className="muted">not recorded</span>
                      )}
                    </span>
                  </li>
                  {dashboard.sleep.sleepTime === null ? null : (
                    <li className="mini-row">
                      <span className="mini-row-label">Asleep for</span>
                      <span className="mini-row-value">
                        {dashboard.sleep.sleepTime}
                      </span>
                    </li>
                  )}
                  <li className="mini-row">
                    <span className="mini-row-label">Woke up</span>
                    <span className="mini-row-value">
                      {dashboard.sleep.wakeTime ?? (
                        <span className="muted">not recorded</span>
                      )}
                    </span>
                  </li>
                  {dashboard.sleep.inBed === null ? null : (
                    <li className="mini-row">
                      <span className="mini-row-label">In bed</span>
                      <span className="mini-row-value">
                        {dashboard.sleep.inBed}
                      </span>
                    </li>
                  )}
                </ul>

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
            icon={<ChecklistGlyph />}
            foot={<CardLink href="/habits">Open Habits</CardLink>}
          >
            <ul className="mini-list">
              {TRACKED_HABITS.map((type) => {
                const entry = habitByType.get(type);
                const streak = habits.streaks.find((row) => row.type === type);

                return (
                  <li className="mini-row" key={type}>
                    <span className="mini-row-row">
                      <Mark done={entry?.done === true} />
                      <span className="mini-row-label">
                        {HABIT_LABELS[type]}
                      </span>
                    </span>
                    {entry === undefined ? (
                      <span className="meta">not recorded</span>
                    ) : entry.done ? (
                      <span className="mini-row-value mini-row-value-positive">
                        {streak !== undefined && streak.days > 1
                          ? `${streak.days} days`
                          : "Done"}
                      </span>
                    ) : (
                      <span className="mini-row-value">Not done</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* --- Skills ---------------------------------------------------- */}
          <Card
            title="Skills"
            icon={<SparkGlyph />}
            aside={skills.count === 0 ? null : `${skills.count} added`}
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
                <SkillBars
                  skills={shownSkills.map((entry) => ({
                    key: entry.skill.id.toString(),
                    label: entry.skill.name,
                    minutes: entry.minutes,
                    value:
                      entry.minutes === null
                        ? ""
                        : formatDuration(entry.minutes),
                  }))}
                />
                {skills.count > SKILL_LIMIT ? (
                  <p className="meta">
                    and {skills.count - SKILL_LIMIT} more on the list.
                  </p>
                ) : null}
              </>
            )}
          </Card>
        </CardGrid>
      </Section>

      {/*
        Recent photographs.

        These are the photographs attached to completed habits, read through `readHabits`, which
        reads `habit_log` and nothing else. That table carries the user's own words beside a
        photograph since ADR-056, and `TodayEntry` exists precisely so a reader of it cannot see
        them — so this card shows the image and the habit's name and never a note.

        The diary is still not here. It is a different table behind a different module, and
        `npm run lint` refuses any reader of it outside its own page. So the tile at the end is a
        link to that page rather than a way to write on this one.
      */}
      <Section>
        <Card
          title="Recent Photos"
          icon={<ImageGlyph />}
          aside="View all"
          foot={<CardLink href="/diary">Open the diary</CardLink>}
        >
          {habits.timeline.length === 0 ? (
            <Empty compact>
              No photographs have been attached yet. Cooking, dishes, and
              laundry can each keep a picture of the result, and the diary keeps
              them alongside whatever you wrote that day.
            </Empty>
          ) : (
            <ul className="photo-thumbs">
              {habits.timeline.slice(0, PHOTO_LIMIT).map((entry) => (
                <li key={entry.id}>
                  <a href={`/habits#photo-${entry.id}`} title={entry.label}>
                    {/* eslint-disable-next-line @next/next/no-img-element --
                        Habit photos are user uploads of arbitrary size and format, so a
                        plain `img` with intrinsic dimensions and lazy loading is the honest
                        element here; `next/image` would resize and re-encode files the user
                        stored untouched. */}
                    <img
                      className="photo-thumb"
                      src={entry.photoUrl}
                      alt={`${entry.label}, recorded on ${entry.date}`}
                      width={160}
                      height={160}
                      loading="lazy"
                    />
                  </a>
                </li>
              ))}
              <li className="photo-add">
                <a href="/habits#laundry-photo">
                  <span className="photo-add-mark" aria-hidden="true">
                    +
                  </span>
                  Add Photo
                </a>
              </li>
            </ul>
          )}
        </Card>
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

/* ---------------------------------------------------------------------------
   Glyphs

   Inline SVG rather than an icon library: the application has no icon dependency and adding one
   for nine 16-pixel shapes would be a larger change than the shapes. Each is `aria-hidden`
   because the card's title already names the card in words.
   --------------------------------------------------------------------------- */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function CheckboxGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M7.5 12.5l3 3 6-7" />
    </svg>
  );
}

function CartGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <path d="M3 4.5h2.2l2.2 10.5h9.4l2.2-7.5H6.2" />
      <circle cx="9" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
    </svg>
  );
}

function WalletGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <path d="M4 7.5A2.5 2.5 0 016.5 5H18v3" />
      <rect x="4" y="7.5" width="16" height="12" rx="2.5" />
      <path d="M15 13.5h2.5" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <path d="M19 14.5A8 8 0 019.5 5 8 8 0 1019 14.5z" />
    </svg>
  );
}

function ChecklistGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <path d="M3.5 7.5l1.8 1.8 3.2-3.4" />
      <path d="M3.5 16l1.8 1.8 3.2-3.4" />
      <path d="M12 7.5h8.5M12 16h8.5" />
    </svg>
  );
}

function SparkGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3l1.6 5.1 5.1 1.6-5.1 1.6L12 16.4l-1.6-5.1-5.1-1.6 5.1-1.6L12 3z" />
      <path d="M18.4 15.2l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1z" />
    </svg>
  );
}

function ImageGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M4.5 17l4.8-4.4 4 3.4 2.6-2.2 3.6 3.2" />
    </svg>
  );
}
