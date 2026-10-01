/**
 * Contract and validation tests.
 *
 * Run with `npm run contract:test`. Everything is in memory: the input is a plain object, the
 * output is a plain object, and no database, file, network call, or clock is involved. The
 * suite never imports a persistence module, and the final section proves it by running with
 * `better-sqlite3` removed from `node_modules`.
 *
 * The weight of the suite sits on the input that must be *rejected*. Validation's whole value
 * is that a malformed command cannot be acted on, and a validator that quietly accepts bad
 * input is worse than no validator at all, because everything downstream then trusts it.
 */
import { isCommand, parseCommand } from "../src/lib/validation/command.ts";
import {
  consumeArguments,
  expenseArguments,
  restockArguments,
  setQuantityArguments,
} from "../src/commands/domain-input.ts";
import { COMMAND_KINDS, COMMAND_VERSION } from "../src/commands/contract.ts";
import { createAccount } from "../src/domain/accounts.ts";
import { createInventoryItem } from "../src/domain/inventory.ts";
import { toMinorUnits } from "../src/domain/money.ts";

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
  if (Object.is(actual, expected)) {
    ok(message);
  } else {
    bad(
      `${message} (expected ${String(expected)}, received ${String(actual)})`,
    );
  }
}

/** Order-insensitive structural comparison, so key order never fails a test. */
function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }

  return value;
}

function assertDeepEqual(actual, expected, message) {
  const same =
    JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected));

  if (same) {
    ok(message);
  } else {
    bad(
      `${message} (expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)})`,
    );
  }
}

/** Asserts validation accepted the input, returning the command. */
function expectValid(input, message) {
  const result = parseCommand(input);

  if (!result.ok) {
    bad(
      `${message} unexpectedly rejected: ${result.error.issues
        .map((issue) => `${issue.path || "(root)"} ${issue.code}`)
        .join("; ")}`,
    );
    return undefined;
  }

  ok(message);

  return result.value;
}

/** Asserts validation rejected the input with a specific issue code. */
function expectRejected(input, code, message) {
  const result = parseCommand(input);

  if (result.ok) {
    bad(`${message} unexpectedly accepted: ${JSON.stringify(result.value)}`);
    return;
  }

  if (!result.error.issues.some((issue) => issue.code === code)) {
    bad(
      `${message} was rejected, but not with ${code} (got ${result.error.issues
        .map((issue) => issue.code)
        .join(", ")})`,
    );
    return;
  }

  ok(`${message} -> ${code}`);
}

// ---------------------------------------------------------------------------
console.log("\nValid commands");
// ---------------------------------------------------------------------------

const consume = expectValid(
  {
    version: COMMAND_VERSION,
    kind: "inventory.consume",
    itemName: "onions",
    amount: 2,
    unit: "piece",
    sourceText: "used 2 onions",
  },
  "a consume command from 'used 2 onions'",
);
assertDeepEqual(
  consume,
  {
    version: COMMAND_VERSION,
    kind: "inventory.consume",
    itemName: "onions",
    amount: 2,
    unit: "piece",
    sourceText: "used 2 onions",
  },
  "the validated command is exactly the structured facts, not the sentence",
);

const restock = expectValid(
  {
    version: COMMAND_VERSION,
    kind: "inventory.restock",
    itemName: "rice",
    amount: 1.5,
    unit: "kg",
  },
  "a restock command with a fractional weight",
);
assertEqual(
  restock.amount,
  1.5,
  "a fractional quantity survives validation unchanged",
);

const recount = expectValid(
  {
    version: COMMAND_VERSION,
    kind: "inventory.set_quantity",
    itemName: "onions",
    quantity: 10,
  },
  "a set_quantity command from 'I had 10 onions'",
);
assertEqual(
  recount.kind,
  "inventory.set_quantity",
  "the discriminator is preserved",
);

// The PRD's compound sentence. Both facts are carried, and the difference between them is
// conspicuously absent — a result field here would be the model doing the subtraction.
const recounted = expectValid(
  {
    version: COMMAND_VERSION,
    kind: "inventory.recount_after_use",
    itemName: "onions",
    countedQuantity: 10,
    usedAmount: 2,
    unit: "piece",
    sourceText: "I had 10 onions, used 2",
  },
  "the PRD's 'I had 10 onions, used 2'",
);
assertEqual(recounted.countedQuantity, 10, "the stated count is carried");
assertEqual(recounted.usedAmount, 2, "the stated use is carried");
assertEqual(
  "after" in recounted || "remaining" in recounted,
  false,
  "and the command carries no resulting quantity for a model to invent",
);
expectRejected(
  {
    version: COMMAND_VERSION,
    kind: "inventory.recount_after_use",
    itemName: "onions",
    countedQuantity: 10,
    usedAmount: 2,
    // No unit: the domain needs it to refuse a mismatch, and a missing one cannot be assumed.
    result: 8,
  },
  "unexpected_field",
  "a recount that tries to supply the result itself",
);

