/**
 * The habit log's vocabulary: the three things the PRD says get logged.
 *
 * ## This is a type, not a feature
 *
 * The Dashboard shows laundry and dishes status because PRD section 6.1 asks for it, and reading
 * that status requires naming the three values `habit_log.type` can hold. That is the whole
 * content of this file. There is deliberately no rule here for whether laundry is due, no target
 * frequency, no streak, and no photo requirement: the PRD asks for a target of twice a week and
 * proof by photograph, and both belong to the Habits phase, which has not been built.
 *
 * Writing a habit is not possible in this application. Nothing in `src/` inserts a `habit_log`
 * row, so the Dashboard's habit section reflects only what a row already says, and reports an
 * absent entry as "not recorded" rather than as "not done" — those are different claims, and only
 * the second one would be a judgement the data does not support.
 *
 * The closed set mirrors the schema's `CHECK (type IN ('cooking', 'dishes', 'laundry'))`, the same
 * way `accounts.ts` mirrors `account.name`. Duplicating the list here is deliberate: the schema
 * is what storage enforces, and this is what the application is willing to speak about. They are
 * asserted to agree in `scripts/dashboard-test.mjs`.
 *
 * Pure. No clock, no database, no filesystem.
 */
/**
 * The PRD's three daily habits, in the schema's own order.
 *
 * `cooking` is included because the PRD's section 6.6 lists it first, even though the Dashboard
 * shows laundry and dishes: omitting it would mean a habit row could not be displayed at all.
 */
export const HABIT_TYPES = ["cooking", "dishes", "laundry"] as const;

export type HabitType = (typeof HABIT_TYPES)[number];

export function isHabitType(value: string): value is HabitType {
  return (HABIT_TYPES as readonly string[]).includes(value);
}

/** One logged habit, matching the `habit_log` row. */
export type HabitLog = {
  readonly type: HabitType;
  readonly done: boolean;
  /** Whether a photograph was attached. V1 accepts a placeholder for this, per PRD section 6.6. */
  readonly hasPhoto: boolean;
};
