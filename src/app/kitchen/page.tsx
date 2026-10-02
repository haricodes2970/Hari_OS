/**
 * The Kitchen page: what is in stock, what is low, what changed, and how to fix it.
 *
 * A Server Component. Every number on this page was read from SQLite on the server, and every
 * change posted here goes to an endpoint that validates, computes in `src/domain`, and writes.
 * There is no kitchen state held here or in React, so the page cannot show a quantity the
 * database does not have.
 *
 * ## Inventory is a list, not a table, on a phone
 *
 * The stock rows are marked up as a list with a data label on each value, so at 320px a row reads
 * as `Onions · 10 piece · OK` rather than as a four-column table that has to scroll sideways. At
 * wider widths the same rows become a grid. One piece of markup, both layouts — which is why there
 * is no mobile variant of this page to keep in step with the desktop one.
 *
 * ## What each part is for
 *
 * - **Summary** answers "is anything wrong" before the user reads a single row.
 * - **Stock** is the answer to "what can I use", so quantity and unit lead.
 * - **Low stock** is the one thing the user cannot see by looking, so it is marked on the row
 *   rather than left for them to compare against a threshold themselves.
 * - **History** exists so a wrong entry can be found. Every change has been stored since Phase 1;
 *   this is where a user can finally see one.
 * - **Correction** sits on each history row, because the thing you want to fix is the thing you
 *   just read.
 *
 * The forms and the command box are the ways stock moves and the ways an item is described. Both
 * post to existing endpoints; nothing here parses a sentence.
 */
import { CommandBox } from "@/components/CommandBox";
import { CommandForm, type CommandField } from "@/components/CommandForm";
import { KitchenForm } from "@/components/KitchenForm";
import { OutcomeBanner } from "@/components/OutcomeBanner";
import {
  Card,
  CardGrid,
  Empty,
  PageHeader,
  Section,
  Stat,
  Status,
} from "@/components/ui";
import { parserAvailability } from "@/features/chat/runtime";
import { listKitchenHistory, listKitchenStock } from "@/features/kitchen/view";
import { listInventoryView } from "@/features/shared/queries";

export const metadata = { title: "Kitchen · Hari OS" };
export const dynamic = "force-dynamic";

const RETURN_TO = "/kitchen";

const ITEM: CommandField = {
  name: "itemName",
  label: "Item",
  kind: "text",
  placeholder: "onion",
};

const QUANTITY: CommandField = {
  name: "amount",
  label: "Quantity",
  kind: "number",
  min: "0",
  step: "any",
};

const UNIT: CommandField = {
  name: "unit",
  label: "Unit",
  kind: "text",
  placeholder: "piece",
};

const SET_QUANTITY: CommandField = {
  name: "quantity",
  label: "New count",
  kind: "number",
  min: "0",
  step: "any",
};

/** How a movement reads in the history list. Signed, because the sign is the meaning. */
function describeDelta(delta: number, unit: string): string {
  const amount = Math.abs(delta);

  if (amount === 0) {
    return "no change";
  }

  return `${delta > 0 ? "+" : "−"}${amount}${unit === "" ? "" : ` ${unit}`}`;
}

/** A row's own inline threshold editor. Kept here so the list markup stays readable. */
function ThresholdControl({
  id,
  name,
  threshold,
}: {
  readonly id: number;
  readonly name: string;
  readonly threshold: number | null;
}) {
  return (
    <KitchenForm
      operation="set_threshold"
      compact
      submitLabel="Set"
      hidden={{ itemId: String(id) }}
      fields={[
        {
          name: "lowThreshold",
          label: `${name} alert at`,
          kind: "number",
          min: "0",
          step: "any",
          defaultValue: threshold === null ? "" : String(threshold),
          hint: "Leave empty for no alert.",
        },
      ]}
    />
  );
}