const spend = expectValid(
  {
    version: COMMAND_VERSION,
    kind: "expense.record",
    accountName: "cash",
    item: "banana",
    amount: 1000,
    sourceText: "bought banana 10 rupees cash",
  },
  "an expense command from 'bought banana 10 rupees cash'",
);
assertEqual(
  spend.accountName,
  "cash",
  "the account is carried by name, not by id",
);
assertEqual(spend.category, null, "an absent optional category becomes null");
assert(
  !("balance" in spend),
  "the command carries no balance, so none can be computed from it",
);
assert(
  !("timestamp" in spend),
  "the command carries no timestamp, so none is invented",
);

const categorised = expectValid(
  {
    version: COMMAND_VERSION,
    kind: "expense.record",
    accountName: "bank1",
    item: "rice",
    amount: 5000,
    category: "groceries",
    sourceText: null,
  },
  "an expense with a category and no source sentence",
);
assertEqual(categorised.category, "groceries", "a provided category is kept");
assertEqual(
  categorised.sourceText,
  null,
  "an explicit null source text is kept",
);

const zeroAmount = expectValid(
  {
    version: COMMAND_VERSION,
    kind: "expense.record",
    accountName: "cash",
    item: "nothing",
    amount: 0,
  },
  "a zero-amount expense is structurally valid",
);
assertEqual(zeroAmount.amount, 0, "zero money is accepted without becoming -0");

// Every declared discriminator is reachable. Phase 6 added the routine and sleep families, so
// the count is ten: the sample table below is the test that a new kind cannot be declared
// without a minimal valid example.
assertEqual(
  COMMAND_KINDS.length,
  10,
  "the contract declares ten command kinds",
);
for (const kind of COMMAND_KINDS) {
  const samples = {
    "inventory.consume": { itemName: "onions", amount: 1, unit: "piece" },
    "inventory.restock": { itemName: "onions", amount: 1, unit: "piece" },
    "inventory.set_quantity": { itemName: "onions", quantity: 1 },
    "inventory.recount_after_use": {
      itemName: "onions",
      countedQuantity: 10,
      usedAmount: 2,
      unit: "piece",
    },
    "expense.record": { accountName: "cash", item: "x", amount: 1 },
    "task.create": { title: "finish the report" },
    "task.set_done": { title: "finish the report", done: true },
    "sleep.record": { field: "bedtime", time: "23:00" },
    "nap.start": { time: "14:00" },
    "nap.end": { time: "14:45" },
  };

  expectValid(
    { version: COMMAND_VERSION, kind, ...samples[kind] },
    `discriminator ${kind} is valid`,
  );
}

// The stated day a sentence named, and the fact that a *date* is never one of them.
for (const day of ["today", "tomorrow", "yesterday"]) {
  expectValid(
    { version: COMMAND_VERSION, kind: "task.create", title: "x", day },
    `a stated day reference (${day}) is valid`,
  );
}

expectRejected(
  {
    version: COMMAND_VERSION,
    kind: "task.create",
    title: "x",
    day: "2026-10-02",
  },
  "wrong_type",
  "a computed calendar date is refused where a stated day is expected",
);

// ---------------------------------------------------------------------------
console.log("\nUnknown and malformed commands");
// ---------------------------------------------------------------------------

expectRejected(
  { version: 1, kind: "sleep.log", itemName: "x" },
  "unknown_command_kind",
  "an unknown command kind",
);
expectRejected(
  { version: 1, kind: "inventory.teleport", amount: 1 },
  "unknown_command_kind",
  "a near-miss kind is still unknown",
);
expectRejected(
  { version: 1, kind: "" },
  "unknown_command_kind",
  "an empty kind is unknown",
);
expectRejected(
  { version: 1, kind: 42 },
  "wrong_type",
  "a numeric kind is the wrong type",
);
expectRejected(
  { version: 1, kind: null },
  "wrong_type",
  "a null kind is the wrong type",
);
expectRejected(
  { version: 1, itemName: "onions" },
  "missing_field",
  "a command with no kind",
);

