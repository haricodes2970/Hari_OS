/**
 * The persistence boundary: the only place that reads and writes application tables.
 *
 * Repositories know about rows. They do not know what a command means, and they contain no
 * business arithmetic — every number they write was decided by `src/domain` beforehand. The
 * executor computes, this layer stores.
 *
 * ## Where the three error vocabularies meet
 *
 * The project now has three deliberately separate failure vocabularies, and mixing them up
 * would be a real bug: a caller reacting to "the model sent nonsense" must not look the same
 * as one reacting to "the disk is full".
 *
 * - **Validation** (`src/lib/validation`) — the input was malformed.
 * - **Domain** (`src/domain`) — a rule refused the request. "No item named onions",
 *   "only 3 available", "amount must be whole minor units".
 * - **Persistence** (this file) — storage failed. A constraint, a closed handle, a full disk.
 *
 * So a read returns the domain's `Result`, because "no such item" is a domain concept that
 * `findInventoryItem` already owns, and reusing it keeps name matching in exactly one place.
 * A write returns `PersistenceResult`, because a write has no domain failure to report — it
 * either stored the value or it did not.
 *
 * ## Name matching is not duplicated here
 *
 * `findByName` loads the candidates and hands them to the domain's own `findInventoryItem`
 * and `findAccount`, rather than reimplementing the comparison in SQL. A kitchen inventory is
 * tens of rows, not millions, and a second copy of the matching rule would be a second thing
 * to keep in step with the first. The domain stays the single source of truth for what counts
 * as the same name.
 */
import "server-only";

import type { Account, AccountName, ExpenseDraft } from "@/domain/accounts";
import { findAccount, isAccountName } from "../../domain/accounts.ts";
import type { InventoryEventDraft, InventoryItem } from "@/domain/inventory";
import {
  findInventoryItem,
  findInventoryItemById,
} from "../../domain/inventory.ts";
import type { CalendarDate } from "../../domain/calendar.ts";
import {
  isLoggableHabitType,
  type HabitLog,
  type LoggableHabitType,
  type PrivateLogEntry,
  type PrivateType,
} from "../../domain/habits.ts";
import type { Skill, SkillLog } from "../../domain/skills.ts";
import { findSkill } from "../../domain/skills.ts";
import type { PlanTask } from "@/domain/routine";
import type { NapLog, SleepLog } from "../../domain/sleep.ts";
import type { Quantity } from "@/domain/quantity";
import type { MinorUnits } from "@/domain/money";
import type { Result } from "@/domain/result";

import type { DatabaseHandle } from "./connection";

/** A storage failure. Carries no domain meaning and no domain code. */
export type PersistenceError = {
  readonly code: "persistence_failed";
  readonly message: string;
};

export type PersistenceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PersistenceError };

/**
 * Maps a thrown storage error onto the failure the rest of the application reports.
 *
 * Most messages are passed through unchanged, because SQLite's own wording is precise and there
 * is nothing to improve on it. One is not: a locked database says only `database is locked`, which
 * tells a user nothing about whether their entry was saved and what to do next. Phase 9 names a
 * locked file as a reliability case, and the honest answer is a sentence that says the change was
 * **not** stored and why — the failure mode that matters here is a user believing a spend was
 * recorded when it was not.
 *
 * No code changes: `persistence_failed` is still a persistence failure, and the classification the
 * caller makes is unchanged.
 */
function persisted(cause: unknown): PersistenceError {
  const message = cause instanceof Error ? cause.message : String(cause);

  if (isLockedOut(message)) {
    return {
      code: "persistence_failed",
      message:
        "The database is being used by another program, so nothing was saved. Close it and try again.",
    };
  }

  return { code: "persistence_failed", message };
}

/** Whether this is SQLite refusing to write because another process holds the lock. */
function isLockedOut(message: string): boolean {
  return (
    message.includes("SQLITE_BUSY") ||
    message.includes("SQLITE_LOCKED") ||
    message.includes("database is locked") ||
    message.includes("database table is locked")
  );
}

/**
 * The inventory reads and writes execution and setup both need.
 *
 * Split by *what a write means*, not by which screen asked. `saveQuantity` and `appendEvent`
 * are the two halves of one movement and are always used together inside a transaction.
 * `insertItem`, `saveDetails`, and `saveLowThreshold` change no quantity, so they write no
 * event: a log entry explaining a rename would be a lie about what happened to the stock.
 */
export type InventoryRepository = {
  /** The tracked item with this name, or the domain's `unknown_item` failure. */
  findByName(name: string): Result<InventoryItem>;
  /** The tracked item with this id, or the domain's `unknown_item` failure. */
  findById(id: number): Result<InventoryItem>;
  /** Stores a quantity the domain has already computed. */
  saveQuantity(itemId: number, quantity: Quantity): PersistenceResult<void>;
  /** Appends the log entry that makes the change correctable. */
  appendEvent(event: InventoryEventDraft): PersistenceResult<void>;
  /**
   * Starts tracking an item, with the opening quantity as one logged event.
   *
   * The event is part of this call rather than a separate step so that an item's quantity is
   * always equal to the sum of its deltas, from the moment it exists. A row whose quantity
   * cannot be explained by its own log would be a gap in the audit trail at the very first
   * entry. A zero opening quantity writes no event, because there is no movement to record.
   */
  insertItem(
    item: InventoryItem,
    opening: { readonly timestamp: string; readonly sourceText: string | null },
  ): PersistenceResult<void>;
  /**
   * An unused id for a new item.
   *
   * `createInventoryItem` requires an explicit id rather than defaulting one, because a new
   * item's stock is a fact only the user knows. The id is the one thing the database owns, so
   * it is asked for here rather than invented in the feature layer.
   */
  nextItemId(): number;
  /** Stores a rename or unit change. Never a quantity. */
  saveDetails(item: InventoryItem): PersistenceResult<void>;
  /** Stores the low-stock threshold, or clears it. Never a quantity. */
  saveLowThreshold(item: InventoryItem): PersistenceResult<void>;
  /** One logged event by its id, for correction. */
  findEvent(eventId: number): InventoryEventRow | null;
};

