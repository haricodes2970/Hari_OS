/**
 * Read-side helpers the Kitchen page uses to show persisted stock.
 *
 * Presentation, not business logic: these fetch rows, apply an existing domain rule where one
 * exists, and shape the result for rendering. No page queries the database directly, so there is
 * one place where "what does this row mean" is answered, and no component can invent its own
 * version of it.
 *
 * Low-stock is decided by the domain's own `isLowStock` rather than by a comparison written
 * here. Duplicating that rule in a view would be the first step towards two screens disagreeing
 * about whether the onions are low.
 *
 * The Dashboard's own read model is `src/features/dashboard/view.ts`. It used to live here as
 * `readDashboardSummary`, and it moved out because the Dashboard composes several features'
 * projections rather than one: keeping it in `shared/` made a second, parallel definition of "what
 * the dashboard shows" possible, and two would be able to disagree. The one definition is now in
 * the feature that owns the screen.
 *
 * Server-only.
 */
import "server-only";

import { isLowStock, type InventoryItem } from "@/domain/inventory";
import { formatMinorUnits, type MinorUnits } from "@/domain/money";

import { getRepositories } from "./command-runtime.ts";

/** One inventory line as the Kitchen page needs it. */
export type InventoryView = {
  readonly id: number;
  readonly name: string;
  readonly quantity: number;
  readonly unit: string;
  readonly lowStock: boolean;
  readonly lowThreshold: number | null;
};

/** One account line as the Expenses page needs it. */
export type AccountView = {
  readonly id: number;
  readonly name: string;
  readonly balance: MinorUnits;
  /** Pre-formatted, so no view has to invent a way to show money. */
  readonly formattedBalance: string;
};

export type ExpenseView = {
  readonly timestamp: string;
  readonly item: string;
  readonly formattedAmount: string;
  readonly accountName: string;
  readonly category: string | null;
};

function toInventoryView(item: InventoryItem): InventoryView {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    lowStock: isLowStock(item),
    lowThreshold: item.lowThreshold,
  };
}

export function listInventoryView(): InventoryView[] {
  return getRepositories().display.listInventory().map(toInventoryView);
}

export function listAccountViews(): AccountView[] {
  return getRepositories()
    .display.listAccounts()
    .map((account) => ({
      id: account.id,
      name: account.name,
      balance: account.balance,
      formattedBalance: formatMinorUnits(account.balance),
    }));
}

export function listRecentExpenses(limit = 10): ExpenseView[] {
  return getRepositories()
    .display.recentExpenses(limit)
    .map((expense) => ({
      timestamp: expense.timestamp,
      item: expense.item,
      formattedAmount: formatMinorUnits(expense.amount),
      accountName: expense.accountName,
      category: expense.category,
    }));
}
