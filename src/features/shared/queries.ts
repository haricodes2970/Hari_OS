/**
 * Read-side helpers the pages use to show persisted state.
 *
 * Presentation, not business logic: these fetch rows, apply an existing domain rule where one
 * exists, and shape the result for rendering. No page queries the database directly, so
 * there is one place where "what does today's spend mean" is answered, and no component can
 * invent its own version of it.
 *
 * Low-stock is decided by the domain's own `isLowStock` rather than by a comparison written
 * here. Duplicating that rule in a view would be the first step towards two screens
 * disagreeing about whether the onions are low.
 *
 * Server-only.
 */
import "server-only";

import { isLowStock, type InventoryItem } from "@/domain/inventory";
import { formatMinorUnits, type MinorUnits } from "@/domain/money";

import { currentUtcDate, getRepositories } from "./command-runtime";

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

export type DashboardSummary = {
  readonly date: string;
  readonly lowStockItems: readonly InventoryView[];
  readonly inventoryCount: number;
  readonly todaySpend: MinorUnits;
  readonly formattedTodaySpend: string;
  readonly todayExpenseCount: number;
  readonly tasks: readonly { id: number; title: string; done: boolean }[];
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

export function readDashboardSummary(): DashboardSummary {
  const { display } = getRepositories();
  const date = currentUtcDate();
  const inventory = display.listInventory().map(toInventoryView);
  const spend = display.spendForDate(date);

  return {
    date,
    lowStockItems: inventory.filter((item) => item.lowStock),
    inventoryCount: inventory.length,
    todaySpend: spend.total,
    formattedTodaySpend: formatMinorUnits(spend.total),
    todayExpenseCount: spend.count,
    tasks: display.tasksForDate(date),
  };
}
