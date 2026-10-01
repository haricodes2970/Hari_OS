/**
 * Chat engine integration tests: a sentence to persisted state, against real SQLite.
 *
 * Run with `npm run chat:test`.
 *
 * These prove the property the whole Phase 2 boundary exists for: **a sentence either produces
 * a real, deterministic change, or produces nothing at all.** Every refusal case compares the
 * complete database state before and after, so a partially applied change cannot pass by being
 * invisible in the result message.
 *
 * The parser is a fixture, never a network call. That is deliberate. The property under test is
 * what the application does with a *proposal* — including a hostile, malformed, or ambiguous
 * one — and that is fully determined by the proposal. Whether OpenRouter happened to produce
 * it is a separate question, covered by `parser:test` and by an optional live smoke test.
 *
 * Real SQLite throughout, no mocks, against a disposable database in the OS temp directory.
 * The development database at `data/hari-os.db` is never opened, and its fingerprint is
 * asserted unchanged at the end.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const developmentDatabase = path.join(projectRoot, "data", "hari-os.db");

let passed = 0;
let failed = 0;
const tempDirs = [];

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

function fingerprint(file) {
  if (!fs.existsSync(file)) {
    return "absent";
  }

  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

const developmentFingerprintBefore = fingerprint(developmentDatabase);

/**
 * One disposable database for the whole file, pointed at before anything imports the runtime.
 *
 * The engine reaches storage through the Phase 1 composition root, which resolves the database
 * path from `HARI_OS_DB_PATH` the first time it opens a connection and caches the handle. So
 * the variable is set here, at module top level, and every module that touches storage is
 * imported *afterwards* through `await import`, which is why this file has no static import of
 * the engine.
 *
 * The first draft of this file created a fresh database per case and imported the engine
 * statically. That combination was wrong in a way worth recording: the engine wrote to the real
 * `data/hari-os.db`, because the cached connection had already resolved to the default path.
 * The commands failed as `unknown_item` — the development database has no inventory rows — so
 * nothing was written and its fingerprint was unchanged, but the test was silently exercising
 * the wrong database. Isolation has to be established *before* the first import, not after.
 */
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "hari-os-chat-"));
tempDirs.push(scratchDir);

const scratchFile = path.join(scratchDir, "chat.db");
process.env.HARI_OS_DB_PATH = scratchFile;

const { migrate } = await import("../src/lib/db/migrations.ts");
const { createChatEngine } = await import("../src/features/chat/engine.ts");
const { describeChatResult } =
  await import("../src/features/chat/presentation.ts");
const { releaseDatabase } =
  await import("../src/features/shared/command-runtime.ts");

migrate(new Database(scratchFile));

/**
 * A second, independent handle used only for assertions and for resetting state.
 *
 * The engine's own connection is what writes. Keeping the reader separate means a test never
 * reads through the same handle that wrote, and it is the connection `releaseDatabase()` closes
 * when a test wants a genuine reload.
 */
let scratch = new Database(scratchFile);
scratch.pragma("foreign_keys = ON");

/**
 * Clears every table and re-seeds the same rows `npm run db:setup` would create.
 *
 * Resetting rather than making a new file is a consequence of the cached connection: one
 * handle, one file, and state restored between cases. Every assertion that compares state
 * before and after therefore sees a known baseline.
 */
function freshDatabase() {
  if (!scratch.open) {
    scratch = new Database(scratchFile);
    scratch.pragma("foreign_keys = ON");
  }

  scratch.exec(`
    DELETE FROM inventory_event;
    DELETE FROM expense;
    DELETE FROM inventory_item;
    DELETE FROM account;
  `);

  scratch
    .prepare(
      "INSERT INTO account (id, name, balance) VALUES (1, 'cash', 50000)",
    )
    .run();
  scratch
    .prepare(
      "INSERT INTO account (id, name, balance) VALUES (2, 'bank1', 100000)",
    )
    .run();
  scratch
    .prepare(
      "INSERT INTO inventory_item (id, name, quantity, unit, low_threshold) VALUES (1, 'onions', 10, 'piece', 2)",
    )
    .run();

  return scratch;
}

/**
 * Closes every connection to the temporary file, including the engine's cached one.
 *
 * `releaseDatabase()` is what makes the "survives a reload" assertion real: with the engine's
 * handle closed, the next command must re-open the file from disk, so a value that only ever
 * existed in memory would be gone.
 */
