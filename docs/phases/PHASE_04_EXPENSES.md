# Phase 4 — Expenses

**Status: Planned**

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

## Verification

- Baseline suite passes.
- A real expense reduces exactly the correct account, and the result is shown.
- **Determinism is demonstrated:** the balance change matches the deterministic code path
  exactly, independent of how the entry was phrased.
- Balances survive a restart.
- A wrong expense is demonstrated being corrected, with the balance returning to correct.
- The daily bill's total equals the sum of the day's entries, and its per-method breakdown
  reconciles with the total.
- Pages render with no accounts and no expenses, and do not crash.
- `npm run db:check` passes with the expected tables.

## Status

**Planned.** No expense code, no account schema, and no expenses page exist today.
