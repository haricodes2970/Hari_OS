/**
 * The Skills page: the full replacement list, and one form per thing a user might want to do.
 *
 * ## What this page is for
 *
 * PRD 6.5 and PRD section 4 together: an urge gets a replacement action, and choosing is the
 * user's. So this page opens with **every** skill the user has added, in the order they added
 * them, and it never marks one as suggested, most useful, or recent.
 *
 * That is a claim about the code as much as the page. `readSkills` returns the swap list
 * unfiltered, and this page renders that list as-is: no `.sort()`, no `.slice()`, no "your best"
 * label. There is no field on a `Skill` that could hold a recommendation even if someone wanted
 * to add one.
 *
 * ## No examples, no defaults
 *
 * The PRD's examples — read a book, 10 pushups — are the user's to write. An empty list says so
 * and offers the form. It does not pre-fill "read a book", because a list the application
 * started writing is no longer the user's list.
 *
 * ## What the tally is, and what it is not
 *
 * PRD 6.5 allows a per-skill tally. Each row shows how many times that skill has been logged and
 * the total of the durations the user stated. The list is never sorted by it, so a tally cannot
 * become a leaderboard, and no column header exists to sort by.
 *
 * ## What happens after logging a skill
 *
 * Nothing but a stored row and a neutral tally. There is no level, no points, no unlock, and no
 * "you are on a roll" — the PRD's own wording is that a neutral streak is allowed, which is a
 * ceiling rather than a target.
 *
 * A Server Component: every number came from SQLite through `readSkills`, and every change posts
 * to the one command endpoint.
 */
import { CommandForm, type CommandField } from "@/components/CommandForm";
import { Nav } from "@/components/Nav";
import { OutcomeBanner } from "@/components/OutcomeBanner";
import { ChatInput } from "@/components/ChatInput";
import { parserAvailability } from "@/features/chat/runtime";
import { readSkills } from "@/features/skills/view";

export const metadata = { title: "Skills · Hari OS" };
export const dynamic = "force-dynamic";

const RETURN_TO = "/skills";

const NEW_SKILL: CommandField = {
  name: "name",
  label: "Skill",
  kind: "text",
  placeholder: "what you would do instead",
};

const LOGGED_SKILL: CommandField = {
  name: "skillName",
  label: "Skill",
  kind: "select",
  options: [],
};

const MINUTES: CommandField = {
  name: "minutes",
  label: "Minutes (optional)",
  kind: "number",
  min: "0",
  step: "1",
  placeholder: "how long, if you know",
};

/**
 * One duration the user stated, in the shortest honest wording.
 *
 * A tally of 1 with 45 minutes logged reads "1 time, 45 minutes logged". Nothing here converts a
 * sum into a duration in hours, and nothing compares two skills.
 */
function minutesLabel(minutes: number): string {
  return `${minutes} minute${minutes === 1 ? "" : "s"} logged`;
}

export default async function SkillsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const skills = readSkills();
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
      <h1>Replacement skills</h1>
      <OutcomeBanner searchParams={searchParams} />

      {/*
        The whole list, in stored order. No sorting, no filtering, no truncation, and nothing
        marked as a recommendation. The PRD requires the full list on one tap, and this is that
        view.
      */}
      {skills.count === 0 ? (
        <p className="empty">
          Your list is empty, because you have not added anything yet. Skills
          are things you name yourself — add the first one below. Nothing is
          ever chosen for you.
        </p>
      ) : (
        <ul className="card-list">
          {skills.skills.map((skill) => (
            <li key={skill.skill.id} className="card">
              <h3>{skill.skill.name}</h3>
              <p className="muted">
                {skill.times === 0
                  ? "Not logged yet."
                  : `Logged ${skill.times} ${
                      skill.times === 1 ? "time" : "times"
                    }${
                      skill.minutes === null
                        ? ""
                        : ` · ${minutesLabel(skill.minutes)}`
                    }.`}
              </p>
              <form
                className="inline-form"
                method="post"
                action="/api/commands"
              >
                <input type="hidden" name="kind" value="skill.log" />
                <input
                  type="hidden"
                  name="skillName"
                  value={skill.skill.name}
                />
                <label className="field">
                  <span>Minutes (optional)</span>
                  <input name="minutes" type="number" min="0" step="1" />
                </label>
                <button type="submit">Log this skill</button>
                <input type="hidden" name="next" value={RETURN_TO} />
              </form>
            </li>
          ))}
        </ul>
      )}

      <p className="muted">
        {skills.atLimit
          ? `The list holds ${skills.limit} skills, which is the most the PRD allows.`
          : `${skills.count} of ${skills.limit} added. ${skills.remaining} ${
              skills.remaining === 1 ? "slot" : "slots"
            } left.`}
      </p>

      <h2>Add a skill</h2>
      <CommandForm
        kind="skill.create"
        returnTo={RETURN_TO}
        fields={[NEW_SKILL]}
        submitLabel="Add to the list"
      />

      {/*
        Logging by name rather than by tapping the row above. Both post the same command, and the
        name is resolved to a row by the executor — the select above is a convenience, not a
        second way to record the same thing differently.
      */}
      <h2>Log a skill by name</h2>
      <CommandForm
        kind="skill.log"
        returnTo={RETURN_TO}
        fields={[
          {
            ...LOGGED_SKILL,
            options: skills.swap.map((skill) => ({
              value: skill.name,
              label: skill.name,
            })),
          },
          MINUTES,
        ]}
        submitLabel="Log it"
      />
    </>
  );
}
