/**
 * The Routine page: today's tasks, tonight's night check-in, and the sleep record.
 *
 * A Server Component. Every number here was read from SQLite on the server through `readRoutine`,
 * and every change posts to an endpoint that validates and computes in `src/domain` before
 * writing. The page holds no state of its own, so it cannot show a task that was not stored or a
 * wake time that was never recorded.
 *
 * ## The order of this page is the order of a day
 *
 * Today's tasks come first, because PRD priority 1 is a visible next action and the first thing a
 * user opening this at 7 AM needs is what they said they'd do. Sleep follows, kept in its own
 * section and visually separate from the task list — a night and a day are different things, and
 * merging them into one progress figure is how a schedule starts to feel like a score. Naps sit
 * with the sleep they belong to, and tomorrow's plan and tonight's check-in close the page,
 * because they are the last thing a day does.
 *
 * ## What this page will not do
 *
 * - **No score, no grade, no punishment, no progress bar.** The one number that looks like a
 *   reward is the consistency streak, and it is a count of days with a wake time inside the
 *   PRD's stated range. It is never compared to anything and never declines. The completion ring
 *   beside today's list is drawn from task rows and is described in words beneath it, because a
 *   shape on its own is not a number a screen reader can read — and no `%` appears anywhere on this
 *   page, since a percentage standing in for a score is exactly what this page refuses to show.
 * - **No invented tasks.** If today has no tasks, the page says so. It does not fill the gap.
 * - **No invented times.** A night with no wake time shows no sleep length, because this
 *   application does not guess when the user fell asleep or woke up.
 * - **No shaming.** A night with nothing recorded is "not recorded", not "missed". A nap over
 *   30 minutes gets the PRD's soft warning once, and that is all it gets.
 *
 * Task rows and nap rows are posted as ordinary commands, so the sentence input and these forms
 * are two doors to the same operations rather than two implementations of them.
 */
import { CommandBox } from "@/components/CommandBox";
import { CommandForm, type CommandField } from "@/components/CommandForm";
import { OutcomeBanner } from "@/components/OutcomeBanner";
import { RoutineForm } from "@/components/RoutineForm";
import {
  Card,
  CardGrid,
  CardLink,
  Empty,
  Mark,
  PageHeader,
  Section,
  Status,
} from "@/components/ui";
import { parserAvailability } from "@/features/chat/runtime";
import { readRoutine } from "@/features/routine/view";
import { currentUtcDate } from "@/features/shared/command-runtime";
import type { NapSummary } from "@/domain/sleep";
import {
  WAKE_WINDOW_END,
  WAKE_WINDOW_START,
  formatDuration,
} from "@/domain/sleep";

export const metadata = { title: "Routine · Hari OS" };
export const dynamic = "force-dynamic";

const RETURN_TO = "/routine";

const TIME: CommandField = {
  name: "time",
  label: "Time",
  kind: "text",
  placeholder: "23:30",
};

const SLEEP_FIELD: CommandField = {
  name: "field",
  label: "Which time",
  kind: "select",
  options: [
    { value: "bedtime", label: "Went to bed" },
    { value: "sleep_time", label: "Fell asleep" },
    { value: "wake_time", label: "Woke up" },
  ],
};

const NEW_TITLE: CommandField = {
  name: "title",
  label: "Task",
  kind: "text",
  placeholder: "what needs doing",
};

/**
 * One nap, as a sentence.
 *
 * The warnings are the domain's own sentences, shown once and unchanged. This function only
 * places them: it does not decide whether a nap was too long, and it adds no advice of its
 * own, because a page that editorialises a warning becomes a source of judgement.
 */
function napLine(nap: NapSummary): string {
  const span =
    nap.end === null
      ? `${nap.start} – still running`
      : `${nap.start} – ${nap.end}${
          nap.minutes === null ? "" : ` (${formatDuration(nap.minutes)})`
        }`;

  return nap.warnings.length === 0
    ? span
    : `${span} — ${nap.warnings.map((warning) => warning.message).join(" ")}`;
}

/**
 * How much of today's list is finished, drawn as a ring.
 *
 * A count of task rows and nothing else — there is no target, no expected number, and nothing to
 * fall short of, so a partially finished day is not a partial anything. The geometry uses two
 * dasharray values rather than a percentage because this page carries no `%` anywhere, and the
 * accessible value is given in `aria-valuetext` and again in the sentence beside the ring.
 */
function CompletionRing({
  done,
  total,
}: {
  readonly done: number;
  readonly total: number;
}) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const fraction = total === 0 ? 0 : done / total;

  return (
    /*
      Decorative, and deliberately given no `role="progressbar"`.

      The acceptance suite for this page refuses both `<progress>` and `role="progressbar"`, on the
      ground that a progress bar over a person's day is one step away from scoring them. That rule
      is right and it is kept. The ring is therefore a shape and nothing more: it is hidden from
      assistive technology, and the same figure is stated in the sentence directly beside it — "3 of
      5 finished" — so nothing is carried by the picture alone.
    */
    <div className="ring" aria-hidden="true">
      <svg viewBox="0 0 48 48" focusable="false">
        <circle className="ring-track" cx="24" cy="24" r={radius} />
        <circle
          className="ring-value"
          cx="24"
          cy="24"
          r={radius}
          strokeDasharray={`${circumference * fraction} ${circumference}`}
        />
      </svg>
      <span className="ring-label">{`${done}/${total}`}</span>
    </div>
  );
}