function closeDatabase() {
  releaseDatabase();
  if (scratch.open) {
    scratch.close();
  }
}

/**
 * The entire application-visible state, as one comparable string.
 *
 * Every table that a command can touch, plus the rows a command must not be able to add. A
 * refusal that inserted anything, changed anything, or deleted anything moves this string.
 */
function stateOf(database) {
  const parts = [];
  for (const table of [
    "account",
    "inventory_item",
    "inventory_event",
    "expense",
  ]) {
    const rows = database
      .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
      .all()
      .map((row) => JSON.stringify(row));
    parts.push(`${table}=[${rows.join(",")}]`);
  }

  return parts.join("|");
}

/**
 * A parser that returns a fixed proposal, standing in for the model.
 *
 * The application's contract with a parser is exactly this: a value, or a failure. Nothing
 * else about the model is assumed or needed.
 */
function parserReturning(value) {
  return { parse: () => Promise.resolve({ ok: true, value }) };
}

function parserFailing(error) {
  return { parse: () => Promise.resolve({ ok: false, error }) };
}

const CONSUME_PROPOSAL = {
  status: "interpreted",
  kind: "inventory.consume",
  itemName: "onions",
  amount: 2,
  unit: "piece",
};

const EXPENSE_PROPOSAL = {
  status: "interpreted",
  kind: "expense.record",
  item: "banana",
  amountRupees: 10,
  accountName: "cash",
};

// ---------------------------------------------------------------------------
console.log("\n# 28. 'used 2 onions' executes against real SQLite");

{
  const database = freshDatabase();
  const engine = createChatEngine(parserReturning(CONSUME_PROPOSAL));

  const result = await engine.interpret("used 2 onions");

  assertEqual(result.status, "applied", "28. the sentence is applied");
  assertEqual(
    result.status === "applied" && result.kind,
    "inventory.consume",
    "28. it was interpreted as a consumption",
  );
  assertEqual(
    database
      .prepare("SELECT quantity FROM inventory_item WHERE name = ?")
      .get("onions").quantity,
    8,
    "28. the stored quantity fell from 10 to 8",
  );
  const event = database
    .prepare("SELECT * FROM inventory_event ORDER BY id DESC LIMIT 1")
    .get();
  assertEqual(event.delta, -2, "28. an event row records the change");
  assertEqual(
    event.source_text,
    "used 2 onions",
    "28. the event records the sentence, so the change can be traced and corrected",
  );
  assert(
    typeof event.timestamp === "string" && event.timestamp.length > 0,
    "28. the timestamp came from the server clock",
  );

  closeDatabase();
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 29-30. 'bought banana 10 rupees cash', and the state survives a reload",
);

{
  const database = freshDatabase();
  const engine = createChatEngine(parserReturning(EXPENSE_PROPOSAL));

  const result = await engine.interpret("bought banana 10 rupees cash");

  assertEqual(result.status, "applied", "29. the sentence is applied");
  assertEqual(
    result.status === "applied" && result.kind,
    "expense.record",
    "29. it was interpreted as an expense",
  );
  assertEqual(
    database.prepare("SELECT balance FROM account WHERE name = ?").get("cash")
      .balance,
    49000,
    "29. the cash balance fell by exactly 1000 minor units, computed by the domain",
  );
  const expense = database
    .prepare("SELECT * FROM expense ORDER BY id DESC LIMIT 1")
    .get();
  assertEqual(
    expense.amount,
    1000,
    "29. the expense row stores whole minor units",
  );
  assertEqual(expense.item, "banana", "29. the row records what was bought");
  assertEqual(
    expense.account,
    1,
    "29. the row is linked to the resolved account",
  );
  assertEqual(
    expense.source_text ?? null,
    null,
    "29. the schema stores no source for expenses",
  );

  // "Survives a reload": close the handle, reopen the same file, and read again. Anything held
  // only in memory would be gone.
  const file = scratchFile;
  closeDatabase();

  const reopened = new Database(file, { readonly: true });
  assertEqual(
    reopened.prepare("SELECT balance FROM account WHERE name = ?").get("cash")
      .balance,
    49000,
    "30. the balance is still correct after the connection is closed and reopened",
  );
  assertEqual(
    reopened.prepare("SELECT COUNT(*) AS n FROM expense").get().n,
    1,
    "30. the expense row is still there after reload",
  );
  reopened.close();
  // Reopened for the next case; the cached handle is gone, so the engine will create a new one.
  freshDatabase();
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 31-34. nothing reaches the executor, and nothing mutates, on every refusal",
);

