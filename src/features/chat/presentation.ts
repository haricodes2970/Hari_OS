/**
 * What the chat input shows, and how that text is produced.
 *
 * This module is pure, imports nothing server-side, and is the only place a sentence about a
 * user's action is written. It is deliberately client-safe so a component can render it
 * without pulling a database connection or a provider credential into the browser bundle.
 *
 * ## The confirmation comes from the result, not from the model
 *
 * Every number in a confirmation is read out of a trusted `ExecutionOutcome` that SQLite
 * already accepted, or formatted by the domain's own `formatMinorUnits`. The model is not
 * asked whether an operation succeeded, and its text is never shown as the outcome. If a
 * write is rejected, this module renders the real failure, so the application cannot claim
 * "Done" over a rolled-back transaction.
 *
 * ## The model is never quoted
 *
 * When something is refused or unclear, the message shown to the user is written here, from a
 * closed set. A proposal's free-text `reason` is used for server-side diagnostics only and is
 * never rendered. This is a deliberate safety property rather than a stylistic one: it means a
 * model — or a sentence crafted to steer one — cannot put arbitrary content into the page, and
 * it is why the messages stay consistent instead of varying with whatever the model felt like
 * saying.
 *
 * The one place the user's own words appear is the echoed sentence, which is the user's data
 * being shown back to them and is escaped by the renderer like any other text.
 */

import { formatMinorUnits, type MinorUnits } from "@/domain/money";

/**
 * A quantity, as the domain represents it.
 *
 * Declared structurally rather than imported from `@/domain/quantity` so this file's types
 * describe the shape it reads without restating what that module already defines. The values
 * pass through unchanged; nothing here converts or compares them.
 */
type Quantity = number;

/**
 * A successful execution, described structurally.
 *
 * Structural, and imported from nowhere, because components may not import `@/commands`. The
 * real `ExecutionOutcome` satisfies it, and this module only reads the fields a sentence
 * needs.
 */
export type TrustedOutcome =
  | {
      readonly kind: "inventory";
      readonly change: {
        readonly itemName: string;
        readonly unit: string;
        readonly before: Quantity;
        readonly after: Quantity;
        readonly delta: number;
      };
    }
  | {
      readonly kind: "expense";
      readonly change: {
        readonly accountName: string;
        readonly before: MinorUnits;
        readonly after: MinorUnits;
        readonly delta: MinorUnits;
        /** Present on a real expense outcome; the stored row. */
        readonly expense?: {
          readonly item: string;
          readonly amount: MinorUnits;
          readonly category: string | null;
        };
      };
    }
  | {
      /** Phase 6. The task that was stored, and the completion it now carries. */
      readonly kind: "task";
      readonly change: {
        readonly kind: "task";
        readonly after: boolean;
        readonly task: {
          readonly id: number;
          readonly date: string;
          readonly title: string;
          readonly done: boolean;
        };
      };
    }
  | {
      /**
       * Phase 7. A skill was added, or one use of a skill was logged.
       *
       * `tally` is absent on purpose. Reading the skill back out of the database to put a
       * running total in a chat sentence would make a confirmation depend on a count the user
       * did not ask about, and for a habit system the accumulating number is the thing most
       * worth refusing.
       */
      readonly kind: "skill";
      readonly change:
        | {
            readonly action: "created";
            readonly skill: { readonly name: string };
          }
        | {
            readonly action: "logged";
            readonly skill: { readonly name: string };
            readonly log: { readonly minutes: number | null };
          };
    }
  | {
      /** Phase 7. What one habit's row now says. */
      readonly kind: "habit";
      readonly change: {
        readonly habit: {
          readonly date: string;
          readonly type: string;
          readonly done: boolean;
          readonly minutes: number | null;
          readonly photoUrl: string | null;
        };
        readonly photoAttached: boolean;
      };
    }
  | {
      /**
       * Phase 7. One private entry.
       *
       * **No count field exists, and that is the point.** The outcome carries the day and the
       * type so the sentence can be accurate, and carries nothing that could be tallied — so
       * there is no number here for a future change to accumulate into a streak.
       */
      readonly kind: "private";
      readonly change: {
        readonly date: string;
        readonly type: string;
        readonly happened: boolean;
      };
    }
  | {
      /** Phase 6. A night, or a nap. */
      readonly kind: "sleep";
      readonly change:
        | {
            readonly kind: "night";
            readonly field: string;
            readonly night: {
              readonly date: string;
              readonly bedtime: string | null;
              readonly sleepTime: string | null;
              readonly wakeTime: string | null;
              readonly phoneOutside: boolean;
            };
          }
        | {
            readonly kind: "nap";
            readonly nap: {
              readonly id: number;
              readonly date: string;
              readonly start: string;
              readonly end: string | null;
            };
          };
    };

