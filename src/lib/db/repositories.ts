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
import { isHabitType, type HabitType } from "../../domain/habits.ts";
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

function persisted(cause: unknown): PersistenceError {
  return {
    code: "persistence_failed",
    message: cause instanceof Error ? cause.message : String(cause),
  };
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
 * Read-only queries the pages need to display persisted state.
 *
 * Kept separate from the command surface above, and for a real reason: those six methods
 * exist because a command needs them to write correctly, and they are exercised by the
 * executor. These exist because a human needs to see what was written, and they are
 * exercised by rendering a page. Conflating them would invite a write query into a render
 * path, which is how a "read" endpoint ends up mutating state.
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
  /** The plan for one calendar day, for the dashboard. Read-only; nothing creates these yet. */
  tasksForDate(date: string): PlanTask[];
  /**
   * The habit entries recorded on one calendar day.
   *
   * Read-only and additive: `habit_log` has existed since micro-phase 1.1, so reading it is not a
   * new capability, and nothing in `src/` writes to it. Rows whose `type` is outside the closed
   * set are dropped rather than coerced — the schema's CHECK makes that impossible while it holds,
   * and inventing a habit the user never logged is worse than omitting one.
   */
  habitsForDate(date: string): HabitEntry[];
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

/** A single day's plan task, read-only. */
export type PlanTask = {
  readonly id: number;
  readonly title: string;
  readonly done: boolean;
};

/** One `habit_log` row, read-only, with the photo reduced to whether one is attached. */
export type HabitEntry = {
  readonly type: HabitType;
  readonly done: boolean;
  /** `photo_url IS NOT NULL`. The path itself is never read: nothing renders or serves it in V1. */
  readonly hasPhoto: boolean;
};

export type Repositories = {
  readonly display: DisplayQueries;
  readonly inventory: InventoryRepository;
  readonly accounts: AccountRepository;
  readonly expenses: ExpenseRepository;
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

  return {
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
  const tasksForDateRows = database.prepare(
    "SELECT id, title, done FROM plan_task WHERE date = ? ORDER BY id",
  );
  const habitsForDateRows = database.prepare(
    "SELECT type, done, photo_url FROM habit_log WHERE date = ? ORDER BY id",
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

    tasksForDate(date) {
      return (
        tasksForDateRows.all(date) as (Omit<PlanTask, "done"> & {
          done: number;
        })[]
      ).map((row) => ({ id: row.id, title: row.title, done: row.done === 1 }));
    },

    habitsForDate(date) {
      return (
        habitsForDateRows.all(date) as {
          type: string;
          done: number;
          photo_url: string | null;
        }[]
      )
        .filter((row) => isHabitType(row.type))
        .map((row) => ({
          type: row.type as HabitType,
          done: row.done === 1,
          hasPhoto: row.photo_url !== null,
        }));
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