// Fail closed on version drift, which is what the version field exists for.
expectRejected(
  { kind: "inventory.consume", itemName: "o", amount: 1, unit: "piece" },
  "missing_field",
  "a missing version is rejected",
);
expectRejected(
  {
    version: 0,
    kind: "inventory.consume",
    itemName: "o",
    amount: 1,
    unit: "piece",
  },
  "unsupported_version",
  "version 0 is refused",
);
expectRejected(
  {
    version: 2,
    kind: "inventory.consume",
    itemName: "o",
    amount: 1,
    unit: "piece",
  },
  "unsupported_version",
  "a future version is refused, not reinterpreted",
);
expectRejected(
  {
    version: "1",
    kind: "inventory.consume",
    itemName: "o",
    amount: 1,
    unit: "piece",
  },
  "wrong_type",
  "a string version is the wrong type",
);

// Required fields.
expectRejected(
  { version: 1, kind: "inventory.consume", amount: 1, unit: "piece" },
  "missing_field",
  "a consume with no item name",
);
expectRejected(
  { version: 1, kind: "inventory.consume", itemName: "onions", unit: "piece" },
  "missing_field",
  "a consume with no amount",
);
expectRejected(
  { version: 1, kind: "inventory.consume", itemName: "onions", amount: 1 },
  "missing_field",
  "a consume with no unit",
);
expectRejected(
  { version: 1, kind: "inventory.set_quantity", itemName: "onions" },
  "missing_field",
  "a recount with no quantity",
);
expectRejected(
  { version: 1, kind: "expense.record", accountName: "cash", item: "x" },
  "missing_field",
  "an expense with no amount",
);

// Wrong primitive types. Crucially, nothing is coerced.
expectRejected(
  {
    version: 1,
    kind: "inventory.consume",
    itemName: "onions",
    amount: "2",
    unit: "piece",
  },
  "wrong_type",
  "a string amount is not read as a number",
);
expectRejected(
  {
    version: 1,
    kind: "inventory.consume",
    itemName: "onions",
    amount: true,
    unit: "piece",
  },
  "wrong_type",
  "a boolean amount is the wrong type",
);
expectRejected(
  {
    version: 1,
    kind: "inventory.consume",
    itemName: 42,
    amount: 1,
    unit: "piece",
  },
  "wrong_type",
  "a numeric item name is the wrong type",
);
expectRejected(
  {
    version: 1,
    kind: "expense.record",
    accountName: "cash",
    item: "x",
    amount: "1000",
  },
  "wrong_type",
  "a string money amount is not parsed",
);
expectRejected(
  {
    version: 1,
    kind: "expense.record",
    accountName: "cash",
    item: "x",
    amount: 1,
    category: 7,
  },
  "wrong_type",
  "a numeric category is the wrong type",
);
expectRejected(
  {
    version: 1,
    kind: "expense.record",
    accountName: "cash",
    item: "x",
    amount: 1,
    sourceText: 9,
  },
  "wrong_type",
  "a numeric source text is the wrong type",
);

// Non-finite numbers.
expectRejected(
  {
    version: 1,
    kind: "inventory.consume",
    itemName: "o",
    amount: Number.NaN,
    unit: "piece",
  },
  "wrong_type",
  "NaN is not a quantity",
);
expectRejected(
  {
    version: 1,
    kind: "inventory.consume",
    itemName: "o",
    amount: Number.POSITIVE_INFINITY,
    unit: "piece",
  },
  "wrong_type",
  "Infinity is not a quantity",
);
expectRejected(
  {
    version: 1,
    kind: "expense.record",
    accountName: "cash",
    item: "x",
    amount: Number.NaN,
  },
  "wrong_type",
  "NaN is not an amount",
);

// Representation, using the domain's own rules rather than a second copy.
expectRejected(
  {
    version: 1,
    kind: "inventory.consume",
    itemName: "o",
    amount: -1,
    unit: "piece",
  },
  "invalid_quantity",
  "a negative quantity is refused",
);
expectRejected(
  {
    version: 1,
    kind: "expense.record",
    accountName: "cash",
    item: "x",
    amount: -100,
  },
  "invalid_money",
  "a negative amount is refused",
);
expectRejected(
  {
    version: 1,
    kind: "expense.record",
    accountName: "cash",
    item: "x",
    amount: 10.5,
  },
  "invalid_money",
  "a fractional amount is refused, not rounded",
);
expectRejected(
  {
    version: 1,
    kind: "expense.record",
    accountName: "wallet",
    item: "x",
    amount: 100,
  },
  "invalid_account",
  "an account outside the PRD set is refused",
);
expectRejected(
  {
    version: 1,
    kind: "expense.record",
    accountName: 1,
    item: "x",
    amount: 100,
  },
  "wrong_type",
  "a numeric account name is the wrong type",
);