{
  const cases = [
    [
      "31. invalid parser output never reaches the executor",
      "an invented command kind",
      parserReturning({
        status: "interpreted",
        kind: "habit.log",
        item: "laundry",
      }),
    ],
    [
      "32. a parser failure produces no database mutation",
      "a provider HTTP error",
      parserFailing({
        kind: "unavailable",
        message: "The parsing service returned HTTP 500.",
      }),
    ],
    [
      "32. a missing API key produces no database mutation",
      "a missing credential",
      parserFailing({
        kind: "unconfigured",
        message: "OPENROUTER_API_KEY is not set.",
      }),
    ],
    [
      "33. a domain failure produces no database mutation",
      "more onions than exist",
      parserReturning({ ...CONSUME_PROPOSAL, amount: 999 }),
    ],
    [
      "33. an unknown item produces no database mutation",
      "an item that is not tracked",
      parserReturning({ ...CONSUME_PROPOSAL, itemName: "unicorns" }),
    ],
    [
      "31. malformed JSON is refused without mutating",
      "prose instead of JSON",
      parserReturning("I could not do that"),
    ],
    [
      "31. a markdown fence is refused without mutating",
      "fenced JSON",
      parserReturning(
        '```json\n{"status":"interpreted","kind":"inventory.consume"}\n```',
      ),
    ],
    [
      "31. a null response is refused without mutating",
      "a null proposal",
      parserReturning(null),
    ],
    [
      "31. an ambiguous sentence asks instead of guessing",
      "no quantity",
      parserReturning({ status: "needs_clarification", missing: ["quantity"] }),
    ],
    [
      "31. an unknown account is refused without mutating",
      "an account name that is not one of the three",
      parserReturning({ ...EXPENSE_PROPOSAL, accountName: "wallet" }),
    ],
  ];

  for (const [assertion, description, parser] of cases) {
    const database = freshDatabase();
    const before = stateOf(database);

    const result = await createChatEngine(parser).interpret("some sentence");

    assert(
      result.status !== "applied",
      `${assertion}: ${description} is not applied`,
    );
    assertEqual(
      stateOf(database),
      before,
      `${assertion}: ${description} changed no state`,
    );

    const message = describeChatResult(result);
    assert(
      message !== null && message.tone !== "ok",
      `${assertion}: ${description} is reported as a problem, not a success`,
    );
  }

  // One close for the whole loop: each case resets rather than reopens, because the engine's
  // cached connection is shared and closing it between cases would test nothing extra.
  closeDatabase();
}

{
  // A model that appends a forged balance, id, and timestamp must still have its *legitimate*
  // facts applied, and must not be able to influence any outcome by supplying them. Asserted
  // here rather than among the refusals because the correct behaviour is "the extras are
  // dropped and the real command runs", not "the command is rejected" — a proposal is not
  // invalid merely because it carries junk, and the junk is neutralised by the allowlist
  // rather than by a veto.
  const database = freshDatabase();
  const engine = createChatEngine(
    parserReturning({
      ...EXPENSE_PROPOSAL,
      balance: 100,
      id: 9,
      timestamp: "1999-01-01T00:00:00.000Z",
      accountId: 77,
      after: 1,
    }),
  );

  const result = await engine.interpret("bought banana 10 rupees cash");

  assertEqual(
    result.status,
    "applied",
    "31. the legitimate part of a proposal still executes",
  );
  assertEqual(
    database.prepare("SELECT balance FROM account WHERE name = ?").get("cash")
      .balance,
    49000,
    "31. the resulting balance is the domain's, not the forged 100 the model supplied",
  );
  const expense = database
    .prepare("SELECT * FROM expense ORDER BY id DESC LIMIT 1")
    .get();
  assertEqual(
    expense.account,
    1,
    "31. the account id came from the resolved row, not the model's 77",
  );
  assert(
    !expense.timestamp.startsWith("1999"),
    "31. the timestamp came from the server clock, not the model's",
  );
  assertEqual(
    database.prepare("SELECT COUNT(*) AS n FROM expense").get().n,
    1,
    "31. exactly one row was written, not a second invented one",
  );
  closeDatabase();
}

