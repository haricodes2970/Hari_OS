/**
 * Domain tests for the deterministic rules in `src/domain`.
 *
 * Run with `npm run domain:test`. Entirely in memory: no database, no filesystem, no
 * network, no clock. Every timestamp and id is supplied by the test, which is the point —
 * if these tests ever needed a real clock or a real database, the domain would have stopped
 * being pure.
 *
 * The suite deliberately spends most of its effort on the cases that should NOT work. A
 * deterministic rule that quietly accepts a bad number is worse than one that crashes,
 * because the wrong number looks exactly like the right one afterwards.
 */
import {
  adjustInventory,
  applyInventoryEvent,
  checkInventoryUnit,
  consumeInventory,
  createInventoryItem,
  editInventoryDetails,
  findInventoryItem,
  findInventoryItemById,
  isLowStock,
  recountAfterUse,
  replaceInventoryItem,
  restockInventory,
  reverseInventoryChange,
  reverseInventoryEvent,
  setInventoryQuantity,
  setLowStockThreshold,
  stampInventoryChange,
} from "../src/domain/inventory.ts";
import {
  ACCOUNT_NAMES,
  applyExpense,
  createAccount,
  findAccount,
  replaceAccount,
  setAccountBalance,
} from "../src/domain/accounts.ts";
import {
  MINOR_UNITS_PER_RUPEE,
  addMinorUnits,
  isBalance,
  isMoneyAmount,
  toMinorUnits,
} from "../src/domain/money.ts";
import {
  addQuantities,
  isQuantity,
  parseQuantity,
  subtractQuantities,
} from "../src/domain/quantity.ts";
import {
  MAX_SKILLS,
  MAX_SKILL_MINUTES,
  createSkill,
  findSkill,
  logSkillUse,
  remainingSkillSlots,
  swapList,
  tallyFor,
} from "../src/domain/skills.ts";
import {
  MAX_SCREEN_TIME_MINUTES,
  habitStreak,
  isLoggableHabitType,
  isPrivateType,
  laundryProgress,
  privateTypeLabel,
  recordHabit,
  recordPrivateEntry,
} from "../src/domain/habits.ts";
import {
  MAX_DIARY_NOTE,
  byNewestFirst,
  diaryNote,
  hasDiaryNote,
} from "../src/domain/diary.ts";

let passed = 0;
let failed = 0;

function ok(message) {
  passed += 1;
  console.log(`ok    ${message}`);
}

function bad(message) {
  failed += 1;
  console.error(`FAIL  ${message}`);
}

function assert(condition, message) {
  if (condition) {
    ok(message);
  } else {
    bad(message);
  }
}

function assertEqual(actual, expected, message) {
  const same = Object.is(actual, expected);

  if (same) {
    ok(message);
  } else {
    bad(
      `${message} (expected ${String(expected)}, received ${String(actual)})`,
    );
  }
}

function assertDeepEqual(actual, expected, message) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);

  if (same) {
    ok(message);
  } else {
    bad(
      `${message} (expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)})`,
    );
  }
}

/** Asserts a Result succeeded, returning its value or recording a failure. */
function expectOk(result, message) {
  if (!result.ok) {
    bad(
      `${message} unexpectedly failed with ${result.error.code}: ${result.error.message}`,
    );
    return undefined;
  }

  ok(message);

  return result.value;
}

/** Asserts a Result failed with a specific code, which is the part callers switch on. */
function expectFail(result, code, message) {
  if (result.ok) {
    bad(
      `${message} unexpectedly succeeded with ${JSON.stringify(result.value)}`,
    );
    return;
  }

  if (result.error.code !== code) {
    bad(`${message} failed with ${result.error.code} instead of ${code}`);
    return;
  }

  ok(`${message} -> ${code}`);
}

const FIXED_TIMESTAMP = "2026-09-30T14:00:00.000Z";

function onions(overrides = {}) {
  const created = createInventoryItem({
    id: 1,
    name: "onions",
    quantity: 10,
    unit: "piece",
    ...overrides,
  });

  if (!created.ok) {
    throw new Error(`fixture is invalid: ${created.error.message}`);
  }

  return created.value;
}

function rice(overrides = {}) {
  const created = createInventoryItem({
    id: 2,
    name: "rice",
    quantity: 2.5,
    unit: "kg",
    ...overrides,
  });

  if (!created.ok) {
    throw new Error(`fixture is invalid: ${created.error.message}`);
  }

  return created.value;
}

function cashAccount(overrides = {}) {
  const created = createAccount({
    id: 1,
    name: "cash",
    balance: 50_000,
    ...overrides,
  });

  if (!created.ok) {
    throw new Error(`fixture is invalid: ${created.error.message}`);
  }

  return created.value;
}

// ---------------------------------------------------------------------------
console.log("\nQuantity rules");
// ---------------------------------------------------------------------------

assert(isQuantity(0), "zero is a valid quantity");
assert(isQuantity(10), "a whole count is a valid quantity");
assert(isQuantity(0.25), "a fractional weight is a valid quantity");
assert(!isQuantity(-1), "a negative quantity is invalid");
assert(!isQuantity(Number.NaN), "NaN is not a quantity");
assert(!isQuantity(Number.POSITIVE_INFINITY), "Infinity is not a quantity");
assert(
  !isQuantity(0.0000001),
  "a quantity finer than the scale is rejected rather than rounded",
);

expectFail(
  parseQuantity(-0.5),
  "invalid_quantity",
  "parseQuantity refuses a negative",
);
expectFail(
  parseQuantity(Number.NaN),
  "invalid_quantity",
  "parseQuantity refuses NaN",
);
assertEqual(
  expectOk(parseQuantity(0), "parseQuantity accepts zero"),
  0,
  "parseQuantity returns zero unchanged",
);

assertEqual(
  expectOk(subtractQuantities(10, 2), "10 - 2"),
  8,
  "the PRD example: ten onions less two is eight",
);
assertEqual(
  expectOk(subtractQuantities(10, 10), "using the exact quantity"),
  0,
  "consuming the exact quantity leaves zero",
);
expectFail(
  subtractQuantities(10, 11),
  "insufficient_inventory",
  "consuming more than available is refused",
);
expectFail(
  subtractQuantities(0, 1),
  "insufficient_inventory",
  "consuming from empty stock is refused",
);

