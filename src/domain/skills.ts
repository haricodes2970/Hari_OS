/**
 * Skills: the user's own list of replacement activities, and the record of using them.
 *
 * ## The one rule this module exists to protect
 *
 * **The application never chooses a skill.** Not this module, not the executor, not the parser,
 * and certainly not the model. Every function here that returns skills returns them in the order
 * the user created them, filtered by nothing, and none of them returns a "best", a "top", or a
 * recommendation. `swapList` exists so that "the full list, unmodified" is a code fact with a
 * test over it, rather than a promise written in a comment on a page.
 *
 * The PRD is explicit — "one tap shows the full list; the user picks one. The app never
 * auto-picks" — and the reason is the product's first principle: the assistant surfaces options
 * and the user decides. A "recommended skill" would be a decision made on the user's behalf in
 * the one place the product promised it would not be.
 *
 * ## The ten-skill limit
 *
 * The PRD's own cap. It is enforced here rather than in storage, so an eleventh skill is
 * refused with a sentence the user can act on instead of a `UNIQUE`-style constraint error, and
 * so the count cannot depend on how many rows a read happened to return.
 *
 * ## Duration is a stated fact, not a measurement
 *
 * `skill_log.minutes` is optional and the user supplies it ("read for 30 minutes"). When it is
 * absent the log is stored with `NULL` and the page says "not recorded" — the application never
 * starts a timer, never infers a duration from the previous log, and never asks the model to
 * subtract two timestamps. `tallyFor` adds up durations that were stated and counts entries, so
 * a skill used without a duration still shows that it was used.
 *
 * Pure. No clock, no database, no filesystem, no provider.
 */
import { fail, ok, type Result } from "./result.ts";

/**
 * The PRD's cap: "the up to 10 skills chosen for the next 30 days".
 *
 * A limit rather than a warning. Ten replacement activities is what the PRD says the feature is
 * for, and a list that can grow without bound stops being a list the user can read at the moment
 * an urge arrives.
 */
export const MAX_SKILLS = 10;

/**
 * How long a skill name may be.
 *
 * 80 characters is enough for "research for studies" and short enough that the swap list stays
 * one line per entry on a phone. There is no lower limit beyond "not empty".
 */
export const MAX_SKILL_NAME = 80;

/**
 * The longest a single logged session may be, in minutes: 24 hours.
 *
 * A duration longer than a day cannot be a session of doing something, and accepting one would
 * let a mistyped `2500` sit in the tally forever. It is a sanity bound, not a goal.
 */
export const MAX_SKILL_MINUTES = 24 * 60;

/** One stored skill, matching the `skill` row. */
export type Skill = {
  readonly id: number;
  readonly name: string;
  /**
   * `skill.active`.
   *
   * Kept because the column exists and a row carries it, but nothing in this phase writes it or
   * reads it to filter a list. See `swapList` for why an inactive skill is not a thing V1
   * needs: hiding an entry from the swap list is the one operation the PRD forbids.
   */
  readonly active: boolean;
};

/** One `skill_log` row. `timestamp` is the server's, never the model's. */
export type SkillLog = {
  readonly id: number;
  readonly skillId: number;
  readonly timestamp: string;
  /** `null` when the user did not say how long it took. */
  readonly minutes: number | null;
};

/** A skill as the page needs it: the row plus what has been done with it. */
export type SkillWithTally = {
  readonly skill: Skill;
  /** How many times it has been logged. */
  readonly times: number;
  /** The sum of the stated durations, or `null` when none of its entries carried one. */
  readonly minutes: number | null;
  /** ISO instant of its most recent entry, or `null` when it has never been used. */
  readonly lastUsedAt: string | null;
};

/**
 * Checks a skill name.
 *
 * Trims first, because the name is stored trimmed and a name that differs only by whitespace is
 * the same name twice as far as the user is concerned. Control characters are refused outright:
 * they are invisible in a list, and a name the user cannot see is a name they cannot check.
 */
export function validateSkillName(name: string): Result<string> {
  const trimmed = name.trim();

  if (trimmed === "") {
    return fail(
      "invalid_skill_name",
      "Give the skill a name the list can show.",
      { name },
    );
  }

  if (/[\u0000-\u001F\u007F]/u.test(trimmed)) {
    return fail(
      "invalid_skill_name",
      "A skill name cannot contain control characters.",
      { name },
    );
  }

  if (trimmed.length > MAX_SKILL_NAME) {
    return fail(
      "invalid_skill_name",
      `A skill name can be at most ${MAX_SKILL_NAME} characters.`,
      { name, length: trimmed.length, limit: MAX_SKILL_NAME },
    );
  }

  return ok(trimmed);
}

/**
 * Finds a skill by the name the user said.
 *
 * Case-insensitive and whitespace-trimmed, because "Read a book" and "read a book" are the same
 * activity and a user who cannot find the one they typed will create a second one. The comparison
 * lives here, not in SQL, so "the same skill" means one thing in the whole application.
 */