/** The kind of command that was run, used only to choose the wording. */
export type AppliedKind =
  | "inventory.consume"
  | "inventory.restock"
  | "inventory.set_quantity"
  | "inventory.recount_after_use"
  | "expense.record"
  | "task.create"
  | "task.set_done"
  | "sleep.record"
  | "nap.start"
  | "nap.end"
  | "skill.create"
  | "skill.log"
  | "habit.record"
  | "private.log";

/**
 * How a habit type is named in a sentence.
 *
 * Kept here, beside the other wording, so the chat surface and the pages cannot drift apart on
 * what a habit is called. `screen_time` has no entry: it is a measurement and gets its own
 * sentence above, because "Screen time recorded as done" is a sentence that should not exist.
 */
const HABIT_LABELS: Record<string, string> = {
  cooking: "Cooking",
  dishes: "Dishes",
  laundry: "Laundry",
};

/** A stated `HH:MM` as a person says it, for a sentence. */
function clockLabel(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours < 12 ? "am" : "pm";
  const hour = hours % 12 === 0 ? 12 : hours % 12;

  return minutes === 0
    ? `${hour} ${suffix}`
    : `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/**
 * Everything the chat surface can be told, in terms it can render.
 *
 * `applied` is separated from every refusal so a success can never be produced by a path that
 * did not receive a successful execution result. Constructing an `applied` requires an
 * outcome the executor produced, which requires a command SQLite accepted.
 */
export type ChatResult =
  | {
      readonly status: "applied";
      readonly kind: AppliedKind;
      readonly message: string;
    }
  | {
      readonly status: "needs_clarification";
      readonly missing: readonly string[];
    }
  | { readonly status: "unsupported" }
  | { readonly status: "unreadable" }
  | { readonly status: "unconfigured"; readonly message: string }
  | { readonly status: "unavailable"; readonly message: string }
  | {
      /** A real execution failure, rendered with the Phase 1 vocabulary. */
      readonly status: "rejected";
      readonly token: string;
      readonly field: string | null;
    }
  | { readonly status: "empty" };

/** Absolute change, for wording. A consumption stores a negative delta. */
function magnitude(delta: number): number {
  return Math.abs(delta);
}

function accountLabel(name: string): string {
  return name === "cash"
    ? "Cash"
    : name === "bank1"
      ? "Bank 1"
      : name === "bank2"
        ? "Bank 2"
        : name;
}

/**
 * The sentence for a completed action.
 *
 * Every figure is taken from the stored outcome. `before`, `after`, and `delta` come from the
 * same domain operation that wrote the row, so the sentence cannot disagree with the database
 * — and where a unit is unknown, the number is still correct and the unit is simply omitted
 * rather than guessed.
 */
export function describeApplied(
  kind: AppliedKind,
  outcome: TrustedOutcome,
): string {
  if (kind === "expense.record" && outcome.kind === "expense") {
    const { accountName, after, expense } = outcome.change;
    const label = accountLabel(accountName);
    const what = expense?.item ?? "something";

    return `Bought ${what} for ${formatMinorUnits(
      expense?.amount ?? 0,
    )} using ${label}. ${label} balance: ${formatMinorUnits(after)}.`;
  }

  if (outcome.kind === "task") {
    const { task, after } = outcome.change;

    return kind === "task.create"
      ? `Added "${task.title}" to ${task.date}.`
      : `Marked "${task.title}" as ${after ? "done" : "not done"}.`;
  }

  if (outcome.kind === "skill") {
    const { action } = outcome.change;

    if (action === "created") {
      return `Added "${outcome.change.skill.name}" to your skills.`;
    }

    const { minutes } = outcome.change.log;

    return minutes === null
      ? `Logged ${outcome.change.skill.name}.`
      : `Logged ${outcome.change.skill.name} for ${minutes} minutes.`;
  }

  if (outcome.kind === "habit") {
    const { habit, photoAttached } = outcome.change;
    const label = HABIT_LABELS[habit.type] ?? habit.type;

    if (habit.type === "screen_time") {
      return `Screen time: ${habit.minutes ?? 0} minutes.`;
    }

    return `${label} recorded as ${habit.done ? "done" : "not done"}${
      photoAttached ? ", with the photo attached." : "."
    }`;
  }

  if (outcome.kind === "private") {
    const label =
      outcome.change.type === "masturbation"
        ? "Masturbation"
        : "Doom scrolling";

    return outcome.change.happened
      ? `Saved the ${label.toLowerCase()} entry for ${outcome.change.date}.`
      : `Removed the ${label.toLowerCase()} entry for ${outcome.change.date}.`;
  }

  if (outcome.kind === "sleep") {
    if (outcome.change.kind === "nap") {
      const { start, end } = outcome.change.nap;

      return end === null
        ? `Nap started at ${clockLabel(start)}. It is still running.`
        : `Nap ended at ${clockLabel(end)}.`;
    }

    const { night, field } = outcome.change;

    if (
      field === "bedtime" ||
      field === "sleep_time" ||
      field === "wake_time"
    ) {
      const said =
        field === "bedtime"
          ? night.bedtime
          : field === "sleep_time"
            ? night.sleepTime
            : night.wakeTime;

      return said === null
        ? "Saved."
        : `Recorded ${field === "sleep_time" ? "sleep time" : field} as ${clockLabel(said)}.`;
    }

    return "Saved.";
  }

  const change = outcome.kind === "inventory" ? outcome.change : null;
  if (change === null) {
    // Unreachable through the engine, which pairs kinds and outcomes. Reported rather than
    // ignored so a future mismatch surfaces as a sentence instead of a blank space.
    return "Saved.";
  }

  const { itemName, unit, after, delta } = change;
  const remaining = unit === "" ? `${after}` : `${after} ${unit}`;

  if (kind === "inventory.consume") {
    return `Used ${magnitude(delta)} ${itemName}. Remaining: ${remaining}.`;
  }

  if (kind === "inventory.restock") {
    return `Restocked ${magnitude(delta)} ${itemName}. Now: ${remaining}.`;
  }

  if (kind === "inventory.recount_after_use") {
    // Only the resulting figure is shown. The count and the use were two separate statements
    // in one sentence, and the user is told what is true now rather than a replay of what
    // they said.
    return `Counted and used ${itemName}. Now: ${remaining}.`;
  }

  return `Set ${itemName} to ${remaining}.`;
}

/**
 * A question per missing fact, so the user is told exactly what to add.
 *
 * Keyed by a plain string and filtered against this table when used, rather than typed as a
 * union imported from `src/commands`. Components may not import the command layer, and the
 * import boundary exists to keep it that way; the trade is that a fact this table does not know
 * produces no question, which is why an unknown fact falls back to a generic message below
 * rather than rendering `undefined`. The parser's own closed set and this table are asserted to
 * agree by `parser-test.mjs`.
 */
const MISSING_QUESTIONS: Record<string, string> = {
  itemName: "Which item?",
  item: "What did you spend it on?",
  quantity: "I need the quantity.",
  unit: "I need the unit.",
  amount: "I need the amount.",
  accountName: "I need the account used for that expense.",
};

export type ChatMessage = {
  readonly tone: "ok" | "warn" | "error";
  readonly title: string;
  readonly detail: string;
};

/**
 * The message for a result.
 *
 * Returns `null` for `empty`, so an ordinary page visit with no submission renders nothing
 * and a component does not need to special-case the absence of a result.
 */
export function describeChatResult(result: ChatResult): ChatMessage | null {
  switch (result.status) {
    case "empty":
      return null;

    case "applied":
      return { tone: "ok", title: "Saved.", detail: result.message };

    case "needs_clarification": {
      // Unknown facts are dropped rather than rendered, so a fact this table has never heard
      // of cannot put an arbitrary word on the page.
      const questions = result.missing
        .map((fact) => MISSING_QUESTIONS[fact])
        .filter((question): question is string => question !== undefined);

      return {
        tone: "warn",
        title: "I need a little more.",
        detail:
          questions.length === 0
            ? "I could not tell what action that was."
            : questions.join(" "),
      };
    }

    case "unsupported":
      return {
        tone: "warn",
        title: "Not something I can record yet.",
        detail:
          "I could not understand that as a supported Hari OS action. Right now I can record kitchen stock and expenses.",
      };

    case "unreadable":
      return {
        tone: "warn",
        title: "I could not read that.",
        detail:
          "That sentence did not come back as a command I understand, so nothing was changed.",
      };

    case "unconfigured":
    case "unavailable":
      return {
        tone: "error",
        title: "Parsing is unavailable.",
        detail: `${result.message} Nothing was changed.`,
      };

    case "rejected": {
      // Reuses the Phase 1 vocabulary, so a refusal means the same thing here as it does on
      // the structured form path. One set of sentences for one set of rules.
      return {
        tone: "error",
        title: "Not saved.",
        detail: REJECTION_DETAIL[result.token] ?? "The change was refused.",
      };
    }
  }
}

/**
 * Rejection wording, keyed by the same outcome tokens the structured path uses.
 *
 * Imported lazily by structure rather than by module reference so this file keeps no
 * dependency on the command layer. The tokens are fixed strings, so a token arriving from a
 * URL cannot become a message; anything unrecognised falls through to a neutral sentence.
 */
const REJECTION_DETAIL: Record<string, string> = {
  unknown_item: "That item is not in your kitchen yet, so nothing was changed.",
  missing_account: "That account does not exist, so nothing was changed.",
  insufficient_inventory: "You do not have that much, so nothing was changed.",
  invalid_unit:
    "That unit does not match how the item is tracked, so nothing was changed.",
  invalid_quantity:
    "The quantity must be a number of zero or more, so nothing was changed.",
  invalid_money:
    "The amount must be zero or more and no finer than a paisa, so nothing was changed.",
  invalid_command:
    "I could not read that as a valid command, so nothing was changed.",
  persistence_failed:
    "The database could not store this, so nothing was written. Try again.",
};