export type AccountRepository = {
  /** The account with this name, or the domain's `missing_account` failure. */
  findByName(name: AccountName): Result<Account>;
  /** Stores a balance the domain has already computed. */
  saveBalance(accountId: number, balance: MinorUnits): PersistenceResult<void>;
};

export type ExpenseRepository = {
  insert(draft: ExpenseDraft): PersistenceResult<void>;
};

/**
 * The daily plan: `plan_task`, unchanged since micro-phase 1.1.
 *
 * Phase 6 adds no column. The ordering rule is `id` ascending — the order rows were written —
 * so there is no priority field to keep in step, and no number a model could be asked to
 * choose. See `src/domain/routine.ts`.
 */
export type TaskRepository = {
  /** An unused id. The schema owns identity, so it is asked for here rather than invented. */
  nextTaskId(): number;
  /**
   * The task with this title on this day, or the domain's `unknown_task` failure.
   *
   * Title plus day rather than an id, because a command carries the words the user said. A
   * model cannot know a row id, and asking one to invent one would be asking it to fabricate
   * a fact.
   */
  findByDateAndTitle(date: string, title: string): Result<PlanTask>;
  /** Every task on a day, in writing order. */
  listForDate(date: string): PlanTask[];
  /** Stores a validated task and returns the id the schema assigned. */
  insertTask(task: {
    readonly date: string;
    readonly title: string;
  }): PersistenceResult<number>;
  /** Stores a completion the domain has already decided. */
  saveTaskDone(id: number, done: boolean): PersistenceResult<void>;
  /**
   * Removes a day's *undone* tasks.
   *
   * Used only by a night check-in replacing its own earlier list. Done tasks are never
   * touched: a completed task is a record that something happened, and a check-in submitted
   * twice must not erase the fact that yesterday's plan was carried out.
   */
  deleteUndoneForDate(date: string): PersistenceResult<void>;
};

/**
 * Nights: `sleep_log`, unchanged since micro-phase 1.1.
 *
 * `date` is the day the night *began*, so bedtime 23:30 on the 1st and wake 06:45 on the 2nd
 * are one row dated the 1st. That choice is what lets the schema's `UNIQUE (date)` mean
 * "one night per day" instead of "one row per wake-up", and it is the reason durations wrap
 * past midnight in `src/domain/sleep.ts` rather than being negative.
 */
export type SleepRepository = {
  /** The night that began on this day, or `null` when nothing has been recorded. */
  findNight(date: string): SleepLog | null;
  /** Creates the row with every time unset. Idempotent. */
  ensureNight(date: string): PersistenceResult<void>;
  /**
   * Stores one stated time, leaving the other two alone.
   *
   * Fields are written one at a time because that is how the fact arrives: "went to bed at
   * 11" says nothing about when the user woke, and writing a placeholder for it would invent
   * a time they never gave.
   */
  saveNightTime(
    date: string,
    field: "bedtime" | "sleep_time" | "wake_time",
    time: string,
  ): PersistenceResult<void>;
  /** Stores the night check-in's phone confirmation. */
  savePhoneOutside(date: string, outside: boolean): PersistenceResult<void>;
  /** Nights newest first, for the consistency streak. */
  listNights(limit: number): SleepLog[];
};

/** Naps: `nap_log`, unchanged since micro-phase 1.1. */
export type NapRepository = {
  /** Opens a nap. The end stays `null` until it is closed. */
  insertNap(date: string, start: string): PersistenceResult<number>;
  /** Closes a nap with a stated end time. */
  saveNapEnd(id: number, end: string): PersistenceResult<void>;
  /** The most recent nap on a day, whether open or closed. */
  lastNapForDate(date: string): NapLog | null;
  /** Every nap on a day, in the order they started. */
  listNapsForDate(date: string): NapLog[];
};

/**
 * Skills: the user's replacement-activity list, and what has been done with them.
 *
 * `findByName` loads the (at most ten) rows and hands them to the domain's `findSkill`, so
 * "the same skill" means one thing in the application rather than two — the rule this file's own
 * header already states for items and accounts.
 */
export type SkillRepository = {
  /** Every skill, in the order the user created them. That order is what the swap list shows. */
  listAll(): Skill[];
  /** The skill with this name, or `null`. Matching is the domain's. */
  findByName(name: string): Skill | null;
  /** Adds one. The name has already been validated by the domain. */
  insert(name: string): PersistenceResult<Skill>;
  /**
   * Appends one use.
   *
   * `timestamp` is the server's and `minutes` is the duration the user stated, or `null` when
   * they did not say. Nothing here derives a duration or a time.
   */
  appendLog(
    skillId: number,
    timestamp: string,
    minutes: number | null,
  ): PersistenceResult<SkillLog>;
  /**
   * Recent log entries across all skills, newest first, for the per-skill tally.
   *
   * Bounded, because a tally over an unbounded table would be a table scan of a personal database
   * that will never be large. The limit is generous enough that no real tally is truncated; the
   * page says nothing about totals it cannot see.
   */
  recentLogs(limit: number): SkillLog[];
};

/**
 * `habit_log`: cooking, dishes, laundry, and manually entered screen time.
 *
 * There is no unique constraint on `(date, type)` — the schema came that way from micro-phase
 * 1.1 and changing it would be a redesign. "One row per type per day" is therefore maintained by
 * the executor, which deletes and inserts inside one transaction. `findForDay` is what it reads
 * to decide whether it needs to.
 */