// The floating-point trap this module exists to handle.
assertEqual(
  expectOk(addQuantities(0.1, 0.2), "0.1 + 0.2"),
  0.3,
  "0.1 + 0.2 is exactly 0.3, not 0.30000000000000004",
);
assertEqual(
  expectOk(addQuantities(0.3, 0.3), "0.3 + 0.3"),
  0.6,
  "fractional addition is rounded to the scale exactly once",
);
assertEqual(
  expectOk(subtractQuantities(0.3, 0.1), "0.3 - 0.1"),
  0.2,
  "fractional subtraction is exact",
);

// Applying an operation to its own output must change nothing.
const once = expectOk(
  addQuantities(0.1, 0.2),
  "0.1 + 0.2 for the idempotence check",
);
const twice = expectOk(addQuantities(once, 0), "adding zero to the result");
assertEqual(twice, once, "adding zero to a rounded result is a no-op");

// ---------------------------------------------------------------------------
console.log("\nMoney rules");
// ---------------------------------------------------------------------------

assert(isMoneyAmount(0), "zero is a valid expense amount");
assert(isMoneyAmount(1_000), "a whole number of minor units is valid");
assert(!isMoneyAmount(-1), "a negative expense amount is invalid");
assert(!isMoneyAmount(10.5), "a fractional minor-unit amount is invalid");
assert(!isMoneyAmount(Number.NaN), "NaN is not an amount");
assert(isBalance(-5_000), "a negative balance is valid");
assert(!isBalance(-0.5), "a fractional balance is invalid");

assertEqual(
  expectOk(toMinorUnits(10), "10 rupees"),
  1_000,
  "10 rupees is 1000 minor units",
);
assertEqual(
  expectOk(toMinorUnits(500), "500 rupees"),
  50_000,
  "500 rupees is 50000 minor units",
);
// The values that break naive multiplication.
assertEqual(
  expectOk(toMinorUnits(1.15), "1.15 rupees"),
  115,
  "1.15 rupees is 115, not 114 from 1.15 * 100",
);
assertEqual(
  expectOk(toMinorUnits(8.29), "8.29 rupees"),
  829,
  "8.29 rupees is 829, not 828",
);
assertEqual(
  expectOk(toMinorUnits(19.99), "19.99 rupees"),
  1_999,
  "19.99 rupees is 1999",
);
assertEqual(
  expectOk(toMinorUnits(0.05), "0.05 rupees"),
  5,
  "a single paisa survives",
);
expectFail(
  toMinorUnits(1.005),
  "invalid_money_precision",
  "a third decimal place is refused, not rounded",
);
expectFail(
  toMinorUnits(Number.NaN),
  "invalid_money",
  "NaN is refused as a rupee amount",
);
assertEqual(
  expectOk(toMinorUnits(490), "the PRD result, reverse direction"),
  49_000,
  "490 rupees is 49000 minor units, matching the PRD's 500 minus 10",
);
assertEqual(
  MINOR_UNITS_PER_RUPEE,
  100,
  "the scale is fixed at 100 minor units per rupee",
);

// The accumulation trap: 0.1 + 0.2 in floating point money.
let running = 0;
for (let i = 0; i < 10; i += 1) {
  running = expectOk(
    addMinorUnits(running, 100),
    `add 100 minor units, step ${i + 1}`,
  );
}
assertEqual(
  running,
  1_000,
  "ten additions of 100 minor units total exactly 1000",
);
expectFail(
  addMinorUnits(Number.MAX_SAFE_INTEGER, 1),
  "invalid_money",
  "an overflow past the exact integer range is refused",
);

// ---------------------------------------------------------------------------
console.log("\nInventory operations");
// ---------------------------------------------------------------------------

const ten = onions();
assertEqual(ten.unit, "piece", "a created item keeps its unit");
assertEqual(ten.lowThreshold, null, "a threshold defaults to none");

const used = expectOk(consumeInventory(ten, 2, "piece"), "using 2 onions");
assertEqual(used.before, 10, "the change records the quantity before");
assertEqual(used.after, 8, "the change records the quantity after");
assertEqual(
  used.delta,
  -2,
  "the change records a negative delta for consumption",
);

assertEqual(
  expectOk(consumeInventory(ten, 10, "piece"), "using all 10 onions").after,
  0,
  "using the exact quantity leaves zero, not an error",
);
expectFail(
  consumeInventory(ten, 11, "piece"),
  "insufficient_inventory",
  "using more than available is refused",
);
assertEqual(
  expectOk(consumeInventory(ten, 0, "piece"), "using zero onions").after,
  10,
  "using zero is valid and changes nothing",
);
expectFail(
  consumeInventory(ten, -2, "piece"),
  "invalid_quantity",
  "a negative consumption is refused instead of adding stock",
);

expectFail(
  consumeInventory(rice(), 1, "piece"),
  "invalid_unit",
  "consuming rice in pieces is refused",
);
expectFail(
  consumeInventory(rice(), 1, ""),
  "invalid_unit",
  "an empty unit is refused",
);
expectOk(checkInventoryUnit(rice(), "kg"), "kg matches rice");
expectFail(
  checkInventoryUnit(rice(), "KG"),
  "invalid_unit",
  "unit matching is case-sensitive",
);
expectFail(
  checkInventoryUnit(rice(), " g "),
  "invalid_unit",
  "a unit differing only by case is a different unit",
);

const restocked = expectOk(
  restockInventory(rice(), 0.5, "kg"),
  "restocking 0.5 kg of rice",
);
assertEqual(restocked.after, 3, "2.5 kg plus 0.5 kg is 3 kg");
assertEqual(restocked.delta, 0.5, "a restock records a positive delta");

const set = expectOk(setInventoryQuantity(ten, 4), "recounting to four");
assertEqual(set.after, 4, "a recount sets the absolute value");
assertEqual(
  set.delta,
  -6,
  "the recount derives the delta that explains the change",
);

expectFail(
  setInventoryQuantity(ten, -1),
  "invalid_quantity",
  "a recount to a negative is refused",
);
assertEqual(
  expectOk(setInventoryQuantity(ten, 10), "recounting to the same value").delta,
  0,
  "recounting to the current value yields a zero delta",
);

