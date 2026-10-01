/**
 * The Habits page: today's habits, the laundry target, the screen-time entry, the private log,
 * and the Photo Diary.
 *
 * ## What this page will and will not measure
 *
 * PRD 6.6 asks for cooking, dishes, and laundry, each with a streak and a progress bar, and for
 * **private logs that are never shown as a streak, score, or progress bar.** So:
 *
 * - Streaks exist for the three neutral habits, and the numbers come from `habitStreak`.
 * - **Exactly one progress bar exists**, for laundry against the PRD's twice-a-week target.
 *   There is no bar for screen time, which is a stated measurement rather than a habit, and there
 *   is none anywhere near the private log.
 * - The private section below renders a dated list of what the user wrote. It has no count, no
 *   ratio, no comparison, and no function that could produce one — see
 *   `src/features/habits/private-log.ts`.
 *
 * ## Laundry needs a photo, and the page says so before it refuses
 *
 * The PRD does not accept a text claim for laundry. The completion control for laundry is
 * therefore **not** a done checkbox: it is the upload form. Ticking laundry as done posts
 * `habit.record`, the domain refuses it, and the banner explains why — but the page states the
 * rule next to the control so the answer arrives before the question.
 *
 * ## Screen time is typed in
 *
 * There is no platform API and no device permission prompt, as the phase doc requires. The number
 * on this page is the number the user typed, and the page says so.
 *
 * ## The Photo Diary
 *
 * The pictures below are laundry photos, newest first, served from `/api/photos/<id>/<filename>`
 * and never from a filesystem path. This is the real upload path — magic-byte validated, server
 * named, size limited — rather than the placeholder Phase 7 was allowed to ship.
 *
 * A Server Component: every number came from SQLite through `readHabits` and `readPrivateLog`,
 * and every change posts to the one command endpoint or to the photo route.
 */
import { ChatInput } from "@/components/ChatInput";
import { CommandForm, type CommandField } from "@/components/CommandForm";
import { Nav } from "@/components/Nav";
import { OutcomeBanner } from "@/components/OutcomeBanner";
import { parserAvailability } from "@/features/chat/runtime";
import { MAX_DIARY_NOTE } from "@/domain/diary";
import { readHabits } from "@/features/habits/view";
import { readPrivateLog } from "@/features/habits/private-log";
import { PHOTO_LIMIT_BYTES } from "@/features/habits/photos";
import { currentUtcDate } from "@/features/shared/command-runtime";

export const metadata = { title: "Habits · Hari OS" };
export const dynamic = "force-dynamic";

const RETURN_TO = "/habits";

const LIMIT_MB = Math.round(PHOTO_LIMIT_BYTES / (1024 * 1024));

const SCREEN_MINUTES: CommandField = {
  name: "minutes",
  label: "Screen time today (minutes)",
  kind: "number",
  min: "0",
  step: "1",
  placeholder: "your own estimate",
};

const PRIVATE_NOTE: CommandField = {
  name: "note",
  label: "Note (optional)",
  kind: "text",
  placeholder: "anything you want to remember, in your words",
};

/**
 * How one habit's streak reads.
 *
 * A streak is a count of consecutive days recorded as done, and it is worded as a fact about the
 * record rather than about the user. "Not recorded yet" is not "0" and not a failure: a day with
 * no row is a day nobody wrote anything about.
 */
function streakLabel(days: number, recorded: boolean): string {
  if (!recorded) {
    return "Not recorded today.";
  }

  return days === 0
    ? "Recorded today. No run of consecutive days yet."
    : `Recorded today. ${days} consecutive ${
        days === 1 ? "day" : "days"
      } recorded as done.`;
}