export type HabitRepository = {
  findForDay(date: CalendarDate, type: LoggableHabitType): HabitLog | null;
  /**
   * One entry by its row id, or `null`.
   *
   * Exists for the photo route, which is handed an id from a URL and must confirm the row exists
   * and carries a photo before it reads a file. No other caller uses it: every other read asks
   * for a day or a window, which is what a page wants and what this repository was shaped for.
   */
  findById(id: number): HabitLog | null;
  /**
   * Rewrites one day's row for one type, keeping its id, and returns the row.
   *
   * ## Why this exists instead of delete-then-insert
   *
   * Both write paths used to remove the row and insert a new one. That is invisible for a habit,
   * and it is not invisible for a diary entry:
   *
   * - **The words were lost.** `habit_log` carries `photo_note` (ADR-056), so replacing a row
   *   replaced the note too. Re-recording a habit from chat, or re-photographing a day, silently
   *   deleted what the user had written about that day.
   * - **The id was recycled.** SQLite assigns a rowid of `max(rowid) + 1`, so after the only row
   *   is deleted the next insert takes its number again. A diary page the user had open, naming
   *   entry 3, could then post a note to a row that was a *different day's* new photo. The note
   *   would be stored on the wrong picture, and nothing would say so.
   *
   * An `UPDATE` makes an entry's id stable for its lifetime, which is what makes it safe to
   * address a note to one. Matched by `(date, type)` rather than by id, because a day is the thing
   * the caller has; the id comes back with the row.
   *
   * `PersistenceFailed` when the day has no row: there is nothing to rewrite, and the caller
   * inserts instead rather than getting an empty success.
   */
  updateHabitForDay(
    date: CalendarDate,
    type: LoggableHabitType,
    change: {
      readonly done: boolean;
      readonly photoUrl: string | null;
      readonly photoNote: string | null;
      readonly minutes: number | null;
    },
  ): PersistenceResult<HabitLog>;
  /** Writes one row. Used when a day has no entry for that type yet. */
  insertHabit(habit: HabitLog): PersistenceResult<HabitLog>;
  /**
   * Sets the photo URL on one day's row for one type, and returns the row.
   *
   * A separate call because the URL contains the id, and the id comes from the insert — so the
   * two cannot be one statement. The photo route runs both inside one transaction, which is what
   * makes the pair atomic: a row with no photo, or a photo with no row, never both survive.
   *
   * Updating by `(date, type)` rather than by id is what keeps it a single statement without
   * knowing the id in advance. It is not a lookup path — nothing else calls this.
   */
  attachPhoto(
    date: CalendarDate,
    type: LoggableHabitType,
    photoUrl: string,
  ): PersistenceResult<HabitLog>;
  /**
   * Writes the note on one row, or clears it with `null`.
   *
   * One statement, matched by row id rather than by `(date, type)`, because the diary addresses
   * an entry the user is looking at. Clearing and adding are the same statement: a note is
   * nullable, so `null` is what "no note" is, and there is no second method to drift from this
   * one.
   *
   * The caller is responsible for the invariant "a note belongs to a row that has a photo" — this
   * statement would happily write one onto a photo-less row, which is why
   * `src/features/habits/diary.ts` checks the row before calling it. The check lives there rather
   * than in a `WHERE photo_url IS NOT NULL` clause because a miss here would otherwise look like
   * a successful write that stored nothing.
   */
  saveDiaryNote(id: number, note: string | null): PersistenceResult<HabitLog>;
  /** Every entry on one day, in the order the rows were written. */
  listForDate(date: CalendarDate): HabitLog[];
  /**
   * Every entry from `from` to `to` inclusive.
   *
   * Used for the PRD's "twice a week" laundry target over a trailing seven days, and for the photo
   * timeline. Both need a window rather than a single day.
   */
  listBetween(from: CalendarDate, to: CalendarDate): HabitLog[];
  /** The most recent entries that have a photo attached, newest first: the photo timeline. */
  listWithPhotos(limit: number): HabitLog[];
  /**
   * Every entry that has a photo, newest first and unbounded.
   *
   * The diary is a history the user reads through, so it is not capped the way the habits view's
   * timeline is — a limit on a diary would silently hide the past, and the page would claim to be
   * showing a history it had truncated. Ordering is `date DESC, id DESC`, which is a total order:
   * a day that was re-photographed keeps the later entry first.
   */
  listDiary(): HabitLog[];
};

/**
 * `private_log`: doom-scrolling and masturbation entries.
 *
 * ## Why this is its own repository
 *
 * A private entry is a fact the user chose to record about their own behaviour, and the PRD
 * prohibits showing it as a streak, a score, or a bar. The cheapest way to keep that promise is
 * structural: private rows are reachable through exactly one repository, which one feature module
 * owns, and no other repository can return them. A Dashboard that wanted a private entry would have
 * to call this, and the eslint boundary for that feature is what stops it.
 *
 * Nothing here aggregates. There is no count, no total, and no grouping — the only read is a
 * bounded list of entries for display, because a count of these entries is a tally of them.
 */
export type PrivateLogRepository = {
  /** The entry for a day and type, or `null`. */
  findForDay(date: CalendarDate, type: PrivateType): PrivateLogEntry | null;
  /** Writes one entry, replacing that day and type's entry. */
  insertEntry(entry: PrivateLogEntry): PersistenceResult<PrivateLogEntry>;
  /**
   * Removes one day's entry for one type.
   *
   * Used only by a "no" answer. A private log has no use for a row that records an absence — the
   * row would be an entry, and entries are what a reader sees — so removing it is the whole of
   * the correction, and it is the only path that can shrink this table.
   */
  removeForDay(date: CalendarDate, type: PrivateType): PersistenceResult<void>;
  /** The most recent entries, newest first. A list for reading, never a number. */
  listRecent(limit: number): PrivateLogEntry[];
};