assertEqual(
  expectOk(adjustInventory(ten, -3), "a raw negative movement").after,
  7,
  "adjustInventory applies a signed delta",
);
expectFail(
  adjustInventory(ten, -11),
  "insufficient_inventory",
  "adjustInventory refuses a movement below zero",
);
expectFail(
  adjustInventory(ten, Number.NaN),
  "invalid_quantity",
  "a NaN movement is refused",
);

assertEqual(
  isLowStock(onions({ quantity: 2, lowThreshold: 2 })),
  true,
  "at the threshold is low stock",
);
assertEqual(
  isLowStock(onions({ quantity: 3, lowThreshold: 2 })),
  false,
  "above the threshold is not low",
);
assertEqual(
  isLowStock(onions({ quantity: 0, lowThreshold: 2 })),
  true,
  "empty stock is low stock",
);
assertEqual(
  isLowStock(onions({ quantity: 1 })),
  false,
  "no threshold means never low stock",
);

// ---------------------------------------------------------------------------
console.log("\nInventory creation and lookup");
// ---------------------------------------------------------------------------

expectFail(
  createInventoryItem({ id: 3, name: "  ", quantity: 1, unit: "piece" }),
  "unknown_item",
  "an item needs a name",
);
expectFail(
  createInventoryItem({ id: 3, name: "salt", quantity: 1, unit: "   " }),
  "invalid_unit",
  "an item needs a unit",
);
expectFail(
  createInventoryItem({ id: 3, name: "salt", quantity: -1, unit: "kg" }),
  "invalid_quantity",
  "a new item cannot start with negative stock",
);
expectFail(
  createInventoryItem({
    id: 3,
    name: "salt",
    quantity: 1,
    unit: "kg",
    lowThreshold: -1,
  }),
  "invalid_quantity",
  "a negative low-stock threshold is refused",
);
const trimmedName = expectOk(
  createInventoryItem({
    id: 3,
    name: "  salt  ",
    quantity: 1,
    unit: " piece ",
  }),
  "a new item accepts surrounding whitespace",
);
assertEqual(trimmedName.name, "salt", "a new item's name is trimmed");
assertEqual(trimmedName.unit, "piece", "a new item's unit is trimmed");

const shelf = [ten, rice()];
assertEqual(
  expectOk(findInventoryItem(shelf, "ONIONS"), "lookup is case-insensitive").id,
  1,
  "onions is found",
);
expectFail(
  findInventoryItem(shelf, "potato"),
  "unknown_item",
  "an unknown item is an explicit failure",
);
expectFail(
  findInventoryItem(shelf, ""),
  "unknown_item",
  "an empty name does not match anything",
);

// ---------------------------------------------------------------------------
console.log("\nCorrectability and event representation");
// ---------------------------------------------------------------------------

const consumed = expectOk(
  consumeInventory(ten, 2, "piece"),
  "consumption to reverse",
);
const stamped = stampInventoryChange(
  consumed,
  FIXED_TIMESTAMP,
  "used 2 onions",
);

assertDeepEqual(
  stamped.event,
  {
    itemId: 1,
    delta: -2,
    timestamp: FIXED_TIMESTAMP,
    sourceText: "used 2 onions",
  },
  "the stamped event matches the inventory_event columns",
);
assertEqual(
  stamped.event.delta,
  stamped.delta,
  "the event delta and the change delta agree",
);
assertEqual(
  stamped.before + stamped.delta,
  stamped.after,
  "before plus delta equals after",
);

const reversed = expectOk(
  reverseInventoryChange(consumed),
  "reversing the consumption",
);
assertEqual(reversed.delta, 2, "the reversal negates the original delta");
assertEqual(
  reversed.before,
  8,
  "the reversal starts from the quantity the original left",
);
assertEqual(
  reversed.after,
  10,
  "the reversal restores the original quantity exactly",
);

// Replaying the original then its reversal must be a no-op.
const replayedOnce = expectOk(
  adjustInventory(ten, consumed.delta),
  "replay the original event",
);
const replayedTwice = expectOk(
  adjustInventory({ ...ten, quantity: replayedOnce.after }, reversed.delta),
  "replay the compensating event",
);
assertEqual(
  replayedTwice.after,
  10,
  "an event and its reversal return the starting quantity",
);

assertEqual(
  stampInventoryChange(consumed, FIXED_TIMESTAMP).event.sourceText,
  null,
  "source text defaults to none rather than empty string",
);
assertEqual(
  stampInventoryChange(consumed, FIXED_TIMESTAMP).event.timestamp,
  FIXED_TIMESTAMP,
  "the caller supplies the timestamp; the domain never reads a clock",
);

expectFail(
  applyInventoryEvent(ten, {
    itemId: 99,
    delta: -1,
    timestamp: FIXED_TIMESTAMP,
    sourceText: null,
  }),
  "unknown_item",
  "an event for a different item is refused",
);

const appliedEvent = expectOk(
  applyInventoryEvent(ten, {
    itemId: 1,
    delta: -2,
    timestamp: FIXED_TIMESTAMP,
    sourceText: "used 2 onions",
  }),
  "replaying a valid event",
);
assertEqual(
  appliedEvent.after,
  8,
  "a replayed event produces the same result as the original",
);
assertDeepEqual(
  appliedEvent.event,
  {
    itemId: 1,
    delta: -2,
    timestamp: FIXED_TIMESTAMP,
    sourceText: "used 2 onions",
  },
  "replaying preserves the event's own timestamp and source text",
);
expectFail(
  applyInventoryEvent(ten, {
    itemId: 1,
    delta: -11,
    timestamp: FIXED_TIMESTAMP,
    sourceText: null,
  }),
  "insufficient_inventory",
  "replaying an impossible event is refused",
);

// ---------------------------------------------------------------------------
console.log("\nExpense and account operations");
// ---------------------------------------------------------------------------

const cash = cashAccount();
assertEqual(
  cash.balance,
  50_000,
  "an account opens at the balance the user gave",
);
assertDeepEqual(
  [...ACCOUNT_NAMES],
  ["cash", "bank1", "bank2"],
  "the three PRD accounts are the only names",
);
expectFail(
  createAccount({ id: 4, name: "wallet", balance: 0 }),
  "missing_account",
  "an account outside the PRD set is refused",
);
expectFail(
  createAccount({ id: 4, name: "cash", balance: 10.5 }),
  "invalid_money",
  "an account cannot open with a fractional balance",
);

