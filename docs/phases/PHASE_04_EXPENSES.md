# Phase 4 — Expenses

**Status: Complete and verified**

Scope taken from `Hari_OS_V1_PRD.docx` section 6.4. This document does not expand it.

## Purpose

Make money state visible and correct. Balances must always be exactly right, which is why
balance arithmetic is the strictest determinism requirement in the project.

## Scope

- **Three accounts**, set manually at the start: cash, bank account 1, bank account 2. PRD
  entities `account` (name, balance) and `expense` (timestamp, item, amount, account,
  category optional).
- **Sentence-based expense entry** once Phase 2 exists. "bought banana 10 rupees cash" is
  the PRD's own example.
- **Deterministic balance changes.** The PRD's example: 500 in cash minus 10 leaves 490.
  The balance change is computed in `src/domain` by ordinary code, never by the LLM
  (PRD principles 11 and 12).
- **Expense history**, each entry stored with a timestamp.
- **A daily bill**: total spent, with a breakdown by item and by payment method, rendered
  as shareable text. The PRD's stated purpose is sending it to the user's father.
- **Batch entry**, supported. The PRD notes real-time logging is the priority and batch
  entry is a later addition within the same module.

## Dependencies

- Phase 1 complete: schema and a working data path.
- Phase 2 for sentence entry. Direct application code entry is acceptable before then.
- Phase 5 for the dashboard's "today's spend" figure.

## Boundaries

- **No payment providers, bank integrations, card readers, or any external financial
  service.** Accounts are balances maintained by the user.
- No budgeting advice, categorisation rules, or spending recommendations. The PRD marks
  auto-categorisation as later work.
- No currency conversion or multi-currency support.
- Balance arithmetic never moves into SQL or into the command parser.
- The assistant surfaces figures; it does not decide spending.

## Expected deliverables

- Expenses feature slice under `src/features/expenses/`.
- Schema for `account` and `expense`.
- Balance arithmetic as pure, testable functions in `src/domain`.
- An expenses page showing balances and history, tolerating empty data.
- The daily-bill view with breakdown and copyable text.

## What was built

Delivered as one unit. Full detail in `docs/sessions/2026-10-01-session-02.md`.

Most of the foundation already existed and was **kept**, not rebuilt: Phase 1 wrote the money
domain, the closed three-account model, the `expense.record` contract, and an atomic executor;
Phase 2 wrote the parser. Phase 4 added what was genuinely missing and verified the rest rather
than assuming it.

| Deliverable | Where | New or verified |
| --- | --- | --- |
| Daily-bill aggregation | `src/domain/expenses.ts` | New |
| Expenses slice | `src/features/expenses/view.ts`, `bill.ts` | New |
| Shareable bill | `GET /expenses/daily-bill` (`text/plain`) | New |
| Page: totals, breakdown, bill link | `src/app/expenses/page.tsx` | Extended |
| A day's rows | `display.expensesForDate(date)` | New |
| Money, accounts, execution | `money.ts`, `accounts.ts`, `executor.ts` | Verified, unchanged |
| Tests | `npm run expenses:test` — 257 assertions | New |

**No migration was added.** The `account` and `expense` tables arrived in micro-phase 1.1 and
`npm run db:check` is unchanged: the same 11 V1 tables, no unexpected tables.

### Two decisions recorded

- **ADR-045** — `POST /api/commands` gets the origin check ADR-042 intended. It never had one, and
  from this phase it is the endpoint that spends money.
- **ADR-046** — the documented architecture boundaries were not being enforced, because later
  ESLint configs silently replaced earlier ones for the same rule. Fixed, and now probed.

### What was deliberately not built

- **Expense correction and refunds.** The PRD does ask for wrong entries to be "easy to undo"
  (section 7), and section 6.4 lists correction in its verification criteria. It cannot be done
  honestly without a schema change: `expense.amount` has `CHECK (amount >= 0)` and there is no
  `source_text`, so a reversal has nowhere to live. Phase 4 assessed the options and **deferred**,
  because no refund model was requested and inventing an accounting system is not this phase's
  job. The Expenses page says so, so the absence is visible rather than looking like an oversight.
  **Expense correction/refund remains deferred because the current ledger models non-negative
  spend entries.**
- **Batch entry.** The PRD contradicts itself: section 6.4 says "Batch entry supported" while
  section 5 says "Expenses may be logged in a batch later; real-time logging is optional", and
  Phase 2's accepted ADR commits to one sentence, one command. Deferred, and recorded rather than
  quietly resolved.
- **Setting an opening balance.** Accounts open at zero via `npm run db:setup`, which is the PRD's
  "set manually at the start". An account still reads `₹0.00` until money moves through it.

## Verification

- Baseline suite passes — `format:check`, `typecheck`, `lint` (0 errors, 0 warnings), `build`,
  `db:check`.
- A real expense reduces exactly the correct account, and the result is shown. Confirmed over HTTP:
  cash, bank1, and bank2 each changed only for its own spend, verified from persisted rows.
- **Determinism is demonstrated:** the balance change matches the deterministic code path exactly,
  independent of how the entry was phrased. The same ledger produces byte-identical bill text.
- Balances survive a reload, confirmed over HTTP.
- The daily bill's total equals the sum of the day's entries, and both breakdowns reconcile with
  it. Asserted against the aggregate query as well as against the domain.
- Pages render with no accounts, with no expenses, and with accounts at zero, and do not crash.
- `npm run db:check` passes with the expected tables.

### The two verifications this phase was really about

- **Account resolution is exact.** `bank2` cannot resolve to `bank1` or to `cash`, a near-miss like
  `bank` or `c` resolves to nothing, and a lookup for an account that does not exist fails instead
  of matching a real row. The Phase 1 bug where a requested name was attached to every returned row
  has explicit regression coverage, including the harder case of a partial ledger.
- **A refused expense changes nothing.** Proven with real SQLite triggers: blocking the expense
  insert rolls back the balance, and blocking the balance update rolls back the insert that preceded
  it.

### Correction is not verified, because it does not exist

This document previously listed "a wrong expense is demonstrated being corrected" as a
verification item. That item is **not met**, and cannot be without the migration described above.
It is recorded as deferred rather than quietly dropped.

## Status

**Complete and verified**, with one scope item deferred by explicit decision. The limitation
carried forward from earlier phases is unchanged: no live provider call has been made, so the
sentence path is verified against a stub and not against a real model.