/**
 * Read-only queries the pages need to display persisted state.
 *
 * Kept separate from the command surface above, and for a real reason: those six methods
 * exist because a command needs them to write correctly, and they are exercised by the
 * executor. These exist because a human needs to see what was written, and they are
 * exercised by rendering a page. Conflating them would invite a write query into a render
 * path, which is how a "read" endpoint ends up mutating state.
 *
 * `skill`, `skill_log`, and `private_log` are deliberately **absent**. Each has exactly one
 * reader — `SkillRepository` and `PrivateLogRepository` — owned by the feature that owns the
 * behaviour, which is the same single-reader rule ADR-050 applied to `plan_task`. A second read
 * here would be a second definition of what the swap list shows, or a second door to the private
 * log, and neither is worth the convenience.
 */
export type DisplayQueries = {
  /** Every tracked item, ordered by name. */
  listInventory(): InventoryItem[];
  /** Every account, in the PRD's own order. */
  listAccounts(): Account[];
  /** The most recent expenses, newest first, with the account name resolved. */
  recentExpenses(limit: number): RecentExpense[];
  /** Every expense on one UTC calendar day, newest first, for the daily bill's breakdown. */
  expensesForDate(date: string): RecentExpense[];
  /** Spend for one UTC calendar day, plus how many entries it came from. */
  spendForDate(date: string): { total: MinorUnits; count: number };
  /**
   * The most recent stock movements, newest first, with the item name resolved.
   *
   * Ordering is `timestamp DESC, id DESC` so two entries written in the same millisecond
   * still come back in the order they were inserted. Without the tie-break the order would
   * depend on SQLite's plan for the query, which is not a property to show a user.
   */
  recentInventoryEvents(limit: number): InventoryEventRow[];
};

/** An expense joined with the name of the account it was paid from. */
export type RecentExpense = {
  readonly timestamp: string;
  readonly item: string;
  readonly amount: MinorUnits;
  readonly accountId: number;
  readonly accountName: AccountName;
  readonly category: string | null;
};

export type Repositories = {
  readonly display: DisplayQueries;
  readonly inventory: InventoryRepository;
  readonly accounts: AccountRepository;
  readonly expenses: ExpenseRepository;
  readonly tasks: TaskRepository;
  readonly skills: SkillRepository;
  readonly habits: HabitRepository;
  /** Private entries are reachable only through here. See `PrivateLogRepository`. */
  readonly privateLog: PrivateLogRepository;
  readonly sleep: SleepRepository;
  readonly naps: NapRepository;
  /**
   * Runs `work` inside a single transaction, committing on return and rolling back on throw.
   *
   * This is the whole of the atomicity mechanism. There is no unit-of-work abstraction on top
   * of it, because the only caller that needs atomicity is the executor, and better-sqlite3's
   * synchronous transaction already has the right semantics.
   */
  transaction<T>(work: () => T): T;
};

type InventoryRow = {
  id: number;
  name: string;
  quantity: number;
  unit: string;
  low_threshold: number | null;
};

/**
 * A persisted `inventory_event`, joined with the item name so history can be displayed
 * without a second lookup per row.
 *
 * The id is included because correction has to address a specific entry. It is never rendered.
 */
export type InventoryEventRow = {
  readonly id: number;
  readonly itemId: number;
  readonly itemName: string;
  readonly delta: number;
  readonly timestamp: string;
  readonly sourceText: string | null;
};

type AccountRow = {
  id: number;
  name: string;
  balance: number;
};

function toInventoryItem(row: InventoryRow): InventoryItem {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    lowThreshold: row.low_threshold,
  };
}

function toAccount(row: AccountRow, requestedName: AccountName): Account {
  // The stored name wins, always. Using the *requested* name here would label every account
  // as whatever the caller asked for, and a request for an account that does not exist would
  // then match a real row and spend from the wrong balance. The schema's CHECK means the
  // stored name is always one of the three; the fallback exists only so an impossible row
  // still produces a usable value rather than an undefined.
  return {
    id: row.id,
    name: isAccountName(row.name) ? row.name : requestedName,
    balance: row.balance,
  };
}

/**
 * Builds the repository set over an open database.
 *
 * Takes the handle rather than opening one, so a test can hand it a temporary database and
 * the composition root can hand it the shared handle.
 */