export function findSkill(
  existing: readonly Skill[],
  name: string,
): Skill | null {
  const wanted = name.trim().toLowerCase();

  if (wanted === "") {
    return null;
  }

  return existing.find((skill) => skill.name.toLowerCase() === wanted) ?? null;
}

/**
 * Adds a skill to the user's list.
 *
 * `existing` is the list as stored, so the limit and the duplicate check are decided here from
 * real rows rather than from a count the caller remembered. A name that already exists is
 * refused rather than merged: silently accepting "Read a book" as "read a book" would create two
 * entries the user then has to reconcile, and the user owns this list.
 */
export function createSkill(
  input: { readonly name: string },
  existing: readonly Skill[],
): Result<Skill> {
  const name = validateSkillName(input.name);

  if (!name.ok) {
    return name;
  }

  if (existing.length >= MAX_SKILLS) {
    return fail(
      "skill_limit_reached",
      `The list holds ${MAX_SKILLS} skills, which is the most the PRD allows. Remove one before adding another.`,
      { count: existing.length, limit: MAX_SKILLS },
    );
  }

  const duplicate = existing.find(
    (skill) => skill.name.toLowerCase() === name.value.toLowerCase(),
  );

  if (duplicate !== undefined) {
    return fail("duplicate_skill", `"${name.value}" is already on the list.`, {
      name: name.value,
    });
  }

  return ok({ id: 0, name: name.value, active: true });
}

/**
 * Records one use of a skill.
 *
 * `minutes` is the duration the user stated, or `null` for "I did it, I did not say for how
 * long". There is no field for a computed duration and no way to pass one in: `skill_log` stores
 * what was said, and `tallyFor` adds it up afterwards.
 */
export function logSkillUse(
  skill: Skill,
  input: { readonly minutes?: number | null },
): Result<SkillLog> {
  const stated = input.minutes ?? null;

  if (stated === null) {
    return ok({ id: 0, skillId: skill.id, timestamp: "", minutes: null });
  }

  if (!Number.isInteger(stated)) {
    return fail(
      "invalid_skill_minutes",
      "A duration has to be a whole number of minutes.",
      { minutes: stated },
    );
  }

  if (stated < 0) {
    return fail("invalid_skill_minutes", "A duration cannot be negative.", {
      minutes: stated,
    });
  }

  if (stated > MAX_SKILL_MINUTES) {
    return fail(
      "invalid_skill_minutes",
      `A single session cannot be longer than ${MAX_SKILL_MINUTES} minutes.`,
      { minutes: stated, limit: MAX_SKILL_MINUTES },
    );
  }

  return ok({ id: 0, skillId: skill.id, timestamp: "", minutes: stated });
}

/**
 * What one skill has accumulated.
 *
 * A count of entries and a sum of the durations that were stated. No streak, no score, no
 * percentage, and no comparison between skills: the PRD allows a neutral tally per skill, and a
 * tally that ranks is a leaderboard.
 */
export function tallyFor(
  skill: Skill,
  logs: readonly SkillLog[],
): SkillWithTally {
  const mine = logs.filter((entry) => entry.skillId === skill.id);
  const stated = mine
    .map((entry) => entry.minutes)
    .filter((minutes): minutes is number => minutes !== null);
  const last = mine.reduce<string | null>(
    (latest, entry) =>
      latest === null || entry.timestamp > latest ? entry.timestamp : latest,
    null,
  );

  return {
    skill,
    times: mine.length,
    minutes:
      stated.length === 0
        ? null
        : stated.reduce((total, value) => total + value, 0),
    lastUsedAt: last,
  };
}

/**
 * The list shown when an urge arrives.
 *
 * ## Why this function exists
 *
 * "Show the full list" is the product rule, and a rule that only lives in a JSX expression is a
 * rule that a later edit can quietly break — by filtering to the "active" ones, by sorting by
 * how often each was used, or by taking the first three. So the swap list is a function, it
 * returns every skill in stored order, and a test asserts that it neither drops nor reorders
 * anything.
 *
 * ## Why nothing is filtered here
 *
 * `skill.active` exists in the schema and is not consulted. Deactivating a skill would hide it
 * from the moment the user most needs to see it, and the PRD is unambiguous that the list is
 * never hidden, truncated, or reordered. V1 therefore has no command that sets `active`, and a
 * skill the user has added is a skill the swap list shows.
 */
export function swapList(skills: readonly Skill[]): readonly Skill[] {
  return [...skills];
}

/**
 * Whether the user has room for another skill.
 *
 * Purely for wording: the page says how many are left, and it reads this rather than repeating
 * the arithmetic.
 */
export function remainingSkillSlots(existing: readonly Skill[]): number {
  return Math.max(0, MAX_SKILLS - existing.length);
}