export default async function HabitsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const date = currentUtcDate();
  const habits = readHabits(date);
  const privates = readPrivateLog(date);
  const parser = parserAvailability();

  return (
    <>
      <Nav currentPath={RETURN_TO} />
      <ChatInput
        searchParams={searchParams}
        returnTo={RETURN_TO}
        available={parser.available}
        unavailableReason={parser.reason}
      />
      <h1>Habits</h1>
      <OutcomeBanner searchParams={searchParams} />
      <p className="muted">{habits.date}</p>

      <h2>Cooking, dishes, and laundry</h2>
      {habits.streaks.map((habit) => (
        <div key={habit.type} className="card">
          <h3>{habit.label}</h3>
          <p className="muted">{streakLabel(habit.days, habit.recorded)}</p>
          {habit.type === "laundry" ? (
            <p className="muted">
              {habit.done
                ? `Recorded as done${
                    habit.hasPhoto ? ", with the photo attached." : "."
                  }`
                : "Not recorded as done today."}
            </p>
          ) : (
            <form className="inline-form" method="post" action="/api/commands">
              <input type="hidden" name="kind" value="habit.record" />
              <input type="hidden" name="type" value={habit.type} />
              <input
                type="hidden"
                name="done"
                value={habit.done ? "false" : "true"}
              />
              <input type="hidden" name="next" value={RETURN_TO} />
              <button type="submit">
                {habit.done ? "Record as not done" : "Record as done"}
              </button>
            </form>
          )}
        </div>
      ))}

      <h2>Laundry target: twice a week</h2>
      {/*
        The one progress bar in the application. Both numbers come from `laundryProgress`, and the
        percentage is arithmetic on those two numbers — not a rating, and never shown for anything
        private.
      */}
      <div className="card">
        <p>
          {habits.laundry.doneThisWeek} of {habits.laundry.target} in the last
          seven days.
        </p>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={habits.laundry.target}
          aria-valuenow={Math.min(
            habits.laundry.doneThisWeek,
            habits.laundry.target,
          )}
          aria-label="Laundry against the twice-a-week target"
        >
          <div
            className="progress-fill"
            style={{ width: `${habits.laundry.percent}%` }}
          />
        </div>
        <p className="muted">
          {habits.laundry.met
            ? "The target is met for the last seven days."
            : "Not met yet for the last seven days. It is a target, not a score."}
        </p>
      </div>

      <h2>Laundry photo</h2>
      {/*
        The only way to complete laundry, because the PRD does not accept a text claim. The limit
        is stated before the upload rather than in an error afterwards.
      */}
      <form
        className="card"
        method="post"
        action="/api/photos"
        encType="multipart/form-data"
      >
        {/*
          Two inputs, one form, one endpoint.

          The second carries `capture="environment"`, which is the native way to offer the camera:
          on a phone it opens the rear camera, and the platform's own picker still lets the user
          choose an existing picture. The first has no `capture`, so on a desktop — where the
          attribute is ignored — nothing changes and the ordinary file dialog opens.

          They are two inputs rather than one because `capture` is a hint, not a requirement, and a
          browser that treats it as "camera only" would take away the file picker entirely. Naming
          them differently (`photo` and `capture`) is also what lets both submit into one form
          without either being `required`: a form where both were required could never be valid,
          since no browser populates two file inputs from one choice.

          Nothing here is a second upload path. Both post to `/api/photos` and are validated by the
          same code: magic bytes decide the type, the server names the file, and the size limit is
          the same. A camera capture is not trusted for being a camera capture.
        */}
        <label className="field">
          <span>
            Choose a photo (JPEG, PNG, WebP, or GIF, up to {LIMIT_MB} MB)
          </span>
          <input type="file" name="photo" accept="image/*" />
        </label>
        <label className="field">
          <span>Or take one with the camera</span>
          <input
            type="file"
            name="capture"
            accept="image/*"
            capture="environment"
          />
        </label>
        {/*
          Optional, and worded as an optional. Phase 8: the thought usually arrives while the
          photo is still being chosen, so this is where it gets written. An empty box stores no
          note and says so — it is not a way to write a blank note.
        */}
        <label className="field">
          <span>Diary note (optional, in your own words)</span>
          <textarea
            name="note"
            className="diary-note"
            rows={3}
            maxLength={MAX_DIARY_NOTE}
            placeholder="your own words"
          />
        </label>
        <input type="hidden" name="next" value={RETURN_TO} />
        <button type="submit">Upload and record laundry</button>
      </form>
      <p className="muted">
        Uploading a photo records laundry as done for today. It replaces any
        earlier entry for today, and the previous photo stops being shown — a
        note written on the earlier photo is kept, because removing a picture is
        not a request to forget what you wrote about it.
      </p>

      <h2>Screen time</h2>
      {habits.screenTimeMinutes === null ? (
        <p className="empty">
          Nothing entered today. Screen time is entered by hand — this
          application never asks a device for it.
        </p>
      ) : (
        <p>
          Entered today as {habits.screenTimeMinutes} minutes. That is your own
          estimate, not a measurement.
        </p>
      )}
      <CommandForm
        kind="habit.record"
        returnTo={RETURN_TO}
        fields={[
          {
            name: "type",
            label: "Habit",
            kind: "select",
            options: [{ value: "screen_time", label: "Screen time" }],
          },
          {
            ...SCREEN_MINUTES,
            name: "minutes",
            label: "Minutes",
          },
          {
            name: "done",
            label: "Recorded as",
            kind: "select",
            options: [
              { value: "true", label: "Entered" },
              { value: "false", label: "Not entered" },
            ],
          },
        ]}
        submitLabel="Save screen time"
      />

      <h2>Private log</h2>
      {/*
        Neutral by construction. The wording says what an entry is and nothing about how often it
        happens, how bad it is, or what it means. No count, no streak, no bar — and no function
        above this one that could produce one.
      */}
      {privates.types.map((entry) => (
        <div key={entry.label} className="card">
          <h3>{entry.label}</h3>
          <p className="muted">
            {entry.recordedToday
              ? entry.note === null
                ? "Recorded today, with no note."
                : `Recorded today. Your note: ${entry.note}`
              : "Nothing recorded today."}
          </p>
          <form className="inline-form" method="post" action="/api/commands">
            <input type="hidden" name="kind" value="private.log" />
            <input type="hidden" name="type" value={entry.type} />
            <input
              type="hidden"
              name="happened"
              value={entry.recordedToday ? "false" : "true"}
            />
            <input type="hidden" name="next" value={RETURN_TO} />
            <button type="submit">
              {entry.recordedToday
                ? "Remove today's entry"
                : "Record that this happened"}
            </button>
          </form>
          {!entry.recordedToday ? (
            <CommandForm
              kind="private.log"
              returnTo={RETURN_TO}
              heading="Or record it with a note"
              fields={[
                {
                  name: "type",
                  label: "Behaviour",
                  kind: "select",
                  options: [{ value: entry.type, label: entry.label }],
                },
                {
                  name: "happened",
                  label: "Answer",
                  kind: "select",
                  options: [{ value: "true", label: "It happened" }],
                },
                PRIVATE_NOTE,
              ]}
              submitLabel="Save the entry"
            />
          ) : null}
        </div>
      ))}

      <h3>Earlier entries</h3>
      {privates.entries.length === 0 ? (
        <p className="empty">Nothing has been recorded yet.</p>
      ) : (
        <ul className="card-list">
          {privates.entries.map((entry) => (
            <li key={entry.id} className="card">
              <h4>
                {entry.label} — {entry.date}
              </h4>
              {entry.note === null ? (
                <p className="muted">No note.</p>
              ) : (
                <p>{entry.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>Photo Diary</h2>
      {/*
        A preview, deliberately without the notes. This page composes `readHabits`, and keeping the
        notes off it means the diary is read in exactly one place — see `src/features/habits/
        diary.ts`. The link below is the way there.
      */}
      {habits.timeline.length === 0 ? (
        <p className="empty">
          No photos yet. Laundry photos appear here, newest first.
        </p>
      ) : (
        <ul className="card-list">
          {habits.timeline.map((entry) => (
            <li key={entry.id} className="card">
              <p className="muted">
                {entry.date} — {entry.label}
              </p>
              {/* The src is the application's own URL, recorded with the row. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={entry.photoUrl}
                alt={`${entry.label} recorded on ${entry.date}`}
                className="diary-photo"
              />
            </li>
          ))}
        </ul>
      )}
      <p>
        <a href="/diary">Open the diary to read and write notes</a>
      </p>
    </>
  );
}