const spend = expectOk(
  applyExpense(cash, {
    item: "banana",
    amount: expectOk(toMinorUnits(10), "the spend, in minor units"),
    accountId: 1,
    timestamp: FIXED_TIMESTAMP,
  }),
  "bought banana for 10 rupees on cash",
);
assertEqual(spend.before, 50_000, "the change records the balance before");
assertEqual(
  spend.after,
  49_000,
  "500 rupees minus 10 rupees is 490, exactly as the PRD states",
);
assertEqual(
  spend.delta,
  -1_000,
  "the change records a negative delta for a spend",
);
assertEqual(spend.expense.item, "banana", "the expense carries the item");
assertEqual(
  spend.expense.category,
  null,
  "category is optional and defaults to none",
);

// A zero spend is a real entry, not an error, and must not move the balance.
const zero = expectOk(
  applyExpense(cash, {
    item: "nothing",
    amount: 0,
    accountId: 1,
    timestamp: FIXED_TIMESTAMP,
  }),
  "a zero-amount spend",
);
assertEqual(zero.after, 50_000, "a zero spend leaves the balance unchanged");
assertEqual(zero.delta, 0, "a zero spend records a zero delta");

expectFail(
  applyExpense(cash, {
    item: "banana",
    amount: -100,
    accountId: 1,
    timestamp: FIXED_TIMESTAMP,
  }),
  "invalid_money",
  "a negative spend is refused",
);
expectFail(
  applyExpense(cash, {
    item: "banana",
    amount: 10.5,
    accountId: 1,
    timestamp: FIXED_TIMESTAMP,
  }),
  "invalid_money",
  "a fractional spend is refused",
);
expectFail(
  applyExpense(cash, {
    item: "  ",
    amount: 100,
    accountId: 1,
    timestamp: FIXED_TIMESTAMP,
  }),
  "invalid_money",
  "a spend needs an item",
);
expectFail(
  applyExpense(cash, {
    item: "banana",
    amount: 100,
    accountId: 2,
    timestamp: FIXED_TIMESTAMP,
  }),
  "missing_account",
  "a spend referencing a different account is refused",
);

// Documented behaviour: an overdraft is permitted, and the balance goes negative exactly.
const overdrawn = expectOk(
  applyExpense(
    { ...cash, balance: 500 },
    {
      item: "rent",
      amount: 1_000,
      accountId: 1,
      timestamp: FIXED_TIMESTAMP,
    },
  ),
  "spending more than the balance",
);
assertEqual(
  overdrawn.after,
  -500,
  "an overdraft is allowed and lands at exactly before minus amount",
);

const corrected = expectOk(
  setAccountBalance(cash, 60_000),
  "manually correcting a balance",
);
assertEqual(
  corrected.after,
  60_000,
  "a manual correction sets the balance outright",
);
assertEqual(
  corrected.delta,
  10_000,
  "a manual correction reports its own delta",
);
assertEqual(
  "expense" in corrected,
  false,
  "a manual correction carries no expense, because the schema has no row for one",
);

assertEqual(
  expectOk(findAccount([cash], "cash"), "finding cash by name").id,
  1,
  "cash is found",
);
expectFail(
  findAccount([cash], "wallet"),
  "missing_account",
  "an unknown account is an explicit failure",
);

// ---------------------------------------------------------------------------
console.log("\nDeterminism and purity");
// ---------------------------------------------------------------------------

// The domain must not mutate anything the caller still holds.
const snapshot = JSON.stringify({ ten, cash, shelf });
const replayA = expectOk(consumeInventory(ten, 2, "piece"), "first run");
const replayB = expectOk(consumeInventory(ten, 2, "piece"), "second run");
assertDeepEqual(
  replayA,
  replayB,
  "the same input produces the same change every time",
);
assertEqual(
  JSON.stringify({ ten, cash, shelf }),
  snapshot,
  "no operation mutated a caller-owned object",
);

const spendA = expectOk(
  applyExpense(cash, {
    item: "banana",
    amount: 1_000,
    accountId: 1,
    timestamp: FIXED_TIMESTAMP,
  }),
  "first spend",
);
const spendB = expectOk(
  applyExpense(cash, {
    item: "banana",
    amount: 1_000,
    accountId: 1,
    timestamp: FIXED_TIMESTAMP,
  }),
  "second spend",
);
assertDeepEqual(
  spendA,
  spendB,
  "the same spend produces the same change every time",
);

// Collection replacement returns new objects rather than editing in place.
const replaced = expectOk(
  replaceInventoryItem(shelf, { ...ten, quantity: 1 }),
  "replacing an item",
);
assertEqual(
  replaced.length,
  shelf.length,
  "replacing an item does not change the collection size",
);
assertEqual(shelf[0].quantity, 10, "the original array is untouched");
assertEqual(replaced[0].quantity, 1, "the new collection carries the update");
expectFail(
  replaceInventoryItem(shelf, { ...ten, id: 404 }),
  "unknown_item",
  "replacing an item that is not there is refused",
);

const bank1 = expectOk(
  createAccount({ id: 2, name: "bank1", balance: 0 }),
  "a second account for the replacement test",
);
const wallets = [cashAccount(), bank1];
const swappedWallets = expectOk(
  replaceAccount(wallets, { ...cash, balance: 1 }),
  "replacing an account",
);
assertEqual(
  wallets[0].balance,
  50_000,
  "the original account array is untouched",
);
assertEqual(
  swappedWallets[0].balance,
  1,
  "the new account collection carries the update",
);
expectFail(
  replaceAccount(wallets, { ...cash, id: 404 }),
  "missing_account",
  "replacing an account that is not there is refused",
);

// ---------------------------------------------------------------------------
console.log("\nError vocabulary");
// ---------------------------------------------------------------------------

// Every documented code is reachable and distinct, so a caller can switch on it.
const observed = new Set();
[
  parseQuantity(-1),
  parseQuantity(Number.NaN),
  toMinorUnits(1.005),
  toMinorUnits(Number.NaN),
  checkInventoryUnit(rice(), "piece"),
  subtractQuantities(1, 2),
  findInventoryItem(shelf, "potato"),
  createAccount({ id: 9, name: "wallet", balance: 0 }),
].forEach((result) => {
  if (!result.ok) {
    observed.add(result.error.code);
  }
});

