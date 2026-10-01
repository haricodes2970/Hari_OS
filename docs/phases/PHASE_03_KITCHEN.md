# Phase 3 — Kitchen

**Status: Complete and verified**

Scope taken from `Hari_OS_V1_PRD.docx` section 6.3. This document does not expand it.

## Purpose

Make the contents of the kitchen visible, so meals can be decided from what is actually on
hand rather than from memory. One of the two highest-weighted V1 goals is cooking from known
stock.

## Scope

- **Inventory items** with a name, quantity, and unit. The PRD's examples are `onions: 8
  pieces` and `rice: kg`. Vegetarian context. PRD entity `inventory_item` (name, quantity,
  unit, low_threshold).
- **Sentence-based updates** once Phase 2 exists. "I had 10 onions, used 2" leaves 8
  remaining.
- **Deterministic quantity arithmetic.** Quantity changes are computed by code in
  `src/domain`. The LLM states the intent; it never performs the arithmetic.
- **An event log** for every change — PRD entity `inventory_event` records item, delta,
  timestamp, and source text. This is what makes a wrong entry correctable.
- **Low-stock thresholds** per item.
- **Dashboard integration**: items at or below their threshold appear as flags. In-app only
  for V1; no push notifications (out of scope per PRD section 6.6).
- **Stretch, explicitly not V1**: a "what can I cook with current stock" view. The PRD lists
  this as later work.

## Dependencies

- Phase 1 complete: schema and a working data path.
- Phase 2 for sentence-based updates. Until then, inventory changes go through ordinary
  application code.
- Phase 5 for dashboard flags. The flag logic can be built before the dashboard consumes it.

## Boundaries

- No recipe database, no external food service, no grocery delivery integration.
- No meal planning beyond what the PRD states.
- No automatic shopping list unless a later explicit decision adds one.
- Do not implement the stretch view in this phase; the PRD defers it.
- Quantity arithmetic never moves into SQL or into the command parser.
- In-app flags only. No notifications.

## Expected deliverables

- Kitchen feature slice under `src/features/kitchen/`.
- Schema for the inventory entities the phase actually needs.
- Quantity arithmetic as pure, testable functions in `src/domain`.
- A Kitchen page showing stored items and quantities, tolerating empty data.

## What was built

Delivered as one unit, because the domain rules, the event log, the correction path, and the
page that displays them are only meaningful together. Full detail in
`docs/sessions/2026-10-01-session-02.md`.

| Deliverable | Where |
| --- | --- |
| Kitchen slice | `src/features/kitchen/setup.ts`, `correction.ts`, `view.ts` |
| Arithmetic and rules | `src/domain/inventory.ts` — `recountAfterUse`, `setLowStockThreshold`, `editInventoryDetails`, `reverseInventoryEvent`, `findInventoryItemById` |
| The compound sentence | `inventory.recount_after_use`, added to the contract, validation, executor, and parser prompt |
| Persistence | `src/lib/db/repositories.ts` — item insert with an opening event, `findById`, `saveDetails`, `saveLowThreshold`, `findEvent`, `recentInventoryEvents` |
| Maintenance endpoint | `POST /api/kitchen` — a closed enum of four non-command operations, ADR-043 |
| Page | `/kitchen` with stock, low-stock thresholds, correction, and the history log |
| Tests | `npm run kitchen:test` — 153 assertions |

The schema already existed from micro-phase 1.1. **No migration was added in this phase**, and
`npm run db:check` still reports the same 11 V1 tables with no unexpected tables.

### Decisions recorded

- **ADR-043** — Kitchen setup operations get a third endpoint, and it cannot execute a command.
  This narrows ADR-036's "one entry point" claim rather than overriding it: there is still one
  path to the executor, and this route does not create another.
- **ADR-044** — A correction is a reversal, never a deletion or an overwrite.

### Two things deliberately not built

- **The "what can I cook with current stock" view.** The PRD lists it as later work. It is the
  reason this phase is not a meal planner.
- **A parsed sentence that creates an item.** Item creation goes through the form and the
  setup route. Inventing an LLM command kind for it was rejected as speculative: the PRD's
  sentence examples are all about *using* and *buying*, and a name plus a unit plus an opening
  count is a form, not a sentence.

## Verification

Every check below was run. Results are in the session report and in
`docs/project/PROJECT_STATUS.md`.

- Baseline suite passes — `format:check`, `typecheck`, `lint` (0 errors, 0 warnings), `build`,
  `db:check`.
- A real quantity change is applied, survives a restart, and shows the correct remaining
  quantity. Confirmed over HTTP against a disposable database.
- **The arithmetic is demonstrated as deterministic:** the same inputs produce the same output
  regardless of any model involvement. The functions are pure and in-memory, and no test
  involves a provider.
- An event-log entry exists for every change, carrying the sentence that caused it. Entries made
  from a form carry no sentence, which is why the history shows an em dash rather than inventing
  one.
- A wrong entry is demonstrated being corrected, and **the invariant holds: the stored quantity
  equals the sum of the deltas in the log.** A stale-snapshot reversal would break this.
- The low-stock flag appears at and below the threshold, and not above it. Confirmed on the
  Dashboard at 3 against a threshold of 3, and confirmed gone after restocking to 8.
- The page renders with no data and does not crash, for: no items, one item, none low, all low,
  and no history.
- `npm run db:check` passes with the expected tables.

## Status

**Complete and verified.** Delivered in the commit `feat(3): complete kitchen inventory`. The
one limitation carried forward is unchanged from Phase 2: no live provider call has been made,
so the sentence path is verified against a stub and not against the real model.
