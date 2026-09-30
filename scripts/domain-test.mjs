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
  findInventoryItem,
  isLowStock,
  replaceInventoryItem,
  restockInventory,
  reverseInventoryChange,
  setInventoryQuantity,
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
console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