{
  // A domain failure is distinguishable from a parser failure, because they need different
  // fixes: one is a real-world impossibility, the other is a broken producer.
  freshDatabase();
  const domain = await createChatEngine(
    parserReturning({ ...CONSUME_PROPOSAL, amount: 999 }),
  ).interpret("used 999 onions");
  assertEqual(
    domain.status,
    "rejected",
    "33. a domain refusal is reported as rejected",
  );
  assert(
    domain.status === "rejected" && domain.token === "insufficient_inventory",
    "33. with the specific reason, so the user is told what is actually wrong",
  );

  const unavailable = await createChatEngine(
    parserFailing({ kind: "unavailable", message: "down" }),
  ).interpret("used 2 onions");
  assertEqual(
    unavailable.status,
    "unavailable",
    "32. a provider outage is reported as unavailable, a different problem",
  );
  closeDatabase();
}

// ---------------------------------------------------------------------------
console.log(
  "\n# 35. the user sees the real execution result, not the model's text",
);

{
  let database = freshDatabase();

  const consume = await createChatEngine(
    parserReturning(CONSUME_PROPOSAL),
  ).interpret("used 2 onions");
  assert(
    consume.status === "applied" &&
      consume.message === "Used 2 onions. Remaining: 8 piece.",
    "35. a consumption reports the real stored remainder",
  );

  // Each sub-case gets its own baseline. Sharing one would make the later assertions depend on
  // how much the earlier ones had already spent, which is how this test first failed while
  // reporting numbers that were correct for a different starting state.
  freshDatabase();
  const expense = await createChatEngine(
    parserReturning(EXPENSE_PROPOSAL),
  ).interpret("bought banana 10 rupees cash");
  assert(
    expense.status === "applied" &&
      expense.message ===
        "Bought banana for ₹10.00 using Cash. Cash balance: ₹490.00.",
    "35. an expense reports the amount and the real resulting balance",
  );

  // The decisive check: the number in the sentence came from the database, so it must follow
  // the database even when the model claims something different.
  freshDatabase();
  const lying = await createChatEngine(
    parserReturning({
      ...EXPENSE_PROPOSAL,
      balance: 1,
      message: "I have debited ₹10 from cash.",
    }),
  ).interpret("bought banana 10 rupees cash");
  assert(
    lying.status === "applied" && lying.message.includes("₹490.00"),
    "35. a model claiming a different balance cannot change what is displayed",
  );
  assert(
    lying.status === "applied" && !lying.message.includes("debited"),
    "35. the model's own prose is never shown as the outcome",
  );

  assertEqual(
    database.prepare("SELECT balance FROM account WHERE name = ?").get("cash")
      .balance,
    49000,
    "35. and the balance in the database is the one that was displayed",
  );

  closeDatabase();
}

// ---------------------------------------------------------------------------
console.log("\n# one sentence, one command");

{
  const database = freshDatabase();

  const batch = await createChatEngine(
    parserReturning([
      {
        status: "interpreted",
        kind: "inventory.consume",
        itemName: "onions",
        amount: 1,
        unit: "piece",
      },
      {
        status: "interpreted",
        kind: "expense.record",
        item: "rice",
        amountRupees: 5,
        accountName: "cash",
      },
    ]),
  ).interpret("used an onion and bought rice 5 rupees");
  assertEqual(
    batch.status,
    "unreadable",
    "a batch proposal is refused in Phase 2",
  );
  assertEqual(
    database
      .prepare("SELECT quantity FROM inventory_item WHERE name = ?")
      .get("onions").quantity,
    10,
    "and neither command in it was applied",
  );

  const blank = await createChatEngine(
    parserReturning(CONSUME_PROPOSAL),
  ).interpret("   ");
  assertEqual(
    blank.status,
    "empty",
    "an empty sentence is not sent to the parser at all",
  );
  assertEqual(
    database.prepare("SELECT COUNT(*) AS n FROM inventory_event").get().n,
    0,
    "and nothing was written for it",
  );

  closeDatabase();
}

// ---------------------------------------------------------------------------
console.log("\n# 36. the HTTP entry point behaves, not just the engine");