export default function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const stock = listKitchenStock();
  const history = listKitchenHistory();
  // Read through the same projection the Dashboard uses, so the two cannot disagree.
  const lowStock = listInventoryView().filter((item) => item.lowStock);
  const parser = parserAvailability();

  return (
    <div className="page">
      <PageHeader
        title="Kitchen"
        description="What is in stock, what is running low, and everything that has changed. Say it in a sentence or use the forms."
      />

      <CommandBox
        searchParams={searchParams}
        returnTo={RETURN_TO}
        available={parser.available}
        unavailableReason={parser.reason}
      />

      <OutcomeBanner searchParams={searchParams} />

      <Section title="Overview">
        <CardGrid>
          <Card title="Items tracked">
            <Stat label="In stock" value={String(stock.length)} size="sm" />
          </Card>
          <Card title="Running low">
            <Stat
              label="Below alert level"
              value={String(lowStock.length)}
              tone={lowStock.length > 0 ? "negative" : "default"}
              size="sm"
              note={
                lowStock.length === 0
                  ? stock.length === 0
                    ? "Nothing is tracked yet, so nothing can run low."
                    : "Every tracked item is above its alert level."
                  : `${lowStock.length === 1 ? "1 item is" : `${lowStock.length} items are`} at or below the alert level, and also shown on the Dashboard.`
              }
            />
          </Card>
        </CardGrid>
      </Section>

      <Section
        title="In stock"
        description="Quantity is what you can use. The alert level is yours, per item."
      >
        {stock.length === 0 ? (
          <Empty>
            Nothing is tracked yet. Add an item below, then use the sentence
            input or the forms to change stock as you cook. An empty kitchen is
            not an error.
          </Empty>
        ) : (
          <ul className="row-list">
            {stock.map((item) => (
              <li
                key={item.id}
                className={item.lowStock ? "row row-warn" : undefined}
              >
                <div className="row-main">
                  <span className="row-title">{item.name}</span>
                  <span className="meta">
                    {item.quantity} {item.unit}
                    {item.lowThreshold === null
                      ? " · no alert set"
                      : ` · alert at ${item.lowThreshold}`}
                  </span>
                </div>
                <div className="row-aside">
                  {item.lowStock ? (
                    <Status tone="warning">Low</Status>
                  ) : item.lowThreshold === null ? (
                    <Status>No alert set</Status>
                  ) : (
                    <Status tone="positive">OK</Status>
                  )}
                  <ThresholdControl
                    id={item.id}
                    name={item.name}
                    threshold={item.lowThreshold}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Change stock"
        description="Three ways to move a number, all of them posting the same commands the sentence input uses."
      >
        <div className="form-grid">
          <CommandForm
            kind="inventory.consume"
            returnTo={RETURN_TO}
            heading="Used some"
            submitLabel="Record use"
            fields={[ITEM, QUANTITY, UNIT]}
          />
          <CommandForm
            kind="inventory.restock"
            returnTo={RETURN_TO}
            heading="Bought some"
            submitLabel="Record restock"
            fields={[ITEM, QUANTITY, UNIT]}
          />
          <CommandForm
            kind="inventory.set_quantity"
            returnTo={RETURN_TO}
            heading="Counted what is left"
            submitLabel="Set quantity"
            fields={[ITEM, SET_QUANTITY]}
          />
        </div>
      </Section>

      <Section
        title="Recent changes"
        description="Every movement, newest first. Anything here can be corrected."
      >
        {history.length === 0 ? (
          <Empty>
            No stock has changed yet. Every use, restock, and count is recorded
            here, and any of them can be corrected.
          </Empty>
        ) : (
          <>
            <ul className="row-list">
              {history.map((entry) => (
                <li key={entry.id} className="row">
                  <div className="row-main">
                    <span className="row-title">
                      {entry.itemName}{" "}
                      <span className="figure">
                        {describeDelta(entry.delta, entry.unit)}
                      </span>
                    </span>
                    <span className="meta">
                      {entry.timestamp.slice(0, 16).replace("T", " ")}
                      {entry.sourceText === null
                        ? ""
                        : ` · “${entry.sourceText}”`}
                    </span>
                  </div>
                  <div className="row-aside">
                    {entry.delta === 0 ? null : (
                      <KitchenForm
                        operation="correct"
                        compact
                        submitLabel="Correct this"
                        hidden={{ eventId: String(entry.id) }}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="meta">
              Correcting an entry adds an opposite change beside it. Nothing is
              deleted, so the log still shows what was recorded and what was
              corrected.
            </p>
          </>
        )}
      </Section>

      <Section title="Add an item">
        <Card>
          <KitchenForm
            operation="add_item"
            submitLabel="Add item"
            fields={[
              {
                name: "name",
                label: "Name",
                kind: "text",
                placeholder: "onions",
              },
              {
                name: "quantity",
                label: "How many you have now",
                kind: "number",
                min: "0",
                step: "any",
                placeholder: "10",
              },
              {
                name: "unit",
                label: "Unit",
                kind: "text",
                placeholder: "pieces",
              },
              {
                name: "lowThreshold",
                label: "Low-stock alert",
                kind: "number",
                min: "0",
                step: "any",
                hint: "Optional. Leave empty for no alert.",
              },
            ]}
          />
        </Card>

        {/*
          Editing an item's name or unit is rare and should not push stock off the screen, while
          adding the first item must not be hidden — so this one is behind a disclosure.
        */}
        {stock.length === 0 ? null : (
          <details className="setup">
            <summary>Rename an item or change its unit</summary>
            <p className="muted">
              A unit can only be changed once the item is empty. A count in one
              unit is not the same number in another, and this application does
              not convert between units.
            </p>
            <div className="setup-body">
              {stock.map((item) => (
                <KitchenForm
                  key={item.id}
                  operation="rename"
                  submitLabel={`Save ${item.name}`}
                  heading={item.name}
                  hidden={{ itemId: String(item.id) }}
                  fields={[
                    {
                      name: "name",
                      label: "Name",
                      kind: "text",
                      defaultValue: item.name,
                    },
                    {
                      name: "unit",
                      label: "Unit",
                      kind: "text",
                      defaultValue: item.unit,
                    },
                  ]}
                />
              ))}
            </div>
          </details>
        )}
      </Section>
    </div>
  );
}
