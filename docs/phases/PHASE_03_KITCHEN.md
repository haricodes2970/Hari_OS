# Phase 3 — Kitchen

**Status: Planned**

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

## Verification

- Baseline suite passes.
- A real quantity change is applied, survives a restart, and shows the correct remaining
  quantity.
- **The arithmetic is demonstrated as deterministic:** the same inputs produce the same
  output regardless of any model involvement.
- An event-log entry exists for every change, carrying the sentence that caused it.
- A wrong entry is demonstrated being corrected.
- The low-stock flag appears at and below the threshold, and not above it.
- The page renders with no data and does not crash.
- `npm run db:check` passes with the expected tables.

## Status

**Planned.** No inventory code, no inventory schema, and no kitchen page exist today.
