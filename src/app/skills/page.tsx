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
 * label. There is no field on a `Skill` that could hold a recommendation even if someone wanted to
 * add one. The bar beside each row is drawn from that skill's own tally and the largest tally on
 * the page, so it says "more than the others here" and never "enough".
 *
 * ## No examples, no defaults
 *
 * The PRD's examples — read a book, 10 pushups — are the user's to write. An empty list says so
 * and offers the form. It does not pre-fill "read a book", because a list the application started
 * writing is no longer the user's list.
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
import { CommandBox } from "@/components/CommandBox";
import { CommandForm, type CommandField } from "@/components/CommandForm";
import { OutcomeBanner } from "@/components/OutcomeBanner";
import {
  Card,
  Empty,
  PageHeader,
  Section,
  Stat,
  Status,
} from "@/components/ui";
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const skills = readSkills();
  const parser = parserAvailability();

  /*
    The widest bar on the page, so the others can be drawn relative to it. This is a comparison
    between rows the user wrote; it is not a threshold, and no row is labelled against it.
  */
  const busiest = skills.skills.reduce(
    (highest, entry) => Math.max(highest, entry.times),
    0,
  );

  return (
    <div className="page">
      <PageHeader
        title="Skills"
        description="Your own list of things to do instead. Everything you have added, in the order you added it. Nothing is ever chosen for you."
        aside={
          <Status tone={skills.atLimit ? "warning" : "neutral"}>
            {skills.count} of {skills.limit}
          </Status>
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
        The whole list, in stored order. No sorting, no filtering, no truncation, and nothing
        marked as a recommendation. The PRD requires the full list on one tap, and this is that
        view.
      */}
      {skills.count === 0 ? (
        <Empty>
          Your list is empty, because you have not added anything yet. Skills
          are things you name yourself — add the first one below. Nothing is
          ever chosen for you.
        </Empty>
      ) : (
        <Section title="Your list">
          {/*
            A grid of cards rather than a table of rows, because each skill carries its own logging
            form and a row wide enough to hold a name, a bar, a duration, and a number input becomes
            a row of mostly empty space. The cards stay in stored order and stay the same size:
            the grid reflows, nothing is ranked, and no card is marked as a choice.
          */}
          <ul className="card-grid">
            {skills.skills.map((skill) => (
              <li key={skill.skill.id} className="card skill-card">
                <div className="skill-card-head">
                  <span className="skill-initial" aria-hidden="true">
                    {initial(skill.skill.name)}
                  </span>
                  <div className="stack-sm">
                    <span className="row-title">{skill.skill.name}</span>
                    <span className="meta">
                      {skill.times === 0
                        ? "Not logged yet."
                        : `Logged ${skill.times} ${
                            skill.times === 1 ? "time" : "times"
                          }${
                            skill.minutes === null
                              ? ""
                              : ` · ${minutesLabel(skill.minutes)}`
                          }.`}
                    </span>
                  </div>
                </div>

                {busiest > 0 && skill.times > 0 ? (
                  <span className="viz-track" aria-hidden="true">
                    <span
                      className="viz-fill"
                      style={{
                        width: `${Math.min(100, Math.round((skill.times / busiest) * 100))}%`,
                      }}
                    />
                  </span>
                ) : null}

                <div className="row-aside">
                  <form
                    className="inline-form"
                    method="post"
                    action="/api/commands"
                  >
                    <label className="field">
                      <span className="visually-hidden">
                        Minutes spent on {skill.skill.name}
                      </span>
                      <input
                        name="minutes"
                        type="number"
                        min="0"
                        step="1"
                        placeholder="min"
                        aria-label={`Minutes spent on ${skill.skill.name}`}
                      />
                    </label>
                    <input type="hidden" name="kind" value="skill.log" />
                    <input
                      type="hidden"
                      name="skillName"
                      value={skill.skill.name}
                    />
                    <input type="hidden" name="next" value={RETURN_TO} />
                    <button type="submit" className="button button-secondary">
                      Log this skill
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="At a glance">
        <Card>
          <div className="row-between">
            <Stat
              label="On the list"
              value={String(skills.count)}
              size="sm"
              note={
                skills.atLimit
                  ? `The list holds ${skills.limit} skills, which is the most the PRD allows.`
                  : `${skills.count} of ${skills.limit} added. ${
                      skills.remaining === 1 ? "slot" : "slots"
                    } left.`
              }
            />
            <Stat
              label="Times logged"
              value={String(skills.skills.reduce((sum, e) => sum + e.times, 0))}
              size="sm"
              note="A count of what you recorded, across every skill on the list."
            />
          </div>
        </Card>
      </Section>

      <Section title="Add a skill">
        <div className="form-grid">
          <CommandForm
            kind="skill.create"
            returnTo={RETURN_TO}
            fields={[NEW_SKILL]}
            submitLabel="Add to the list"
          />

          {/*
            Logging by name rather than by tapping the row above. Both post the same command, and
            the name is resolved to a row by the executor — the select above is a convenience, not
            a second way to record the same thing differently.
          */}
          {skills.count === 0 ? null : (
            <CommandForm
              kind="skill.log"
              returnTo={RETURN_TO}
              heading="Log a skill by name"
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
          )}
        </div>
      </Section>
    </div>
  );
}

/**
 * The first letter of a skill's name, on the card that holds it.
 *
 * An initial and not an icon: the skill list is written by the user, so any icon would be a picture
 * the application picked on their behalf. The letter is the one thing that cannot be wrong, and it
 * is `aria-hidden` at the call site because the name is right beside it in full.
 */
function initial(name: string): string {
  const first = name.trim().charAt(0);

  return first === "" ? "•" : first.toUpperCase();
}