assertDeepEqual(
  [...observed].sort(),
  [
    "insufficient_inventory",
    "invalid_money",
    "invalid_money_precision",
    "invalid_quantity",
    "invalid_unit",
    "missing_account",
    "unknown_item",
  ],
  "every documented error code is reachable from a real operation",
);

// ---------------------------------------------------------------------------
console.log("\n# Phase 3: the compound recount the PRD describes");

// "I had 10 onions, used 2" leaves 8. The two numbers are both stated facts and the
// result is their difference, so this operation exists to be the only place that
// difference is ever computed. The tests below check the arithmetic, the refusals, and — the
// one that matters most — that the result really is computed here rather than arriving whole.
{
  const onions = {
    id: 1,
    name: "onions",
    quantity: 10,
    unit: "piece",
    lowThreshold: null,
  };
  const result = recountAfterUse(onions, 10, 2, "piece");

  assert(result.ok, "P3. the PRD's sentence is expressible");
  assertEqual(
    result.ok ? result.value.after : null,
    8,
    "P3. 'I had 10, used 2' leaves 8",
  );
  assertEqual(
    result.ok ? result.value.before : null,
    10,
    "P3. the before is what was stored",
  );
  assertEqual(
    result.ok ? result.value.delta : null,
    -2,
    "P3. the delta is the movement, not the total",
  );

  // The domain computes from the stated facts; it does not have to be told the answer, and
  // from a different starting state it must reach 8 as well.
  const elsewhere = { ...onions, quantity: 0 };
  const fromZero = recountAfterUse(elsewhere, 10, 2, "piece");
  assertEqual(
    fromZero.ok ? fromZero.value.after : null,
    8,
    "P3. the same sentence gives the same answer from any starting state",
  );
  assertEqual(
    fromZero.ok ? fromZero.value.delta : null,
    8,
    "P3. and the delta is measured against real stock",
  );

  const rice = {
    id: 2,
    name: "rice",
    quantity: 12,
    unit: "kg",
    lowThreshold: null,
  };
  const fractional = recountAfterUse(rice, 2.5, 0.5, "kg");
  assertEqual(
    fractional.ok ? fractional.value.after : null,
    2,
    "P3. fractional quantities subtract exactly",
  );
  assertEqual(
    recountAfterUse(rice, 2.5, 0.5, "piece").ok ? "accepted" : "refused",
    "refused",
    "P3. a unit that is not the item's own is refused",
  );
  assertEqual(
    recountAfterUse(rice, 2, 3, "kg").error.code,
    "insufficient_inventory",
    "P3. using more than was counted is refused",
  );
  assertEqual(
    recountAfterUse(rice, -1, 1, "kg").error.code,
    "invalid_quantity",
    "P3. a negative count is refused",
  );
  assertEqual(
    recountAfterUse(rice, 10, "2", "kg").error.code,
    "invalid_quantity",
    "P3. a quantity that is not a number is refused",
  );
  assertEqual(
    recountAfterUse(rice, 10, 2, "").error.code,
    "invalid_unit",
    "P3. a missing unit is refused rather than assumed",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# Phase 3: thresholds are decided in one place");

{
  const base = {
    id: 1,
    name: "onions",
    quantity: 10,
    unit: "piece",
    lowThreshold: null,
  };

  // The rule is "at or below", and every boundary is asserted. A rule that used "<" would
  // pass a test that only checks "clearly low" and would quietly miss a user standing exactly
  // on their own threshold.
  const at = setLowStockThreshold(base, 10);
  assertEqual(
    isLowStock(at.ok ? at.value : base),
    true,
    "P3. equal to the threshold is low",
  );
  const just = setLowStockThreshold(base, 9);
  assertEqual(
    isLowStock(just.ok ? just.value : base),
    false,
    "P3. above the threshold is not low",
  );
  const below = setLowStockThreshold(base, 11);
  assertEqual(
    isLowStock(below.ok ? below.value : base),
    true,
    "P3. below the threshold is low",
  );

  const emptied = { ...base, quantity: 0 };
  const zeroThreshold = setLowStockThreshold(emptied, 0);
  assertEqual(
    isLowStock(zeroThreshold.ok ? zeroThreshold.value : emptied),
    true,
    "P3. an empty item with an alert at 0 is low",
  );
  assertEqual(
    isLowStock({ ...base, quantity: 0.5, lowThreshold: 0 }),
    false,
    "P3. anything above a zero threshold is not low",
  );

  assertEqual(
    isLowStock(base),
    false,
    "P3. no threshold means never flagged, even at zero",
  );
  assertEqual(
    isLowStock({ ...base, quantity: 0 }),
    false,
    "P3. including when the item is empty",
  );

  const cleared = setLowStockThreshold({ ...base, lowThreshold: 3 }, null);
  assertEqual(
    cleared.ok ? cleared.value.lowThreshold : 1,
    null,
    "P3. a threshold can be cleared",
  );
  assertEqual(
    isLowStock(cleared.ok ? cleared.value : base),
    false,
    "P3. clearing returns the item to never-flagged",
  );

  assertEqual(
    setLowStockThreshold(base, -1).error.code,
    "invalid_quantity",
    "P3. a negative threshold is refused",
  );
  assertEqual(
    setLowStockThreshold(base, "3").error.code,
    "invalid_quantity",
    "P3. a threshold that is not a number is refused",
  );

  // A threshold change is not a movement, so it must leave the quantity alone.
  const unchanged = setLowStockThreshold(base, 4);
  assertEqual(
    unchanged.ok ? unchanged.value.quantity : null,
    10,
    "P3. changing a threshold changes no quantity",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# Phase 3: correcting a logged entry");

{
  const item = {
    id: 1,
    name: "onions",
    quantity: 6,
    unit: "piece",
    lowThreshold: null,
  };
  const event = {
    itemId: 1,
    delta: -2,
    timestamp: "2026-01-01T00:00:00.000Z",
    sourceText: "used 2 onions",
  };

  const reversed = reverseInventoryEvent(item, event);
  assertEqual(
    reversed.ok ? reversed.value.delta : null,
    2,
    "P3. a consumption is undone by adding it back",
  );
  assertEqual(
    reversed.ok ? reversed.value.after : null,
    8,
    "P3. which restores the quantity exactly",
  );

  // The correction is measured against the item as it is *now*. Later movements must survive
  // it, which is the whole reason this is not `reverseInventoryChange` on a stale snapshot.
  const movedOn = { ...item, quantity: 11 };
  const afterOtherWork = reverseInventoryEvent(movedOn, event);
  assertEqual(
    afterOtherWork.ok ? afterOtherWork.value.after : null,
    13,
    "P3. later stock is preserved, not discarded",
  );

  const restocked = reverseInventoryEvent(item, { ...event, delta: 5 });
  assertEqual(
    restocked.ok ? restocked.value.delta : null,
    -5,
    "P3. a restock is undone by removing it",
  );
  assertEqual(
    restocked.ok ? restocked.value.after : null,
    1,
    "P3. which also restores exactly",
  );

  assertEqual(
    reverseInventoryEvent(item, { ...event, itemId: 99 }).error.code,
    "unknown_item",
    "P3. an event for another item is refused",
  );
  assertEqual(
    reverseInventoryEvent(item, { ...event, delta: 0 }).error.code,
    "invalid_quantity",
    "P3. an entry that records no change has nothing to correct",
  );
  assertEqual(
    // A restock of 5 being undone while only 1 is on hand: the inverse is a consumption of
    // 5, which stock cannot cover. Correcting an entry must never drive a quantity negative,
    // so this is refused rather than applied.
    reverseInventoryEvent({ ...item, quantity: 1 }, { ...event, delta: 5 })
      .error.code,
    "insufficient_inventory",
    "P3. undoing a restock that the stock cannot absorb is refused rather than going negative",
  );

  // An immediate undo and a later correction of the same entry are the same answer when
  // nothing else has happened, which is what makes the historical form safe to prefer.
  const immediate = reverseInventoryChange({
    kind: "inventory",
    itemId: 1,
    itemName: "onions",
    unit: "piece",
    before: 10,
    after: 8,
    delta: -2,
  });
  assertEqual(
    immediate.ok ? immediate.value.after : null,
    10,
    // Undoing "used 2" from 8 puts the stock back to 10, which is where the original
    // change started. Both forms therefore agree, which is what makes correcting a
    // historical entry safe to prefer over this one.
    "P3. an immediate undo reaches the same state",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# Phase 3: renaming an item never moves stock");

{
  const stocked = {
    id: 1,
    name: "onions",
    quantity: 8,
    unit: "piece",
    lowThreshold: 3,
  };

  const renamed = editInventoryDetails(stocked, {
    name: "  Red onions ",
    unit: "piece",
  });
  assertEqual(
    renamed.ok ? renamed.value.name : null,
    "Red onions",
    "P3. a name is trimmed and stored",
  );
  assertEqual(
    renamed.ok ? renamed.value.quantity : null,
    8,
    "P3. and the quantity is untouched",
  );

  assertEqual(
    editInventoryDetails(stocked, { name: "onions", unit: "kg" }).error.code,
    "invalid_unit",
    "P3. the unit cannot change while stock remains, because 8 piece is not 8 kg",
  );

  const emptied = { ...stocked, quantity: 0 };
  const converted = editInventoryDetails(emptied, {
    name: "onions",
    unit: "kg",
  });
  assertEqual(
    converted.ok ? converted.value.unit : null,
    "kg",
    "P3. an empty item may be re-tracked in another unit",
  );

  assertEqual(
    editInventoryDetails(stocked, { name: "  ", unit: "piece" }).error.code,
    "unknown_item",
    "P3. an empty name is refused",
  );
  assertEqual(
    editInventoryDetails(stocked, { name: "onions", unit: " " }).error.code,
    "invalid_unit",
    "P3. an empty unit is refused",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# Phase 3: items are found by name and by id");

{
  const items = [
    { id: 1, name: "onions", quantity: 8, unit: "piece", lowThreshold: 3 },
    { id: 2, name: "rice", quantity: 2, unit: "kg", lowThreshold: null },
  ];

  assertEqual(
    findInventoryItemById(items, 2).ok
      ? findInventoryItemById(items, 2).value.name
      : null,
    "rice",
    "P3. an id resolves",
  );
  assertEqual(
    findInventoryItemById(items, 99).error.code,
    "unknown_item",
    "P3. an unknown id is a failure, not a miss",
  );
  assertEqual(
    findInventoryItemById([], 1).error.code,
    "unknown_item",
    "P3. and an empty collection resolves nothing",
  );
  assertEqual(
    findInventoryItem(items, "RICE").ok ? 1 : 0,
    1,
    "P3. name lookup stays case-insensitive",
  );
}

// ---------------------------------------------------------------------------
// Phase 7: skills, habits, and the private log, as pure rules.
//
// `skills-test.mjs` covers these through storage, routes, and commands. This section is here
// because each rule below is a claim about a *decision*, and a decision is testable with plain
// input and output — which is exactly the standard `src/domain` is held to. The rules that
// matter most are the refusals, because each one is a place the application declines to guess.
// ---------------------------------------------------------------------------

/** A habit row with only the fields a rule reads. */
function habit(date, type, done, minutes = null) {
  return { id: 0, date, type, done, photoUrl: null, minutes };
}

/** A skill row, for the list rules that operate on a collection of them. */
function skill(name, id = 1) {
  return { id, name, active: true };
}

/** Whether a Result succeeded, for the one-line cases where the value is not the point. */
function succeeded(result) {
  return result.ok;
}

/** The code a Result failed with, for the same cases. */
function codeOf(result) {
  return result.ok ? "<succeeded>" : result.error.code;
}

/** The value a Result succeeded with, for the cases where the value is the whole point. */
function value(result) {
  return result.ok ? result.value : "<refused>";
}

console.log("\n# Phase 7: the replacement-skill list");

{
  assertEqual(MAX_SKILLS, 10, "P7. the PRD's cap is ten skills");
  assertEqual(
    createSkill({ name: "  read a book  " }, []).ok,
    true,
    true,
    'P7. a name is trimmed, so " read a book " and "read a book" cannot both exist',
  );
  assertEqual(
    codeOf(createSkill({ name: "READ A BOOK" }, [skill("read a book")])),
    "duplicate_skill",
    "P7. and the duplicate check is case-insensitive",
  );
  assertEqual(
    codeOf(createSkill({ name: "" }, [])),
    "invalid_skill_name",
    "P7. an empty name is refused with a name of its own",
  );
  assertEqual(
    codeOf(createSkill({ name: "x".repeat(81) }, [])),
    "invalid_skill_name",
    "P7. and a name over 80 characters",
  );
  assertEqual(
    codeOf(
      createSkill(
        { name: "another" },
        new Array(MAX_SKILLS).fill(null).map((_, index) => skill(`s${index}`)),
      ),
    ),
    "skill_limit_reached",
    "P7. a full list refuses the eleventh skill",
  );

  const list = [skill("one"), skill("two"), skill("three")];

  assertEqual(
    swapList(list)
      .map((entry) => entry.name)
      .join(", "),
    "one, two, three",
    "P7. the swap list is every skill, in order, with nothing filtered out",
  );
  assertEqual(
    remainingSkillSlots(list),
    MAX_SKILLS - 3,
    "P7. and the remaining slots are counted from the stored list",
  );
  assertEqual(
    swapList([]).length,
    0,
    "P7. an empty list is empty, not an error",
  );
}

console.log("\n# Phase 7: logging a skill and tallying it");

{
  const reading = skill("reading");

  assertEqual(
    succeeded(logSkillUse(reading, {}), null),
    true,
    "P7. a use without a duration is allowed; the PRD makes duration optional",
  );
  assertEqual(
    codeOf(logSkillUse(reading, { minutes: -1 })),
    "invalid_skill_minutes",
    "P7. a negative duration is refused",
  );
  assertEqual(
    codeOf(logSkillUse(reading, { minutes: 2.5 })),
    "invalid_skill_minutes",
    "P7. and a fractional one",
  );
  assertEqual(
    codeOf(logSkillUse(reading, { minutes: MAX_SKILL_MINUTES + 1 })),
    "invalid_skill_minutes",
    "P7. and one over a day",
  );
  assertEqual(
    findSkill([reading], "READING").id,
    reading.id,
    "P7. a skill is found case-insensitively, as the duplicate check is",
  );
  // `findSkill` returns `null` rather than a Result: it is a lookup, and a lookup's failure is
  // "not there". The executor turns that into `unknown_skill`, which `skills-test.mjs` asserts.
  assertEqual(
    findSkill([reading], "pushups"),
    null,
    "P7. an unknown name resolves to nothing rather than to a new skill",
  );

  const logs = [
    {
      id: 1,
      skillId: reading.id,
      timestamp: "2026-10-01T09:00:00.000Z",
      minutes: 30,
    },
    {
      id: 2,
      skillId: reading.id,
      timestamp: "2026-10-02T09:00:00.000Z",
      minutes: null,
    },
  ];
  const tally = tallyFor(reading, logs);

  assertEqual(
    tally.times,
    2,
    "P7. the tally counts the entries for that skill",
  );
  assertEqual(
    tally.minutes,
    30,
    "P7. sums only the stated durations, and does not invent one for an entry without",
  );
  assertEqual(
    tallyFor(reading, []).times,
    0,
    "P7. a skill never used tallies to zero rather than to nothing",
  );
}

console.log("\n# Phase 7: habit rules");

{
  assertEqual(
    isLoggableHabitType("laundry"),
    true,
    "P7. the four loggable habits are a closed set",
  );
  assertEqual(
    isLoggableHabitType("masturbation"),
    false,
    "P7. and a private behaviour is not one of them",
  );
  assertEqual(
    isPrivateType("masturbation"),
    true,
    "P7. the two private types are a closed set too",
  );
  assertEqual(
    isPrivateType("cooking"),
    false,
    "P7. and a habit is not a private type",
  );

  assertEqual(
    codeOf(
      recordHabit({
        date: "2026-10-01",
        type: "laundry",
        done: true,
        hasPhotoProof: false,
      }),
    ),
    "photo_required",
    "P7. laundry cannot be recorded as done without proof",
  );
  assertEqual(
    succeeded(
      recordHabit({
        date: "2026-10-01",
        type: "laundry",
        done: true,
        hasPhotoProof: true,
      }),
      true,
    ),
    true,
    "P7. and is recorded as done when the caller confirms the photo was written",
  );
  assertEqual(
    succeeded(
      recordHabit({ date: "2026-10-01", type: "laundry", done: false }),
      true,
    ),
    true,
    "P7. recording it as not done needs no photo: the rule governs completion",
  );
  assertEqual(
    codeOf(
      recordHabit({
        date: "2026-10-01",
        type: "dishes",
        done: true,
        minutes: 10,
      }),
    ),
    "invalid_habit_minutes",
    "P7. a habit that was done takes no duration",
  );
  assertEqual(
    codeOf(
      recordHabit({ date: "2026-10-01", type: "screen_time", done: true }),
    ),
    "invalid_habit_minutes",
    "P7. screen time needs minutes",
  );
  assertEqual(
    codeOf(
      recordHabit({
        date: "2026-10-01",
        type: "screen_time",
        done: true,
        minutes: MAX_SCREEN_TIME_MINUTES + 1,
      }),
    ),
    "invalid_habit_minutes",
    "P7. and cannot be more than a day",
  );
  assertEqual(
    recordHabit({
      date: "2026-10-01",
      type: "screen_time",
      done: false,
      minutes: 30,
    }).ok,
    true,
    "P7. a measurement is always stored as done, whatever was said",
  );
}

console.log("\n# Phase 7: streaks and the laundry target");

{
  const entries = [
    habit("2026-09-29", "cooking", true),
    habit("2026-09-30", "cooking", true),
    habit("2026-10-01", "cooking", true),
  ];

  assertEqual(
    habitStreak(entries, "cooking", "2026-10-01").days,
    3,
    "P7. consecutive days recorded as done are counted",
  );
  assertEqual(
    habitStreak(entries, "cooking", "2026-10-02").days,
    3,
    "P7. and a day with no entry does not break it, because the day is not over",
  );
  assertEqual(
    habitStreak(
      [...entries, habit("2026-10-02", "cooking", false)],
      "cooking",
      "2026-10-02",
    ).days,
    0,
    "P7. a day recorded as not done does break it",
  );
  assertEqual(
    habitStreak(entries, "cooking", "2026-10-04").days,
    0,
    "P7. and so does a gap: two unrecorded days is not a run",
  );
  assertEqual(
    habitStreak(entries, "cooking", "2026-09-28").days,
    0,
    "P7. entries dated after today are not counted in advance",
  );
  assertEqual(
    habitStreak([], "dishes", "2026-10-01").lastRecorded,
    null,
    "P7. nothing recorded reads as nothing, not as zero days kept",
  );

  const window = [
    habit("2026-10-01", "laundry", true),
    habit("2026-10-02", "laundry", true),
    // Two uploads on one day: still one day of laundry.
    habit("2026-10-02", "laundry", true),
    habit("2026-10-03", "laundry", false),
    habit("2026-10-04", "dishes", true),
  ];
  const progress = laundryProgress(window);

  assertEqual(progress.target, 2, "P7. the PRD's target is twice a week");
  assertEqual(
    progress.doneThisWeek,
    2,
    "P7. counted in days, so a second upload on one day is not a second day",
  );
  assertEqual(
    laundryProgress([habit("2026-10-01", "laundry", true)]).doneThisWeek,
    1,
    "P7. one day counts as one, and the domain states no verdict on it",
  );
  assertEqual(
    Object.keys(laundryProgress([])).some((field) =>
      /met|percent|score/i.test(field),
    ),
    false,
    "P7. the rule returns two numbers and no judgement; the bar is the page's to draw",
  );
}

console.log("\n# Phase 7: the private log");

{
  assertEqual(
    succeeded(
      recordPrivateEntry({ date: "2026-10-01", type: "doom_scrolling" }),
      true,
    ),
    true,
    "P7. a yes with no note is allowed; the PRD makes the note optional",
  );
  assertEqual(
    recordPrivateEntry({
      date: "2026-10-01",
      type: "doom_scrolling",
      note: "  late again  ",
    }).ok,
    true,
    "P7. a note is trimmed",
  );
  assertEqual(
    codeOf(
      recordPrivateEntry({
        date: "2026-10-01",
        type: "doom_scrolling",
        note: "x".repeat(501),
      }),
    ),
    "invalid_private_note",
    "P7. a note over 500 characters is refused",
  );
  assertEqual(
    codeOf(
      recordPrivateEntry({
        date: "2026-10-01",
        type: "doom_scrolling",
        note: "bad\u0000note",
      }),
    ),
    "invalid_private_note",
    "P7. and one containing a control character, which a reader could not display",
  );
  assertEqual(
    privateTypeLabel("doom_scrolling"),
    "Doom scrolling",
    "P7. a label says what the entry is",
  );
  assertEqual(
    /streak|count|score|times|often/i.test(privateTypeLabel("masturbation")),
    false,
    "P7. and never anything about how often or how it ranks",
  );
}

// ---------------------------------------------------------------------------
console.log("\n# Phase 8: diary notes");

{
  assertEqual(
    value(diaryNote(null)),
    null,
    "P8. no note is valid, and means no note",
  );
  assertEqual(
    value(diaryNote(undefined)),
    null,
    "P8. an absent note is the same thing, so a form may simply omit it",
  );
  assertEqual(
    value(diaryNote("")),
    null,
    "P8. an empty note is the same thing, which is how a note is cleared",
  );
  assertEqual(
    value(diaryNote("   \t\n  ")),
    null,
    "P8. and whitespace is nothing to write down",
  );
  assertEqual(
    value(diaryNote("  shelves are clean  ")),
    "shelves are clean",
    "P8. a note is trimmed, so two spellings of it are one note",
  );
  assertEqual(
    value(diaryNote("baskets\tshirts")),
    "baskets shirts",
    "P8. a tab becomes a space rather than disappearing into the next word",
  );
  assertEqual(
    value(diaryNote("folded\nthe towels")),
    "folded the towels",
    "P8. a line break becomes a space too, so a note stays one line of text",
  );
  assertEqual(
    value(diaryNote("x".repeat(MAX_DIARY_NOTE))),
    "x".repeat(MAX_DIARY_NOTE),
    `P8. a note of exactly ${MAX_DIARY_NOTE} characters is allowed`,
  );
  assertEqual(
    codeOf(diaryNote("x".repeat(MAX_DIARY_NOTE + 1))),
    "invalid_diary_note",
    "P8. one character more is refused",
  );
  assertEqual(
    codeOf(diaryNote("bad\u0000note")),
    "invalid_diary_note",
    "P8. a NUL is refused: a note a reader cannot display is not a note",
  );
  assertEqual(
    codeOf(diaryNote("bad\u001b[31mred")),
    "invalid_diary_note",
    "P8. and so is an escape sequence, which is not text anyone meant to write",
  );

  // The order of the two checks, which is only observable in the case that has both: a tab (which
  // is normalised, not refused) beside a character that must be refused. Normalising first means
  // the note is judged on what would actually be stored.
  assertEqual(
    value(diaryNote("\u0000\t")),
    "<refused>",
    "P8. a refused character beside a tab is still refused",
  );
  assertEqual(
    codeOf(diaryNote("\u0000\t")),
    "invalid_diary_note",
    "P8. and reported as a note problem rather than silently normalised away",
  );

  // Statelessness. A module-level `/g` pattern carries `lastIndex` between calls, and the same
  // refused note checked twice in a row is the case that would expose it.
  assertEqual(
    codeOf(diaryNote("bad\u0000note")) === "invalid_diary_note" &&
      codeOf(diaryNote("bad\u0000note")) === "invalid_diary_note",
    true,
    "P8. the same refused note is refused twice, so no state is carried between calls",
  );
  assertEqual(
    value(diaryNote("first\tline")) === "first line" &&
      value(diaryNote("second\tline")) === "second line",
    true,
    "P8. and normalisation is not left half-applied on the next call either",
  );

  assertEqual(hasDiaryNote(null), false, "P8. null is not a note");
  assertEqual(hasDiaryNote(""), false, "P8. nor is the empty string");
  assertEqual(hasDiaryNote("x"), true, "P8. anything else is");

  const entries = [
    { id: 1, date: "2026-10-01", photoUrl: "/api/photos/1/a.jpg", note: "a" },
    { id: 4, date: "2026-10-03", photoUrl: "/api/photos/4/d.jpg", note: null },
    { id: 5, date: "2026-10-03", photoUrl: "/api/photos/5/e.jpg", note: "b" },
  ];
  const ordered = byNewestFirst(entries).map((entry) => entry.id);

  assertEqual(
    ordered.join(","),
    "5,4,1",
    "P8. newest first, and a re-photographed day keeps the later entry first",
  );
  assertEqual(
    entries.map((entry) => entry.id).join(","),
    "1,4,5",
    "P8. and the input array is not reordered in place",
  );
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
