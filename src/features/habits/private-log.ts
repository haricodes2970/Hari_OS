/**
 * The private log: a neutral record of two things the user chose to write down.
 *
 * ## Why this is a separate module
 *
 * PRD 6.6: "Private log (yes/no plus optional note) for doom-scrolling incidents and
 * masturbation. **Never shown as a streak, score, or progress bar.**" That is a requirement about
 * the user's wellbeing — the stated reason is avoiding a shame spiral — so it is worth spending
 * structure on rather than discipline.
 *
 * This file is the only place in `src/` that reads `private_log`. The Habits page imports it; the
 * Dashboard, the Routine page, the Kitchen page, and every read model except this one cannot,
 * because `private_log` is reachable only through `repositories.privateLog` and nothing else
 * returns those rows. `src/features/habits/view.ts` does not import this file, which is what
 * keeps the Dashboard — which reads that module — structurally unable to see a private entry
 * even if someone later wanted to add one to the summary.
 *
 * ## What this module will never produce
 *
 * There is no function here that takes entries and returns a number. Not a count, not a total,
 * not a streak, not a frequency, not a "this week" figure. The PRD's prohibition is on showing
 * these as a streak, a score, or a bar, and a count is a streak without the calendar. So the only
 * things that come out of here are a dated list of entries and the one entry for today.
 *
 * ## The wording is the other half of the rule
 *
 * The labels say what the entry is. They do not say how often, how much, how bad, or what it
 * means, and nothing here infers an addiction, a health status, or a psychological state from an
 * entry — the application has no basis for that and the user did not ask for it.
 *
 * ## Entries are replaced per day, not accumulated silently
 *
 * `private_log` allows several rows for a day. Writing an entry for a day and type that already
 * has one replaces it, so "did this happen today?" has one answer and a correction is a
 * correction rather than an append.
 *
 * Server-only.
 */
import "server-only";

import type { CalendarDate } from "@/domain/calendar";
import type { PrivateLogEntry, PrivateType } from "@/domain/habits";
import { PRIVATE_TYPES, privateTypeLabel } from "@/domain/habits";

import { getRepositories } from "../shared/command-runtime.ts";

/** How many entries the review shows. A list for reading; nothing counts them. */
const REVIEW_LIMIT = 30;

export type PrivateEntryView = {
  readonly id: number;
  /** Which behaviour this row is about, in the schema's own vocabulary. */
  readonly type: PrivateType;
  readonly date: string;
  /** What the entry is, in the PRD's own words. */
  readonly label: string;
  /** The user's own words, or `null`. Rendered as written, escaped like any other text. */
  readonly note: string | null;
  /** Whether an entry exists for today and this type. */
  readonly recordedToday: boolean;
};

export type PrivateLogView = {
  readonly date: string;
  /** One row per private type, whether or not anything was recorded today. */
  readonly types: readonly PrivateEntryView[];
  /** Recent entries, newest first. A list for reading. Never a count of anything. */
  readonly entries: readonly PrivateEntryView[];
};

/**
 * Builds one row per private type, in the schema's own order.
 *
 * Every type gets a row even when nothing was recorded, so a missing entry reads as "not
 * recorded" — the same distinction the Dashboard makes for habits, and for the same reason: only
 * a stored entry is a statement about the user.
 *
 * A row carries only the entry's own facts: its date, what it is, and the user's note. There is
 * no field here that could hold a count, and no argument for one.
 */
function todayRows(
  date: CalendarDate,
  today: ReadonlyMap<PrivateType, PrivateLogEntry>,
): readonly PrivateEntryView[] {
  return PRIVATE_TYPES.map((type) => {
    const entry = today.get(type);

    return {
      id: entry?.id ?? 0,
      type,
      date,
      label: privateTypeLabel(type),
      note: entry?.note ?? null,
      recordedToday: entry !== undefined,
    };
  });
}

/** The private log for a day, and the recent entries to read back. */
export function readPrivateLog(date: CalendarDate): PrivateLogView {
  const repositories = getRepositories();
  const recent = repositories.privateLog.listRecent(REVIEW_LIMIT);
  const todayByType = new Map<PrivateType, PrivateLogEntry>();

  for (const type of PRIVATE_TYPES) {
    const entry = repositories.privateLog.findForDay(date, type);

    if (entry !== null) {
      todayByType.set(type, entry);
    }
  }

  return {
    date,
    types: todayRows(date, todayByType),
    entries: recent.map((entry) => ({
      id: entry.id,
      type: entry.type,
      date: entry.date,
      label: privateTypeLabel(entry.type),
      note: entry.note,
      recordedToday: entry.date === date,
    })),
  };
}
