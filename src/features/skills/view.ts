/**
 * The Skills read side: the user's list, and what has been done with each entry.
 *
 * ## The one thing this module must never do
 *
 * **It must not choose.** There is no ranking, no score, no "most used", no suggestion, and no
 * default. `swapList` from `src/domain/skills.ts` is called here and its result is rendered in
 * stored order, which is the order the user created the skills in. Nothing in this file reorders,
 * filters, highlights, or annotates one of them.
 *
 * That is a deliberate structural choice. The PRD's rule — "one tap shows the full list; the user
 * picks one. The app never auto-picks" — is easy to state and easy to break accidentally: sort by
 * tally, filter to the last three, mark the most recent one as "suggested". Each of those is a
 * small diff that looks helpful. So the rule is enforced where the list is built rather than
 * where it is rendered, and the page has no data with which to express a preference even if
 * someone wanted to.
 *
 * ## The tally is per skill and is not a ranking
 *
 * PRD 6.5 allows "a tally per skill counts up (neutral streak allowed)". `tallyFor` returns how
 * many times one skill was logged and the sum of the durations the user stated. It is shown on
 * each row beside that row's own name, and the list is never sorted by it — a column that can be
 * sorted by is a leaderboard waiting for someone to press the header.
 *
 * ## What the page shows when there is nothing
 *
 * An empty state that tells the truth: the list is empty because nothing has been added, and
 * skills are things the user names. No example skills, no suggestions, no defaults — the PRD's
 * examples ("read a book", "10 pushups") belong to the user to write, and an application that
 * pre-fills a personal list has started editing it.
 *
 * Server-only: it reaches storage through the composition root.
 */
import "server-only";

import type { Skill, SkillWithTally } from "@/domain/skills";
import {
  MAX_SKILLS,
  remainingSkillSlots,
  swapList,
  tallyFor,
} from "@/domain/skills";

import { getRepositories } from "../shared/command-runtime.ts";

/**
 * How many log entries the tallies are computed from.
 *
 * Bounded because a tally over an unbounded table is a full scan of a personal database. A hundred
 * is far more than a person needs to have done one activity a hundred times to know the habit
 * exists, and nothing on the page claims a total it has not counted.
 */
const TALLY_WINDOW = 100;

export type SkillsView = {
  /** Every skill the user has added, in the order they added them. */
  readonly skills: readonly SkillWithTally[];
  /** How many there are, which is at most `MAX_SKILLS`. */
  readonly count: number;
  /** The PRD's cap, shown so the user can see the limit rather than hit it. */
  readonly limit: number;
  /** How many more can be added. */
  readonly remaining: number;
  /** True when the next skill would be refused. */
  readonly atLimit: boolean;
  /**
   * The swap list: the full list, unfiltered and unordered.
   *
   * Returned separately from `skills` so that "show everything" is one value with one test over
   * it. A screen renders this, never a slice of it.
   */
  readonly swap: readonly Skill[];
};

/**
 * The whole skills read model.
 *
 * Takes no arguments, so a test can only check it against whatever is stored — which is the point:
 * there is no parameter through which a caller could ask for a different list.
 */
export function readSkills(): SkillsView {
  const repositories = getRepositories();
  const stored = repositories.skills.listAll();
  const logs = repositories.skills.recentLogs(TALLY_WINDOW);

  // `swapList` copies and filters nothing. Called on the stored rows before tallies are attached,
  // so what it returns is the raw list and cannot accidentally carry presentation state.
  const swap = swapList(stored);
  const remaining = remainingSkillSlots(stored);

  return {
    skills: swap.map((skill) => tallyFor(skill, logs)),
    count: stored.length,
    limit: MAX_SKILLS,
    remaining,
    atLimit: remaining === 0,
    swap,
  };
}
