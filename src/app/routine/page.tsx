/**
 * The Routine page: today's tasks, tonight's night check-in, and the sleep record.
 *
 * A Server Component. Every number here was read from SQLite on the server through
 * `readRoutine`, and every change posts to an endpoint that validates and computes in
 * `src/domain` before writing. The page holds no state of its own, so it cannot show a task
 * that was not stored or a wake time that was never recorded.
 *
 * ## The order of this page is the order of a day
 *
 * Today's tasks come first, because PRD priority 1 is a visible next action and the first
 * thing a user opening this at 7 AM needs is what they said they'd do. The night follows,
 * then sleep and naps, then tomorrow's plan. The night check-in is the last form on the page
 * because it is the last thing a day does.
 *
 * ## What this page will not do
 *
 * - **No score, no grade, no punishment, no progress bar.** The one number that looks like a
 *   reward is the consistency streak, and it is a count of days with a wake time inside the
 *   PRD's stated range. It is never compared to anything and never declines.
 * - **No invented tasks.** If today has no tasks, the page says so. It does not fill the gap.
 * - **No invented times.** A night with no wake time shows no sleep length, because this
 *   application does not guess when the user fell asleep or woke up.
 * - **No shaming.** A night with nothing recorded is "not recorded", not "missed". A nap over
 *   30 minutes gets the PRD's soft warning once, and that is all it gets.
 *
 * Task rows and nap rows are posted as ordinary commands, so the sentence input and these
 * forms are two doors to the same operations rather than two implementations of them.
 */
import { ChatInput } from "@/components/ChatInput";
import { CommandForm, type CommandField } from "@/components/CommandForm";
import { Nav } from "@/components/Nav";
import { OutcomeBanner } from "@/components/OutcomeBanner";
import { RoutineForm } from "@/components/RoutineForm";
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
      ? `${nap.start} \u2013 still running`
      : `${nap.start} \u2013 ${nap.end}${
          nap.minutes === null ? "" : ` (${formatDuration(nap.minutes)})`
        }`;

  return nap.warnings.length === 0
    ? span
    : `${span} \u2014 ${nap.warnings.map((warning) => warning.message).join(" ")}`;
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

  return (
    <>
      <Nav currentPath={RETURN_TO} />
      <ChatInput
        searchParams={searchParams}
        returnTo={RETURN_TO}
        available={parser.available}
        unavailableReason={parser.reason}
      />
      <h1>Routine</h1>
      <OutcomeBanner searchParams={searchParams} />

      <h2>Today</h2>
      <p className="muted">{view.date}</p>
      {view.tasks.length === 0 ? (
        <p className="empty">
          Nothing is planned for today. Write tomorrow&apos;s tasks at the
          bottom of this page, or say &quot;add buy milk tomorrow&quot; in the
          sentence input. An empty day is not a failed day.
        </p>
      ) : (
        <>
          <p className="next-action">
            {view.firstAction === null
              ? "Everything on today's list is done."
              : `Next: ${view.firstAction}`}
          </p>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Status</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {view.tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.title}</td>
                  <td>{task.done ? "Done" : "Not done"}</td>
                  <td>
                    <CommandForm
                      kind="task.set_done"
                      returnTo={RETURN_TO}
                      submitLabel={task.done ? "Mark not done" : "Mark done"}
                      fields={[]}
                      hidden={{
                        title: task.title,
                        done: task.done ? "false" : "true",
                        day: "today",
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.taskCount > 3 ? (
            <p className="muted">
              {view.taskCount} tasks are on today&apos;s list. The morning view
              opens on the first three.
            </p>
          ) : null}
        </>
      )}

      <h2>Tonight&apos;s sleep</h2>
      {night.recorded === false ? (
        <p className="empty">
          Nothing is recorded for the night beginning {night.date}. Use the
          forms below, or say &quot;I went to bed at 23:30&quot;. A night with
          nothing recorded is not a missed night — it is simply not written
          down.
        </p>
      ) : (
        <table className="table">
          <tbody>
            <tr>
              <th scope="row">Went to bed</th>
              <td>
                {night.bedtime ?? <span className="muted">Not recorded</span>}
              </td>
            </tr>
            <tr>
              <th scope="row">Fell asleep</th>
              <td>
                {night.sleepTime ?? <span className="muted">Not recorded</span>}
              </td>
            </tr>
            <tr>
              <th scope="row">Woke up</th>
              <td>
                {night.wakeTime ?? <span className="muted">Not recorded</span>}
              </td>
            </tr>
            <tr>
              <th scope="row">In bed</th>
              <td>
                {night.inBed ?? (
                  <span className="muted">Waiting on a wake time</span>
                )}
              </td>
            </tr>
            <tr>
              <th scope="row">Asleep</th>
              <td>
                {night.asleep ?? (
                  <span className="muted">Waiting on a wake time</span>
                )}
              </td>
            </tr>
            <tr>
              <th scope="row">Phone outside</th>
              <td>
                {night.phoneOutside ? (
                  "Confirmed outside the bedroom"
                ) : (
                  <span className="muted">Not confirmed</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {view.consistency.days > 0 ? (
        <p className="muted">
          {view.consistency.days} consecutive{" "}
          {view.consistency.days === 1 ? "day" : "days"} with a wake time
          between {WAKE_WINDOW_START} and {WAKE_WINDOW_END}. That is a record,
          not a score.
        </p>
      ) : null}

      <CommandForm
        kind="sleep.record"
        returnTo={RETURN_TO}
        heading="Record a time"
        submitLabel="Save"
        fields={[SLEEP_FIELD, TIME]}
      />
      <CommandForm
        kind="nap.start"
        returnTo={RETURN_TO}
        heading="Fell asleep for a nap"
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

      {view.naps.length === 0 ? null : (
        <>
          <h3>Naps on {view.date}</h3>
          <ul className="plain-list">
            {view.naps.map((nap) => (
              <li key={`${nap.start}-${nap.end ?? "open"}`}>{napLine(nap)}</li>
            ))}
          </ul>
        </>
      )}

      <h2>Tomorrow</h2>
      <p className="muted">{view.tomorrow}</p>
      {view.tomorrowTasks.length === 0 ? (
        <p className="empty">
          Nothing is planned for tomorrow yet. The check-in below writes it, and
          this morning — tomorrow morning — will open on what you write here
          rather than on a blank screen.
        </p>
      ) : (
        <ol className="list">
          {view.tomorrowTasks.map((task) => (
            <li key={task.id}>
              {task.title}{" "}
              {task.done ? <span className="muted">already done</span> : null}
            </li>
          ))}
        </ol>
      )}

      <h2>Tonight&apos;s check-in</h2>
      <p className="muted">
        Write what tomorrow should hold, and where the phone is. Doing this
        before bed is the whole point: the morning opens on tasks that were
        already chosen, instead of on a blank screen and a decision.
      </p>
      <RoutineForm
        existing={view.tomorrowTasks.map((task) => task.title)}
        submitLabel="Save tomorrow's plan"
      />

      <CommandForm
        kind="task.create"
        returnTo={RETURN_TO}
        heading="Add one task"
        submitLabel="Add task"
        fields={[NEW_TITLE]}
      />
    </>
  );
}