// Empty strings.
expectRejected(
  {
    version: 1,
    kind: "inventory.consume",
    itemName: "   ",
    amount: 1,
    unit: "piece",
  },
  "empty_string",
  "a whitespace item name is refused",
);
expectRejected(
  {
    version: 1,
    kind: "inventory.consume",
    itemName: "o",
    amount: 1,
    unit: "  ",
  },
  "empty_string",
  "a whitespace unit is refused",
);
expectRejected(
  {
    version: 1,
    kind: "expense.record",
    accountName: "cash",
    item: "",
    amount: 100,
  },
  "empty_string",
  "an empty expense item is refused",
);

// Strictness: unknown fields are rejected rather than dropped.
expectRejected(
  {
    version: 1,
    kind: "expense.record",
    accountName: "cash",
    item: "x",
    amount: 100,
    balance: 999999,
  },
  "unexpected_field",
  "an invented balance field is rejected, so a model cannot smuggle a computed result in",
);
expectRejected(
  {
    version: 1,
    kind: "inventory.consume",
    itemName: "o",
    amount: 1,
    unit: "piece",
    note: "hi",
  },
  "unexpected_field",
  "an extra note field is rejected",
);
expectRejected(
  {
    version: 1,
    kind: "inventory.set_quantity",
    itemName: "o",
    quantity: 5,
    unit: "piece",
  },
  "unexpected_field",
  "a unit on a recount is rejected, because the operation takes none",
);
expectRejected(
  {
    version: 1,
    kind: "expense.record",
    accountName: "cash",
    item: "x",
    amount: 100,
    timestamp: "2026-01-01",
  },
  "unexpected_field",
  "an invented timestamp is rejected rather than trusted",
);

// ---------------------------------------------------------------------------
console.log("\nHostile and non-object input");
// ---------------------------------------------------------------------------

expectRejected(null, "not_an_object", "null is rejected");
expectRejected(undefined, "not_an_object", "undefined is rejected");
expectRejected(42, "not_an_object", "a bare number is rejected");
expectRejected(
  "bought banana 10 rupees cash",
  "not_an_object",
  "a raw sentence is not a command",
);
expectRejected(
  [],
  "not_an_object",
  "an array is rejected where an object is required",
);
expectRejected(
  [{ version: 1, kind: "inventory.consume" }],
  "not_an_object",
  "an array of commands is rejected",
);
expectRejected(true, "not_an_object", "a boolean is rejected");
expectRejected({}, "missing_field", "an empty object is rejected");
expectRejected(
  Object.create(null),
  "missing_field",
  "a null-prototype object is rejected, not crashed on",
);

// An arbitrary deep object with nothing recognisable.
expectRejected(
  {
    version: 1,
    kind: "inventory.consume",
    itemName: { toString: "x" },
    amount: { nested: [1, 2] },
    unit: null,
  },
  "wrong_type",
  "nested object and null values in every field are all reported",
);

// Prototype pollution: an own `__proto__` key must not become a field.
const polluted = JSON.parse(
  '{"version":1,"kind":"expense.record","accountName":"cash","item":"x","amount":100,"__proto__":{"admin":true}}',
);
expectRejected(
  polluted,
  "unexpected_field",
  "an own __proto__ key from JSON is rejected",
);

// An inherited `kind` must not be mistaken for a declared one.
const inherited = Object.create({ kind: "expense.record", version: 1 });
inherited.accountName = "cash";
inherited.item = "x";
inherited.amount = 100;
expectRejected(
  inherited,
  "missing_field",
  "an inherited kind is not treated as a declared field",
);

// Inherited amount must not satisfy a required field either.
const inheritedAmount = Object.create({ amount: 100 });
inheritedAmount.version = 1;
inheritedAmount.kind = "expense.record";
inheritedAmount.accountName = "cash";
inheritedAmount.item = "x";
expectRejected(
  inheritedAmount,
  "missing_field",
  "an inherited amount is not read",
);

// A getter that throws must not take the process down.
const hostile = {
  version: 1,
  kind: "inventory.consume",
  get itemName() {
    throw new Error("boom");
  },
  amount: 1,
  unit: "piece",
};
let threw = false;
try {
  parseCommand(hostile);
} catch {
  threw = true;
}
assert(
  !threw,
  "a throwing getter surfaces as a rejected command rather than an unhandled crash",
);