export function createRepositories(database: DatabaseHandle): Repositories {
  const selectInventory = database.prepare(
    "SELECT id, name, quantity, unit, low_threshold FROM inventory_item",
  );
  const selectAccounts = database.prepare(
    "SELECT id, name, balance FROM account",
  );
  const updateQuantity = database.prepare(
    "UPDATE inventory_item SET quantity = ? WHERE id = ?",
  );
  const insertEvent = database.prepare(
    "INSERT INTO inventory_event (item, delta, timestamp, source_text) VALUES (?, ?, ?, ?)",
  );
  const insertItemRow = database.prepare(
    "INSERT INTO inventory_item (id, name, quantity, unit, low_threshold) VALUES (?, ?, ?, ?, ?)",
  );
  const updateDetails = database.prepare(
    "UPDATE inventory_item SET name = ?, unit = ? WHERE id = ?",
  );
  const updateThreshold = database.prepare(
    "UPDATE inventory_item SET low_threshold = ? WHERE id = ?",
  );
  const selectNextId = database.prepare(
    "SELECT COALESCE(MAX(id), 0) + 1 AS next FROM inventory_item",
  );
  const selectEventById = database.prepare(
    `SELECT e.id, e.item AS item_id, e.delta, e.timestamp, e.source_text, i.name AS item_name
     FROM inventory_event e
     JOIN inventory_item i ON i.id = e.item
     WHERE e.id = ?`,
  );
  const updateBalance = database.prepare(
    "UPDATE account SET balance = ? WHERE id = ?",
  );
  const insertExpense = database.prepare(
    "INSERT INTO expense (timestamp, item, amount, account, category) VALUES (?, ?, ?, ?, ?)",
  );

  const nextTaskIdRows = database.prepare(
    "SELECT COALESCE(MAX(id), 0) + 1 AS next FROM plan_task",
  );
  const taskByDateAndTitleRows = database.prepare(
    "SELECT id, date, title, done FROM plan_task WHERE date = ? AND title = ?",
  );
  const tasksForDateListRows = database.prepare(
    "SELECT id, date, title, done FROM plan_task WHERE date = ? ORDER BY id",
  );
  const insertTaskRows = database.prepare(
    "INSERT INTO plan_task (id, date, title, done) VALUES (?, ?, ?, 0)",
  );
  const saveTaskDoneRows = database.prepare(
    "UPDATE plan_task SET done = ? WHERE id = ?",
  );
  const deleteUndoneRows = database.prepare(
    "DELETE FROM plan_task WHERE date = ? AND done = 0",
  );
  const findNightRows = database.prepare(
    "SELECT date, bedtime, sleep_time, wake_time, phone_outside FROM sleep_log WHERE date = ?",
  );
  const ensureNightRows = database.prepare(
    "INSERT OR IGNORE INTO sleep_log (date) VALUES (?)",
  );
  const saveNightTimeRows = database.prepare(
    "UPDATE sleep_log SET bedtime = ? WHERE date = ?",
  );
  const saveSleepTimeRows = database.prepare(
    "UPDATE sleep_log SET sleep_time = ? WHERE date = ?",
  );
  const saveWakeTimeRows = database.prepare(
    "UPDATE sleep_log SET wake_time = ? WHERE date = ?",
  );
  const savePhoneOutsideRows = database.prepare(
    "UPDATE sleep_log SET phone_outside = ? WHERE date = ?",
  );
  const listNightsRows = database.prepare(
    "SELECT date, bedtime, sleep_time, wake_time, phone_outside FROM sleep_log ORDER BY date DESC LIMIT ?",
  );
  const insertNapRows = database.prepare(
    "INSERT INTO nap_log (date, start) VALUES (?, ?)",
  );
  const saveNapEndRows = database.prepare(
    "UPDATE nap_log SET end = ? WHERE id = ?",
  );
  const lastNapRows = database.prepare(
    "SELECT id, date, start, end FROM nap_log WHERE date = ? ORDER BY id DESC LIMIT 1",
  );
  const selectSkills = database.prepare(
    "SELECT id, name, active FROM skill ORDER BY id",
  );
  const selectSkillById = database.prepare(
    "SELECT id, name, active FROM skill WHERE id = ?",
  );
  const nextSkillId = database.prepare(
    "SELECT COALESCE(MAX(id), 0) + 1 AS next FROM skill",
  );
  const insertSkillRow = database.prepare(
    "INSERT INTO skill (id, name, active) VALUES (?, ?, 1)",
  );
  const insertSkillLogRow = database.prepare(
    "INSERT INTO skill_log (skill, timestamp, minutes) VALUES (?, ?, ?)",
  );
  const selectSkillLogs = database.prepare(
    `SELECT l.id, l.skill, l.timestamp, l.minutes, s.name AS skill_name
     FROM skill_log l
     JOIN skill s ON s.id = l.skill
     ORDER BY l.timestamp DESC, l.id DESC
     LIMIT ?`,
  );
  const selectHabitsForDate = database.prepare(
    `SELECT ${HABIT_COLUMNS}
     FROM habit_log WHERE date = ? ORDER BY id`,
  );
  const selectHabitsBetween = database.prepare(
    `SELECT ${HABIT_COLUMNS}
     FROM habit_log WHERE date BETWEEN ? AND ? ORDER BY date, id`,
  );
  const selectHabitsWithPhotos = database.prepare(
    `SELECT ${HABIT_COLUMNS}
     FROM habit_log
     WHERE photo_url IS NOT NULL
     ORDER BY date DESC, id DESC
     LIMIT ?`,
  );
  const selectDiaryEntries = database.prepare(
    `SELECT ${HABIT_COLUMNS}
     FROM habit_log
     WHERE photo_url IS NOT NULL
     ORDER BY date DESC, id DESC`,
  );
  const selectHabitById = database.prepare(
    `SELECT ${HABIT_COLUMNS} FROM habit_log WHERE id = ?`,
  );
  const selectHabitForDay = database.prepare(
    `SELECT ${HABIT_COLUMNS}
     FROM habit_log WHERE date = ? AND type = ?`,
  );
  const insertHabitRow = database.prepare(
    `INSERT INTO habit_log (date, type, done, photo_url, photo_note, minutes)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const attachHabitPhotoRow = database.prepare(
    `UPDATE habit_log SET photo_url = ?
     WHERE date = ? AND type = ?
     RETURNING ${HABIT_COLUMNS}`,
  );
  const saveDiaryNoteRow = database.prepare(
    `UPDATE habit_log SET photo_note = ? WHERE id = ? RETURNING ${HABIT_COLUMNS}`,
  );
  const updateHabitForDayRow = database.prepare(
    `UPDATE habit_log SET done = ?, photo_url = ?, photo_note = ?, minutes = ?
     WHERE date = ? AND type = ?
     RETURNING ${HABIT_COLUMNS}`,
  );
  const selectPrivateForDay = database.prepare(
    "SELECT id, date, type, note FROM private_log WHERE date = ? AND type = ?",
  );
  const deletePrivateForDay = database.prepare(
    "DELETE FROM private_log WHERE date = ? AND type = ?",
  );
  const insertPrivateRow = database.prepare(
    "INSERT INTO private_log (date, type, note) VALUES (?, ?, ?)",
  );
  const selectPrivateRecent = database.prepare(
    "SELECT id, date, type, note FROM private_log ORDER BY date DESC, id DESC LIMIT ?",
  );
  const listNapsRows = database.prepare(
    "SELECT id, date, start, end FROM nap_log WHERE date = ? ORDER BY id",
  );

  return {
    tasks: {
      nextTaskId() {
        return (nextTaskIdRows.get() as { next: number }).next;
      },

      findByDateAndTitle(date, title) {
        const row = taskByDateAndTitleRows.get(date, title) as
          TaskRow | undefined;

        if (row === undefined) {
          return {
            ok: false,
            error: {
              code: "unknown_task",
              message: `No task named "${title}" is planned for ${date}.`,
              detail: { title, date },
            },
          };
        }

        return { ok: true, value: toTask(row) };
      },

      listForDate(date) {
        return toTasks(tasksForDateListRows.all(date) as TaskRow[]);
      },

      insertTask(task) {
        try {
          const { next } = nextTaskIdRows.get() as { next: number };

          insertTaskRows.run(next, task.date, task.title);

          return { ok: true, value: next };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      saveTaskDone(id, done) {
        try {
          saveTaskDoneRows.run(done ? 1 : 0, id);

          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      deleteUndoneForDate(date) {
        try {
          deleteUndoneRows.run(date);

          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },
    },

    sleep: {
      findNight(date) {
        const row = findNightRows.get(date) as NightRow | undefined;

        return row === undefined ? null : toNight(row);
      },

      ensureNight(date) {
        try {
          ensureNightRows.run(date);

          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      // One field per statement, so a recorded bedtime can never overwrite a recorded wake
      // time and no caller has to remember to preserve the other two columns.
      saveNightTime(date, field, time) {
        try {
          const statement =
            field === "bedtime"
              ? saveNightTimeRows
              : field === "sleep_time"
                ? saveSleepTimeRows
                : saveWakeTimeRows;

          statement.run(time, date);

          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      savePhoneOutside(date, outside) {
        try {
          savePhoneOutsideRows.run(outside ? 1 : 0, date);

          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      listNights(limit) {
        return (listNightsRows.all(limit) as NightRow[]).map(toNight);
      },
    },

    naps: {
      insertNap(date, start) {
        try {
          const result = insertNapRows.run(date, start);

          return { ok: true, value: Number(result.lastInsertRowid) };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      saveNapEnd(id, end) {
        try {
          saveNapEndRows.run(end, id);

          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      lastNapForDate(date) {
        const row = lastNapRows.get(date) as NapRow | undefined;

        return row === undefined ? null : toNap(row);
      },

      listNapsForDate(date) {
        return (listNapsRows.all(date) as NapRow[]).map(toNap);
      },
    },

    skills: {
      listAll() {
        return (selectSkills.all() as SkillRow[]).map(toSkill);
      },

      findByName(name) {
        // The domain owns what counts as the same name; this only supplies the candidates.
        return findSkill((selectSkills.all() as SkillRow[]).map(toSkill), name);
      },

      insert(name) {
        try {
          const { next } = nextSkillId.get() as { next: number };

          insertSkillRow.run(next, name);

          const row = selectSkillById.get(next) as SkillRow | undefined;

          if (row === undefined) {
            throw new Error(
              "the skill row disappeared immediately after insertion",
            );
          }

          return { ok: true, value: toSkill(row) };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      appendLog(skillId, timestamp, minutes) {
        try {
          const result = insertSkillLogRow.run(skillId, timestamp, minutes);

          return {
            ok: true,
            value: {
              id: Number(result.lastInsertRowid),
              skillId,
              timestamp,
              minutes,
            },
          };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      recentLogs(limit) {
        return (selectSkillLogs.all(limit) as SkillLogRow[]).map((row) => ({
          id: row.id,
          skillId: row.skill,
          timestamp: row.timestamp,
          minutes: row.minutes,
        }));
      },
    },

    habits: {
      findForDay(date, type) {
        const row = selectHabitForDay.get(date, type) as
          HabitLogRow | undefined;

        return row === undefined ? null : toHabitLog(row);
      },

      insertHabit(habit) {
        try {
          const result = insertHabitRow.run(
            habit.date,
            habit.type,
            habit.done ? 1 : 0,
            habit.photoUrl,
            habit.photoNote,
            habit.minutes,
          );

          return {
            ok: true,
            value: { ...habit, id: Number(result.lastInsertRowid) },
          };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      updateHabitForDay(date, type, change) {
        try {
          const row = updateHabitForDayRow.get(
            change.done ? 1 : 0,
            change.photoUrl,
            change.photoNote,
            change.minutes,
            date,
            type,
          ) as HabitLogRow | undefined;

          if (row === undefined) {
            return {
              ok: false,
              error: {
                code: "persistence_failed",
                message: `No ${type} entry exists for ${date}, so there was nothing to update.`,
              },
            };
          }

          return { ok: true, value: toHabitLog(row) };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      attachPhoto(date, type, photoUrl) {
        try {
          const row = attachHabitPhotoRow.get(photoUrl, date, type) as
            HabitLogRow | undefined;

          if (row === undefined) {
            // Reported as a persistence failure rather than a domain one: the row this statement
            // requires was written by the statement immediately before it in the same
            // transaction, so its absence means the write failed, not that the user asked for
            // something that does not exist.
            return {
              ok: false,
              error: {
                code: "persistence_failed",
                message: `No ${type} row exists for ${date}, so the photo was not attached.`,
              },
            };
          }

          return { ok: true, value: toHabitLog(row) };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      findById(id) {
        const row = selectHabitById.get(id) as HabitLogRow | undefined;

        return row === undefined ? null : toHabitLog(row);
      },

      saveDiaryNote(id, note) {
        try {
          const row = saveDiaryNoteRow.get(note, id) as HabitLogRow | undefined;

          if (row === undefined) {
            // Reported as a persistence failure, like `attachPhoto`: this row was read by the
            // caller immediately before, so its absence means the write failed rather than that
            // the user asked about something that does not exist.
            return {
              ok: false,
              error: {
                code: "persistence_failed",
                message: `No entry with id ${id} exists, so the note was not written.`,
              },
            };
          }

          return { ok: true, value: toHabitLog(row) };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      listForDate(date) {
        return (selectHabitsForDate.all(date) as HabitLogRow[]).map(toHabitLog);
      },

      listBetween(from, to) {
        return (selectHabitsBetween.all(from, to) as HabitLogRow[]).map(
          toHabitLog,
        );
      },

      listWithPhotos(limit) {
        return (selectHabitsWithPhotos.all(limit) as HabitLogRow[]).map(
          toHabitLog,
        );
      },

      listDiary() {
        return (selectDiaryEntries.all() as HabitLogRow[]).map(toHabitLog);
      },
    },

    privateLog: {
      findForDay(date, type) {
        const row = selectPrivateForDay.get(date, type) as
          PrivateLogRow | undefined;

        return row === undefined ? null : toPrivateLog(row);
      },

      insertEntry(entry) {
        try {
          database.transaction(() => {
            deletePrivateForDay.run(entry.date, entry.type);
            insertPrivateRow.run(entry.date, entry.type, entry.note);
          })();

          return {
            ok: true,
            value: { ...entry, id: lastInsertedId(database) },
          };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      removeForDay(date, type) {
        try {
          deletePrivateForDay.run(date, type);

          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },

      listRecent(limit) {
        return (selectPrivateRecent.all(limit) as PrivateLogRow[]).map(
          toPrivateLog,
        );
      },
    },

    display: buildDisplayQueries(database),

    inventory: {
      findByName(name) {
        // The domain owns what counts as the same name; this only supplies the candidates.
        return findInventoryItem(
          (selectInventory.all() as InventoryRow[]).map(toInventoryItem),
          name,
        );
      },
      findById(id) {
        return findInventoryItemById(
          (selectInventory.all() as InventoryRow[]).map(toInventoryItem),
          id,
        );
      },
      saveQuantity(itemId, quantity) {
        try {
          updateQuantity.run(quantity, itemId);
          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },
      appendEvent(event) {
        try {
          insertEvent.run(
            event.itemId,
            event.delta,
            event.timestamp,
            event.sourceText,
          );
          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },
      nextItemId() {
        return (selectNextId.get() as { next: number }).next;
      },
      insertItem(item, opening) {
        try {
          // The opening quantity is written as an event in the same transaction, so the item's
          // quantity is explainable from its log from the very first row onwards.
          database.transaction(() => {
            insertItemRow.run(
              item.id,
              item.name,
              item.quantity,
              item.unit,
              item.lowThreshold,
            );

            if (item.quantity !== 0) {
              insertEvent.run(
                item.id,
                item.quantity,
                opening.timestamp,
                opening.sourceText,
              );
            }
          })();

          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },
      saveDetails(item) {
        try {
          // The schema's UNIQUE on `name` is what stops two items collapsing into one when a
          // rename collides, and it is a constraint rather than a check here on purpose: the
          // storage engine is the only place that can decide it atomically.
          updateDetails.run(item.name, item.unit, item.id);
          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },
      saveLowThreshold(item) {
        try {
          updateThreshold.run(item.lowThreshold, item.id);
          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },
      findEvent(eventId) {
        type JoinedEventRow = {
          id: number;
          item_id: number;
          delta: number;
          timestamp: string;
          source_text: string | null;
          item_name: string;
        };

        const row = selectEventById.get(eventId) as JoinedEventRow | undefined;

        return row === undefined
          ? null
          : {
              id: row.id,
              itemId: row.item_id,
              itemName: row.item_name,
              delta: row.delta,
              timestamp: row.timestamp,
              sourceText: row.source_text,
            };
      },
    },

    accounts: {
      findByName(name) {
        const rows = (selectAccounts.all() as AccountRow[]).map((row) =>
          toAccount(row, name),
        );

        return findAccount(rows, name);
      },
      saveBalance(accountId, balance) {
        try {
          updateBalance.run(balance, accountId);
          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },
    },

    expenses: {
      insert(draft) {
        try {
          insertExpense.run(
            draft.timestamp,
            draft.item,
            draft.amount,
            draft.accountId,
            draft.category,
          );
          return { ok: true, value: undefined };
        } catch (cause) {
          return { ok: false, error: persisted(cause) };
        }
      },
    },

    transaction(work) {
      return database.transaction(work)();
    },
  };
}

// ---------------------------------------------------------------------------
// Display queries
// ---------------------------------------------------------------------------

const EXPENSE_ACCOUNT_ORDER =
  "CASE name WHEN 'cash' THEN 0 WHEN 'bank1' THEN 1 ELSE 2 END";

type DisplayDatabase = {
  prepare: DatabaseHandle["prepare"];
};

/**
 * An `expense` row joined with the name of the account it was paid from.
 *
 * The join exists so history and the daily bill both show a payment method without a second
 * lookup per row. The internal account id travels with it because the row is an internal value;
 * no view renders it.
 */
type JoinedExpenseRow = {
  timestamp: string;
  item: string;
  amount: number;
  account: number;
  category: string | null;
  account_name: string;
};

/**
 * One joined row, as `RecentExpense`.
 *
 * `account_name` comes from the stored row and is checked against the closed set. A stored name
 * that is somehow not one of the three cannot happen while the schema's CHECK holds, and the
 * fallback keeps an impossible row from producing `undefined` in a money field.
 */
function toRecentExpense(row: JoinedExpenseRow): RecentExpense {
  return {
    timestamp: row.timestamp,
    item: row.item,
    amount: row.amount,
    accountId: row.account,
    accountName: isAccountName(row.account_name) ? row.account_name : "cash",
    category: row.category,
  };
}

/** One `plan_task` row. */
type TaskRow = {
  id: number;
  date: string;
  title: string;
  done: number;
};

/** One `sleep_log` row. */
type NightRow = {
  date: string;
  bedtime: string | null;
  sleep_time: string | null;
  wake_time: string | null;
  phone_outside: number;
};

/** One `nap_log` row. */
type NapRow = {
  id: number;
  date: string;
  start: string;
  end: string | null;
};

function toTask(row: TaskRow): PlanTask {
  return { id: row.id, date: row.date, title: row.title, done: row.done === 1 };
}

function toTasks(rows: readonly TaskRow[]): PlanTask[] {
  return rows.map(toTask);
}

function toNight(row: NightRow): SleepLog {
  return {
    date: row.date,
    bedtime: row.bedtime,
    sleepTime: row.sleep_time,
    wakeTime: row.wake_time,
    phoneOutside: row.phone_outside === 1,
  };
}

function toNap(row: NapRow): NapLog {
  return { id: row.id, date: row.date, start: row.start, end: row.end };
}

/** One `skill` row. */
type SkillRow = {
  id: number;
  name: string;
  active: number;
};

/** One `skill_log` row, joined to its skill. Only the ids and the stated facts are read. */
type SkillLogRow = {
  id: number;
  skill: number;
  timestamp: string;
  minutes: number | null;
};

/** One `habit_log` row. */
type HabitLogRow = {
  id: number;
  date: string;
  type: string;
  done: number;
  photo_url: string | null;
  /** Added by migration 003. */
  photo_note: string | null;
  minutes: number | null;
};

/** Every `habit_log` column, in one string, so no statement can forget the new one. */
const HABIT_COLUMNS = "id, date, type, done, photo_url, photo_note, minutes";

/** One `private_log` row. */
type PrivateLogRow = {
  id: number;
  date: string;
  type: string;
  note: string | null;
};

function toSkill(row: SkillRow): Skill {
  return { id: row.id, name: row.name, active: row.active === 1 };
}

function toHabitLog(row: HabitLogRow): HabitLog {
  // A row whose type the domain does not recognise is refused rather than coerced. The schema's
  // CHECK is the reason it cannot happen today; inventing a habit the user never logged would be
  // worse than omitting one if it ever did.
  if (!isLoggableHabitType(row.type)) {
    throw new Error(`habit_log holds an unknown type: ${row.type}`);
  }

  return {
    id: row.id,
    date: row.date,
    type: row.type,
    done: row.done === 1,
    photoUrl: row.photo_url,
    // Read rather than defaulted, and an empty string becomes `null` because "no note" has one
    // representation in this application. `diaryNote` never stores an empty string, so this is a
    // belt-and-braces normalisation for a row written by hand.
    photoNote: row.photo_note === "" ? null : row.photo_note,
    minutes: row.minutes,
  };
}

function toPrivateLog(row: PrivateLogRow): PrivateLogEntry {
  if (row.type !== "doom_scrolling" && row.type !== "masturbation") {
    throw new Error(`private_log holds an unknown type: ${row.type}`);
  }

  return { id: row.id, date: row.date, type: row.type, note: row.note };
}

/** The id of the row just inserted on this connection. */
function lastInsertedId(database: DatabaseHandle): number {
  const row = database.prepare("SELECT last_insert_rowid() AS id").get() as {
    id: number;
  };

  return Number(row.id);
}

function buildDisplayQueries(database: DisplayDatabase): DisplayQueries {
  const listInventoryRows = database.prepare(
    "SELECT id, name, quantity, unit, low_threshold FROM inventory_item ORDER BY name COLLATE NOCASE",
  );
  const listAccountRows = database.prepare(
    `SELECT id, name, balance FROM account ORDER BY ${EXPENSE_ACCOUNT_ORDER}`,
  );
  const recentExpenseRows = database.prepare(
    `SELECT e.timestamp, e.item, e.amount, e.account, e.category, a.name AS account_name
     FROM expense e
     JOIN account a ON a.id = e.account
     ORDER BY e.timestamp DESC, e.id DESC
     LIMIT ?`,
  );
  const spendForDateRows = database.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expense WHERE substr(timestamp, 1, 10) = ?",
  );
  const expensesForDateRows = database.prepare(
    `SELECT e.timestamp, e.item, e.amount, e.account, e.category, a.name AS account_name
     FROM expense e
     JOIN account a ON a.id = e.account
     WHERE substr(e.timestamp, 1, 10) = ?
     ORDER BY e.timestamp DESC, e.id DESC`,
  );
  const recentEventRows = database.prepare(
    `SELECT e.id, e.item AS item_id, e.delta, e.timestamp, e.source_text, i.name AS item_name
     FROM inventory_event e
     JOIN inventory_item i ON i.id = e.item
     ORDER BY e.timestamp DESC, e.id DESC
     LIMIT ?`,
  );

  return {
    listInventory() {
      return (listInventoryRows.all() as InventoryRow[]).map(toInventoryItem);
    },

    listAccounts() {
      const rows = listAccountRows.all() as AccountRow[];

      return rows.map((row) => ({
        id: row.id,
        name: isAccountName(row.name) ? row.name : "cash",
        balance: row.balance,
      }));
    },

    recentExpenses(limit) {
      return (recentExpenseRows.all(limit) as JoinedExpenseRow[]).map(
        toRecentExpense,
      );
    },

    expensesForDate(date) {
      return (expensesForDateRows.all(date) as JoinedExpenseRow[]).map(
        toRecentExpense,
      );
    },

    spendForDate(date) {
      const row = spendForDateRows.get(date) as {
        total: number;
        count: number;
      };

      return { total: row.total, count: row.count };
    },

    recentInventoryEvents(limit) {
      type JoinedEventRow = {
        id: number;
        item_id: number;
        delta: number;
        timestamp: string;
        source_text: string | null;
        item_name: string;
      };

      return (recentEventRows.all(limit) as JoinedEventRow[]).map((row) => ({
        id: row.id,
        itemId: row.item_id,
        itemName: row.item_name,
        delta: row.delta,
        timestamp: row.timestamp,
        sourceText: row.source_text,
      }));
    },
  };
}