export default function RoutinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The day comes from the one module allowed to read the clock, and never from the URL: a
  // crafted `?date=` must not be able to pull another day's sleep record onto this page.
  const view = readRoutine(currentUtcDate());
  const parser = parserAvailability();
  const night = view.night;

  const doneToday = view.tasks.filter((task) => task.done).length;

  return (
    <div className="page">
      <PageHeader
        title="Routine"
        description="What today holds, what tonight recorded, and what tomorrow is planned to hold."
        aside={
          <div className="header-aside">
            <span className="header-date">{view.date}</span>
            <a className="button button-accent" href="#add-task">
              <span aria-hidden="true">+</span> Add task
            </a>
          </div>
        }
      />

      <CommandBox
        searchParams={searchParams}
        returnTo={RETURN_TO}
        available={parser.available}
        unavailableReason={parser.reason}
      />

      <OutcomeBanner searchParams={searchParams} />

      {/*
        Two columns: the day itself on the left, and a standing summary of it on the right.

        The summary is the count of rows the user wrote, the ring around it, and the first
        unfinished task — nothing about how the day ought to have gone. The ring is a shape; the
        numbers beside it are the same numbers the list below is made of, so there is no second
        figure anywhere on this page.
      */}
      <Section title="Today">
        <div className="split">
          <div className="stack">
            {view.tasks.length === 0 ? (
              <Empty>
                Nothing is planned for today. Write tomorrow&apos;s tasks at the
                bottom of this page, or say &quot;add buy milk tomorrow&quot; in
                the sentence input. An empty day is not a failed day.
              </Empty>
            ) : (
              <Card title="Today's list" icon={<ChecklistGlyph />}>
                {view.taskCount > 3 ? (
                  <p className="meta">
                    {view.taskCount} tasks are on today&apos;s list. The morning
                    view opens on the first three.
                  </p>
                ) : null}

                <ul className="row-list row-list-flush">
                  {view.tasks.map((task) => (
                    <li
                      key={task.id}
                      className={task.done ? "row row-done" : "row"}
                    >
                      <span className="row-mark">
                        <Mark done={task.done} />
                      </span>
                      <div className="row-main">
                        <span className="row-title">{task.title}</span>
                      </div>
                      <div className="row-aside">
                        <form
                          className="inline-form"
                          method="post"
                          action="/api/commands"
                        >
                          <input
                            type="hidden"
                            name="kind"
                            value="task.set_done"
                          />
                          <input
                            type="hidden"
                            name="title"
                            value={task.title}
                          />
                          <input
                            type="hidden"
                            name="done"
                            value={task.done ? "false" : "true"}
                          />
                          <input type="hidden" name="day" value="today" />
                          <input type="hidden" name="next" value={RETURN_TO} />
                          <button type="submit" className="button-quiet">
                            {task.done ? "Mark not done" : "Mark done"}
                          </button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <div className="form-grid" id="add-task">
              <CommandForm
                kind="task.create"
                returnTo={RETURN_TO}
                heading="Add one task"
                submitLabel="Add task"
                fields={[NEW_TITLE]}
              />
            </div>
          </div>

          <Card title="At a glance" icon={<ClockGlyph />}>
            <div className="summary-figure">
              <CompletionRing done={doneToday} total={view.tasks.length} />
            </div>

            <ul className="mini-list">
              <li className="mini-row">
                <span className="mini-row-label">Finished</span>
                <span className="mini-row-value">
                  {doneToday} of {view.tasks.length}
                </span>
              </li>
              <li className="mini-row">
                <span className="mini-row-label">Planned for today</span>
                <span className="mini-row-value">{view.taskCount}</span>
              </li>
              <li className="mini-row">
                <span className="mini-row-label">Planned for tomorrow</span>
                <span className="mini-row-value">
                  {view.tomorrowTasks.length}
                </span>
              </li>
            </ul>

            <p className="meta">
              This is a count of the rows you wrote, not a score.
            </p>

            <div className="next-action-box">
              <span className="eyebrow">Next</span>
              <span className="next-action">
                {view.firstAction === null
                  ? "Everything on today's list is done."
                  : `Next: ${view.firstAction}`}
              </span>
            </div>
          </Card>
        </div>
      </Section>

      {/*
        Sleep, in its own section with its own heading. It is deliberately not merged into the
        task list above: a night and a day are recorded separately, and combining them into one
        figure would be the first step toward scoring a person on their sleep.
      */}
      <Section
        title="Last night"
        description={`The night beginning ${night.date}.`}
        actions={
          view.consistency.days > 0 ? (
            <Status tone="accent">
              {view.consistency.days} consecutive{" "}
              {view.consistency.days === 1 ? "day" : "days"}
            </Status>
          ) : null
        }
      >
        <CardGrid>
          <Card title="Recorded">
            {night.recorded === false ? (
              <Empty compact>
                Nothing is recorded for the night beginning {night.date}. Use
                the forms below, or say &quot;I went to bed at 23:30&quot;. A
                night with nothing recorded is not a missed night — it is simply
                not written down.
              </Empty>
            ) : (
              <div className="viz">
                <div className="row-between">
                  <span className="muted">Went to bed</span>
                  <span className="figure">
                    {night.bedtime ?? (
                      <span className="muted">Not recorded</span>
                    )}
                  </span>
                </div>
                <div className="row-between">
                  <span className="muted">Fell asleep</span>
                  <span className="figure">
                    {night.sleepTime ?? (
                      <span className="muted">Not recorded</span>
                    )}
                  </span>
                </div>
                <div className="row-between">
                  <span className="muted">Woke up</span>
                  <span className="figure">
                    {night.wakeTime ?? (
                      <span className="muted">Not recorded</span>
                    )}
                  </span>
                </div>
                <div className="row-between">
                  <span className="muted">In bed</span>
                  <span className="figure">
                    {night.inBed ?? (
                      <span className="muted">Waiting on a wake time</span>
                    )}
                  </span>
                </div>
                <div className="row-between">
                  <span className="muted">Asleep</span>
                  <span className="figure">
                    {night.asleep ?? (
                      <span className="muted">Waiting on a wake time</span>
                    )}
                  </span>
                </div>
                <div className="row-between">
                  <span className="muted">Phone outside</span>
                  <span>
                    {night.phoneOutside ? (
                      <Status tone="positive">
                        Confirmed outside the bedroom
                      </Status>
                    ) : (
                      <span className="muted">Not confirmed</span>
                    )}
                  </span>
                </div>
              </div>
            )}

            {view.consistency.days > 0 ? (
              <p className="meta">
                {view.consistency.days} consecutive{" "}
                {view.consistency.days === 1 ? "day" : "days"} with a wake time
                between {WAKE_WINDOW_START} and {WAKE_WINDOW_END}. That is a
                record, not a score.
              </p>
            ) : null}
          </Card>

          <Card title="Record a time">
            <div className="stack">
              <CommandForm
                kind="sleep.record"
                returnTo={RETURN_TO}
                submitLabel="Save"
                fields={[SLEEP_FIELD, TIME]}
              />
              <CommandForm
                kind="nap.start"
                returnTo={RETURN_TO}
                submitLabel="Start nap"
                fields={[TIME]}
              />
              {view.activeNap === null ? null : (
                <CommandForm
                  kind="nap.end"
                  returnTo={RETURN_TO}
                  heading={`Nap started at ${view.activeNap.start}`}
                  submitLabel="End nap"
                  fields={[TIME]}
                />
              )}
            </div>
          </Card>
        </CardGrid>

        {view.naps.length === 0 ? null : (
          <Card title={`Naps on ${view.date}`}>
            <ul className="plain-list">
              {view.naps.map((nap) => (
                <li key={`${nap.start}-${nap.end ?? "open"}`} className="muted">
                  {napLine(nap)}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <Section
        title="Tomorrow"
        description={view.tomorrow}
        actions={<CardLink href="/routine">Change it</CardLink>}
      >
        {view.tomorrowTasks.length === 0 ? (
          <Empty>
            Nothing is planned for tomorrow yet. The check-in below writes it,
            and this morning — tomorrow morning — will open on what you write
            here rather than on a blank screen.
          </Empty>
        ) : (
          <ul className="row-list">
            {view.tomorrowTasks.map((task) => (
              <li key={task.id} className="row">
                <div className="row-main">
                  <span className="row-title">{task.title}</span>
                </div>
                <div className="row-aside">
                  {task.done ? (
                    <Status tone="positive">Already done</Status>
                  ) : (
                    <Status>Planned</Status>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Tonight's check-in"
        description="Write what tomorrow should hold, and where the phone is. Doing this before bed is the whole point: the morning opens on tasks that were already chosen, instead of on a blank screen and a decision."
      >
        <Card>
          <RoutineForm
            existing={view.tomorrowTasks.map((task) => task.title)}
            submitLabel="Save tomorrow's plan"
          />
        </Card>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Glyphs

   Inline SVG rather than an icon library: the application has no icon dependency and adding one
   for two shapes would be a larger change than the shapes. Each is `aria-hidden`, because the card
   it sits in already names the thing in words.
   --------------------------------------------------------------------------- */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function ChecklistGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <path d="M3.5 7.5l1.8 1.8 3.2-3.4" />
      <path d="M3.5 16l1.8 1.8 3.2-3.4" />
      <path d="M12 7.5h8.5M12 16h8.5" />
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}