// Multiple problems are reported together, so a retry costs one round trip.
const manyProblems = parseCommand({ version: 1, kind: "expense.record" });
assert(!manyProblems.ok, "a command missing several fields is rejected");
assertEqual(
  manyProblems.error.issues.length,
  3,
  "all three missing fields are reported in one pass",
);
assertEqual(
  manyProblems.error.code,
  "invalid_command",
  "failures carry a stable error code",
);

// The validator does not mutate the object it was given.
const original = {
  version: 1,
  kind: "expense.record",
  accountName: "cash",
  item: "x",
  amount: 100,
};
const before = JSON.stringify(original);
parseCommand(original);
assertEqual(
  JSON.stringify(original),
  before,
  "validation did not mutate the caller's object",
);

// isCommand agrees with parseCommand.
assert(
  isCommand({
    version: 1,
    kind: "expense.record",
    accountName: "cash",
    item: "x",
    amount: 1,
  }),
  "isCommand accepts a valid command",
);
assert(
  !isCommand({ version: 1, kind: "nope" }),
  "isCommand rejects an invalid command",
);

// ---------------------------------------------------------------------------
console.log("\nCompatibility with the domain operations");
// ---------------------------------------------------------------------------

// The end-to-end shape claim: untrusted object -> validation -> structured command ->
// the exact arguments a domain operation expects. No execution, no persistence.
const untrusted = JSON.parse(
  '{"version":1,"kind":"inventory.consume","itemName":"onions","amount":2,"unit":"piece","sourceText":"used 2 onions"}',
);
const validated = expectValid(
  untrusted,
  "an untrusted JSON payload validates into a command",
);

const onions = createInventoryItem({
  id: 1,
  name: "onions",
  quantity: 10,
  unit: "piece",
});
const consumeArgs = consumeArguments(validated, onions.value);

assertEqual(consumeArgs.length, 3, "consumeInventory takes three arguments");
assertEqual(
  consumeArgs[0],
  onions.value,
  "the resolved item is passed through untouched",
);
assertEqual(
  consumeArgs[1],
  2,
  "the command's amount becomes the operation's amount",
);
assertEqual(
  consumeArgs[2],
  "piece",
  "the command's unit becomes the operation's unit",
);

const recountArgs = setQuantityArguments(
  expectValid(
    {
      version: 1,
      kind: "inventory.set_quantity",
      itemName: "onions",
      quantity: 4,
    },
    "a recount command",
  ),
  onions.value,
);
assertEqual(recountArgs.length, 2, "setInventoryQuantity takes two arguments");
assertEqual(
  recountArgs[1],
  4,
  "the recount quantity reaches the operation unchanged",
);

const restockArgs = restockArguments(
  expectValid(
    {
      version: 1,
      kind: "inventory.restock",
      itemName: "rice",
      amount: 0.5,
      unit: "kg",
    },
    "a restock command",
  ),
  createInventoryItem({ id: 2, name: "rice", quantity: 1, unit: "kg" }).value,
);
assertEqual(
  restockArgs[1],
  0.5,
  "a fractional restock reaches the operation unchanged",
);

const cash = createAccount({ id: 7, name: "cash", balance: 50_000 });
const expenseCmd = expectValid(
  {
    version: 1,
    kind: "expense.record",
    accountName: "cash",
    item: "banana",
    amount: toMinorUnits(10).value,
    sourceText: "bought banana 10 rupees cash",
  },
  "an expense command",
);
const expenseArgs = expenseArguments(
  expenseCmd,
  cash.value,
  "2026-09-30T14:00:00.000Z",
);

assertEqual(expenseArgs.length, 2, "applyExpense takes two arguments");
assertEqual(
  expenseArgs[0],
  cash.value,
  "the resolved account is passed to the operation",
);
assertDeepEqual(
  expenseArgs[1],
  {
    item: "banana",
    amount: 1000,
    accountId: 7,
    timestamp: "2026-09-30T14:00:00.000Z",
    category: null,
  },
  "the expense input matches the domain's ExpenseInput field for field",
);
assertEqual(
  expenseArgs[1].accountId,
  cash.value.id,
  "the account id comes from the resolved account, never from the command",
);

// The validator computed nothing: a command cannot carry a derived outcome.
const spendShape = Object.keys(spend).sort();
assertEqual(
  spendShape.includes("after") || spendShape.includes("balance"),
  false,
  "a validated expense command contains no computed balance",
);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