{
  // The engine was never the only thing to get right. Until this block existed, no test
  // touched the route at all, and a missing same-origin check shipped unnoticed because
  // nothing ever posted to it. The handlers are exercised directly with real `Request`
  // objects, which is what `next build` serves.
  const { POST, GET } = await import("../src/app/api/commands/parse/route.ts");

  // Earlier blocks closed the shared handle on their way out, and this one asserts on database
  // state, so it needs a live one and a known baseline.
  freshDatabase();

  const ORIGIN = "http://localhost:3000";
  // The encoding has to be explicit: a bare string body defaults to `text/plain`, which
  // `formData()` cannot read, and the route would then see an unreadable body rather than a form.
  const form = (body, headers = {}) =>
    new Request(`${ORIGIN}/api/commands/parse`, {
      method: "POST",
      body,
      headers: {
        origin: ORIGIN,
        host: "localhost:3000",
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
    });
  const json = (value, headers = {}) =>
    form(JSON.stringify(value), {
      "content-type": "application/json",
      ...headers,
    });
  const wantsJson = { accept: "application/json" };

  const get = await GET();
  assertEqual(get.status, 405, "36. GET is refused");
  assertEqual(get.headers.get("allow"), "POST", "36. and it advertises POST");

  // The gap: any page could post a form to localhost and have a command executed. There is no
  // cookie or session to protect the write, because V1 has no sign-in, so this is the guard.
  //
  // The `host` header below is deliberately *not* the host in the URL: that combination is
  // what `next start` produces for a request that really arrived at `127.0.0.1`, and a guard
  // that refuses the app's own users is worse than no guard.
  const foreign = await POST(
    form("text=bought banana 10 rupees cash", {
      origin: "https://evil.example",
    }),
  );
  assertEqual(foreign.status, 403, "36. a cross-origin submission is refused");
  assertEqual(
    scratch.prepare("SELECT COUNT(*) AS n FROM expense").get().n,
    0,
    "36. and nothing was written for it",
  );

  // A browser that reached the app by IP address sends an `Origin` naming that address, while
  // the reconstructed URL names the configured hostname. Both describe this app.
  const byAddress = new Request(`${ORIGIN}/api/commands/parse`, {
    method: "POST",
    body: "text=bought+banana",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/x-www-form-urlencoded",
    },
  });
  assertEqual(
    (await POST(byAddress)).status,
    303,
    "36. a browser that arrived by address is not mistaken for an attacker",
  );

  // No Origin at all is not cross-origin: non-browser clients do not send one.
  const noOrigin = new Request(`${ORIGIN}/api/commands/parse`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ text: "bought banana" }),
    // Node requires this to be set explicitly for a body-carrying Request.
    duplex: "half",
  });
  assertEqual(
    (await POST(noOrigin)).status,
    200,
    "36. a client that sends no Origin is not treated as an attacker",
  );

  const broken = await POST(
    form("{oops", { "content-type": "application/json", ...wantsJson }),
  );
  assertEqual(
    broken.status,
    400,
    "36. an unreadable JSON body is a bad request, not an empty sentence",
  );

  // Same rule for a form body: a caller that sent something unparseable gets told so.
  const brokenForm = await POST(
    new Request(`${ORIGIN}/api/commands/parse`, {
      method: "POST",
      body: "not a form",
      headers: { origin: ORIGIN, "content-type": "text/plain" },
    }),
  );
  assertEqual(
    brokenForm.status,
    400,
    "36. an unreadable form body is a bad request too",
  );

  const empty = await POST(json({ text: "   " }, wantsJson));
  const emptyBody = await empty.json();
  assertEqual(empty.status, 200, "36. an empty sentence is a quiet 200");
  assertEqual(
    emptyBody.ok,
    true,
    "36. and it uses the same envelope as every other answer",
  );
  assertEqual(
    emptyBody.result.status,
    "empty",
    "36. reporting an empty result",
  );

  const unconfigured = await POST(json({ text: "bought banana" }, wantsJson));
  const unconfiguredBody = await unconfigured.json();
  assertEqual(
    unconfigured.status,
    200,
    "36. a missing key is a working request that refused",
  );
  assertEqual(unconfiguredBody.ok, true, "36. `ok` reports the request worked");
  assertEqual(
    unconfiguredBody.result.status,
    "unconfigured",
    "36. while `result` reports the outcome",
  );

  // A form caller gets a redirect, and cannot be redirected off-site by the `next` parameter.
  const redirected = await POST(
    form("text=bought banana&next=https://evil.example/x"),
  );
  assertEqual(redirected.status, 303, "36. a form caller is redirected");
  assert(
    redirected.headers.get("location")?.startsWith(`${ORIGIN}/?`),
    "36. and an off-site `next` falls back to the default page",
  );
  assertEqual(
    new URL(redirected.headers.get("location")).host,
    "localhost:3000",
    "36. leaving the host untouched",
  );

  const toKitchen = await POST(form("text=bought banana&next=%2Fkitchen"));
  assert(
    toKitchen.headers.get("location")?.startsWith(`${ORIGIN}/kitchen?`),
    "36. a same-site `next` is honoured",
  );
  assert(
    !toKitchen.headers.get("location")?.includes("//evil"),
    "36. and stays a path, never protocol-relative",
  );
}

