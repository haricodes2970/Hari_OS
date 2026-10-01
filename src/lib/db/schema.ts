import "server-only";

/**
 * The canonical V1 schema, declared independently of the migration SQL.
 *
 * `db:check` compares the live database against this list, so a mistake in a migration is
 * caught rather than assumed correct. Keeping the expectation separate from the SQL that
 * creates it means a broken migration cannot silently agree with itself.
 */
export const EXPECTED_TABLES: Record<string, readonly string[]> = {
  plan_task: ["id", "date", "title", "done"],
  sleep_log: [
    "id",
    "date",
    "bedtime",
    "sleep_time",
    "wake_time",
    "phone_outside",
  ],
  nap_log: ["id", "date", "start", "end"],
  inventory_item: ["id", "name", "quantity", "unit", "low_threshold"],
  inventory_event: ["id", "item", "delta", "timestamp", "source_text"],
  account: ["id", "name", "balance"],
  expense: ["id", "timestamp", "item", "amount", "account", "category"],
  skill: ["id", "name", "active"],
  skill_log: ["id", "skill", "timestamp", "minutes"],
  habit_log: ["id", "date", "type", "done", "photo_url", "minutes"],
  private_log: ["id", "date", "type", "note"],
};

/** Tables owned by the migration mechanism itself, not by the product. */
export const INFRASTRUCTURE_TABLES: readonly string[] = ["schema_migrations"];

/**
 * Structural constraints that must be present, described as substrings matched against the
 * table's CREATE statement. Deliberately checks the *shape* of the constraint rather than
 * re-deriving it, so the check stays readable.
 */
export const EXPECTED_CONSTRAINTS: Record<string, readonly string[]> = {
  plan_task: ["UNIQUE (date, title)", "typeof(done) = 'integer'"],
  sleep_log: ["date TEXT NOT NULL UNIQUE"],
  inventory_item: [
    "name TEXT NOT NULL UNIQUE",
    "typeof(quantity) IN ('integer', 'real')",
    "quantity >= 0",
  ],
  inventory_event: [
    "item INTEGER NOT NULL REFERENCES inventory_item(id)",
    "typeof(delta) IN ('integer', 'real')",
  ],
  account: [
    "name TEXT NOT NULL UNIQUE CHECK (name IN ('cash', 'bank1', 'bank2'))",
    "typeof(balance) = 'integer'",
  ],
  expense: [
    "typeof(amount) = 'integer'",
    "account INTEGER NOT NULL REFERENCES account(id)",
  ],
  skill: ["name TEXT NOT NULL UNIQUE", "typeof(active) = 'integer'"],
  skill_log: [
    "skill INTEGER NOT NULL REFERENCES skill(id)",
    "typeof(minutes) = 'integer'",
  ],
  habit_log: [
    // `screen_time` and `minutes` arrived with migration 002. See `SCREEN_TIME_MIGRATION` in
    // `migrations.ts` for why the table was rebuilt rather than altered.
    "type TEXT NOT NULL CHECK (type IN ('cooking', 'dishes', 'laundry', 'screen_time'))",
    "typeof(done) = 'integer'",
    "minutes INTEGER",
  ],
  private_log: [
    "type TEXT NOT NULL CHECK (type IN ('doom_scrolling', 'masturbation'))",
  ],
};

export const EXPECTED_TABLE_NAMES: readonly string[] =
  Object.keys(EXPECTED_TABLES);