console.log("\n# 37. the provider, against a real HTTP server");

{
  // Every other block in this file injects a fake parser, which means the provider itself was
  // untested: nothing checked that the request it builds is the request OpenRouter expects, or
  // that a real HTTP failure becomes a value rather than an exception. Both matter, because
  // this is the only module that touches the credential and the network.
  //
  // A local stub stands in for OpenRouter. No key and no network are needed, and the requests
  // it receives are asserted directly, so the contract is checked rather than assumed.
  const { createOpenRouterParser } =
    await import("../src/features/chat/openrouter.ts");
  const { PARSER_INSTRUCTIONS } =
    await import("../src/commands/parser-prompt.ts");
  const { interpret } = await import("../src/commands/parser.ts");

  const requests = [];
  let reply = () => [200, { choices: [{ message: { content: "null" } }] }];

  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: raw === "" ? undefined : JSON.parse(raw),
      });
      const [status, payload] = reply();
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const SECRET = "sk-or-v1-do-not-log-this";
  const parser = createOpenRouterParser({
    apiKey: SECRET,
    model: "test/model",
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    timeoutMs: 2_000,
    appUrl: null,
    appTitle: null,
  });

  const completion = (content) => ({
    choices: [{ message: { content } }],
  });

  // A well-formed answer comes back as an unknown value, untouched.
  const proposal = {
    status: "interpreted",
    kind: "expense.record",
    item: "banana",
    amountRupees: 10,
    accountName: "cash",
  };
  reply = () => [200, completion(JSON.stringify(proposal))];
  const good = await parser.parse("bought banana 10 rupees cash");
  assertEqual(good.ok, true, "37. a well-formed completion is accepted");
  assertEqual(
    JSON.stringify(good.ok ? good.value : null),
    JSON.stringify(proposal),
    "37. and the proposal arrives unmodified",
  );

  // What was actually sent. Asserted, not assumed, because a wrong field name here would only
  // ever show up as a provider error in production.
  const sent = requests.at(-1);
  assertEqual(sent.method, "POST", "37. the provider posts");
  assertEqual(
    sent.url,
    "/api/v1/chat/completions",
    "37. to the completions endpoint",
  );
  assertEqual(
    sent.headers.authorization,
    `Bearer ${SECRET}`,
    "37. carrying the key as a bearer token",
  );
  assertEqual(sent.body.model, "test/model", "37. naming the configured model");
  assertEqual(
    sent.body.temperature,
    0,
    "37. at temperature zero, so parses are repeatable",
  );
  assertEqual(
    sent.body.response_format.type,
    "json_schema",
    "37. asking for a JSON schema",
  );
  assertEqual(
    sent.body.response_format.json_schema.strict,
    true,
    "37. strictly",
  );
  assertEqual(
    sent.body.messages.at(-1).content,
    "bought banana 10 rupees cash",
    "37. carrying the user's sentence",
  );
  assertEqual(
    sent.body.messages.at(0).content,
    PARSER_INSTRUCTIONS,
    "37. and the instructions",
  );
  assertEqual(
    sent.headers["http-referer"],
    undefined,
    "37. no attribution header when unconfigured",
  );
  assertEqual(sent.headers["x-title"], undefined, "37. and no title either");

  // Content that is not a proposal. The transport succeeded in every one of these cases — the
  // envelope was well-formed and OpenRouter answered — so `ok` stays true and the refusal is
  // made by `interpret`, which is the only layer that knows what a proposal is.
  for (const [label, content] of [
    ["prose", "Sure! I added that for you."],
    ["a fenced code block", '```json\n{"status":"interpreted"}\n```'],
    ["truncated JSON", '{"status":"interp'],
    ["an empty string", ""],
  ]) {
    reply = () => [200, completion(content)];
    const result = await parser.parse("bought banana 10 rupees cash");

    if (content === "") {
      // Nothing usable at all, which is a transport-level failure rather than a bad proposal.
      assertEqual(result.ok, false, `37. ${label} has nothing to read`);
      assertEqual(
        result.ok ? null : result.error.kind,
        "unreadable",
        `37. ${label} is reported as unreadable`,
      );
      continue;
    }

    assertEqual(
      result.ok,
      true,
      `37. ${label} is transported rather than guessed at`,
    );
    assertEqual(
      interpret(result.ok ? result.value : null, "bought banana 10 rupees cash")
        .kind,
      "unreadable",
      `37. and ${label} is refused by the interpretation layer`,
    );
  }

  // Valid JSON that is not a proposal. The provider is right to hand this over — it read a
  // response successfully — and `interpret` is right to refuse it. Asserting the pair together
  // is what matters: a shape check in the provider would put command knowledge in the transport,
  // and checking only `interpret` would leave the real question, "what happens when the model
  // answers with something perfectly valid JSON that means nothing", untested.
  for (const [label, content] of [
    ["a JSON array", "[1,2,3]"],
    ["a bare string", '"done"'],
    ["a number", "42"],
    ["an invented kind", '{"status":"interpreted","kind":"user.delete"}'],
    ["an object with no status", '{"kind":"expense.record"}'],
  ]) {
    reply = () => [200, completion(content)];
    const result = await parser.parse("bought banana 10 rupees cash");
    assertEqual(result.ok, true, `37. ${label} is transported successfully`);
    assertEqual(
      interpret(result.ok ? result.value : null, "bought banana 10 rupees cash")
        .kind,
      "unreadable",
      `37. and ${label} is refused by the interpretation layer`,
    );
  }

  // A response with no usable content at all.
  reply = () => [200, { choices: [] }];
  assertEqual(
    (await parser.parse("bought banana")).ok,
    false,
    "37. an empty choices array is refused",
  );

  // Transport failures are `unavailable`, distinct from `unreadable`, so the application can
  // tell the user to retry rather than to rephrase.
  for (const status of [400, 401, 402, 429, 500, 503]) {
    reply = () => [status, { error: "upstream said no" }];
    const result = await parser.parse("bought banana");
    assertEqual(
      result.ok ? null : result.error.kind,
      "unavailable",
      `37. HTTP ${status} is reported as unavailable`,
    );
    assert(
      !JSON.stringify(result).includes(SECRET),
      `37. HTTP ${status} does not put the key in the result`,
    );
  }

  // A provider that never answers is abandoned at the configured ceiling.
  const stalling = createOpenRouterParser({
    apiKey: SECRET,
    model: "test/model",
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    timeoutMs: 150,
    appUrl: null,
    appTitle: null,
  });
  server.removeAllListeners("request");
  server.on("request", (request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
    });
    // Never responds; the parser's own timeout must end the exchange.
    void response;
  });
  const started = Date.now();
  const timedOut = await stalling.parse("bought banana");
  const elapsed = Date.now() - started;
  assertEqual(
    timedOut.ok ? null : timedOut.error.kind,
    "unavailable",
    "37. a stalled provider is abandoned rather than waited on",
  );
  assert(elapsed < 3_000, `37. and it gave up promptly (took ${elapsed}ms)`);

  // An unreachable endpoint is a value, not a thrown error.
  const unreachable = createOpenRouterParser({
    apiKey: SECRET,
    model: "test/model",
    // Port 1 is reserved and refuses connections.
    baseUrl: "http://127.0.0.1:1/api/v1",
    timeoutMs: 2_000,
    appUrl: null,
    appTitle: null,
  });
  const dead = await unreachable.parse("bought banana");
  assertEqual(dead.ok, false, "37. an unreachable provider does not throw");
  assertEqual(
    dead.ok ? null : dead.error.kind,
    "unavailable",
    "37. it is reported as unavailable",
  );
  assert(
    !JSON.stringify(dead).includes(SECRET),
    "37. and the key never appears in the failure",
  );

  await new Promise((resolve) => server.close(resolve));
}

// ---------------------------------------------------------------------------
console.log("\n# local data safety");

assertEqual(
  fingerprint(developmentDatabase),
  developmentFingerprintBefore,
  "data/hari-os.db was not read-modified or written by any test in this file",
);

for (const dir of tempDirs) {
  fs.rmSync(dir, { recursive: true, force: true });
}

assertEqual(
  tempDirs.filter((dir) => fs.existsSync(dir)).length,
  0,
  "temporary databases were created and then removed",
);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
