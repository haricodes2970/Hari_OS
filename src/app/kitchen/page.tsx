/**
 * The Kitchen page: what is in stock, what is low, what changed, and how to fix it.
 *
 * A Server Component. Every number on this page was read from SQLite on the server, and every
 * change posted here goes to an endpoint that validates, computes in `src/domain`, and writes.
 * There is no kitchen state held here or in React, so the page cannot show a quantity the
 * database does not have.
 *
 * ## What each part is for
 *
 * - **Stock** is the answer to "what can I use", so quantity and unit lead.
 * - **Low stock** is the one thing the user cannot see by looking, so it is marked on the row
 *   rather than left for them to compare against a threshold themselves.
 * - **Threshold** sits beside the row because it is a per-item preference, not a global one.
 * - **History** exists so a wrong entry can be found. Every change has been stored since Phase
 *   1; this is where a user can finally see one.
 * - **Correction** sits on each history row, because the thing you want to fix is the thing you
 *   just read.
 *
 * The three `CommandForm`s and the `ChatInput` are unchanged from earlier phases. They are the
 * ways stock moves; the forms below are the ways an item is described.
 */
import { ChatInput } from "@/components/ChatInput";
import { CommandForm, type CommandField } from "@/components/CommandForm";
import { KitchenForm } from "@/components/KitchenForm";
import { Nav } from "@/components/Nav";
import { OutcomeBanner } from "@/components/OutcomeBanner";
import { parserAvailability } from "@/features/chat/runtime";
import { listKitchenHistory, listKitchenStock } from "@/features/kitchen/view";
import { listInventoryView } from "@/features/shared/queries";

export const metadata = { title: "Kitchen · Hari OS" };
export const dynamic = "force-dynamic";

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
    <>
      <Nav currentPath="/kitchen" />
      <ChatInput
        searchParams={searchParams}
        returnTo="/kitchen"
        available={parser.available}
        unavailableReason={parser.reason}
      />
      <h1>Kitchen</h1>
      <OutcomeBanner searchParams={searchParams} />

      <h2>In stock</h2>
      {stock.length === 0 ? (
        <p className="empty">
          Nothing is tracked yet. Add an item below, then use the sentence input
          or the forms to change stock as you cook. An empty kitchen is not an
          error.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Quantity</th>
              <th scope="col">Low-stock alert</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {stock.map((item) => (
              <tr
                key={item.id}
                className={item.lowStock ? "row-low" : undefined}
              >
                <th scope="row">{item.name}</th>
                <td>
                  {item.quantity} {item.unit}
                </td>
                <td>
                  <KitchenForm
                    operation="set_threshold"
                    compact
                    submitLabel="Set"
                    hidden={{ itemId: String(item.id) }}
                    fields={[
                      {
                        name: "lowThreshold",
                        label: `${item.name} alert at`,
                        kind: "number",
                        min: "0",
                        step: "any",
                        defaultValue:
                          item.lowThreshold === null
                            ? ""
                            : String(item.lowThreshold),
                        hint: "Leave empty for no alert.",
                      },
                    ]}
                  />
                </td>
                <td>
                  {item.lowStock ? (
                    <span className="badge badge-low">Low</span>
                  ) : item.lowThreshold === null ? (
                    <span className="muted">No alert set</span>
                  ) : (
                    <span className="badge badge-ok">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {lowStock.length === 0 ? null : (
        <p className="muted">
          {lowStock.length === 1
            ? "1 item is at or below its alert level and also shows on the Dashboard."
            : `${lowStock.length} items are at or below their alert level and also show on the Dashboard.`}
        </p>
      )}

      <h2>Change stock</h2>
      <div className="form-grid">
        <CommandForm
          kind="inventory.consume"
          returnTo="/kitchen"
          heading="Used some"
          submitLabel="Record use"
          fields={[ITEM, QUANTITY, UNIT]}
        />
        <CommandForm
          kind="inventory.restock"
          returnTo="/kitchen"
          heading="Bought some"
          submitLabel="Record restock"
          fields={[ITEM, QUANTITY, UNIT]}
        />
        <CommandForm
          kind="inventory.set_quantity"
          returnTo="/kitchen"
          heading="Counted what is left"
          submitLabel="Set quantity"
          fields={[ITEM, SET_QUANTITY]}
        />
      </div>

      <h2>Recent changes</h2>
      {history.length === 0 ? (
        <p className="empty">
          No stock has changed yet. Every use, restock, and count is recorded
          here, and any of them can be corrected.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Item</th>
              <th scope="col">Change</th>
              <th scope="col">From the sentence</th>
              <th scope="col">Correct</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.timestamp}</td>
                <td>{entry.itemName}</td>
                <td>{describeDelta(entry.delta, entry.unit)}</td>
                <td>
                  {entry.sourceText === null ? (
                    <span className="muted">—</span>
                  ) : entry.isCorrection ? (
                    <span className="muted">{entry.sourceText}</span>
                  ) : (
                    entry.sourceText
                  )}
                </td>
                <td>
                  {entry.delta === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <KitchenForm
                      operation="correct"
                      compact
                      submitLabel="Correct this"
                      hidden={{ eventId: String(entry.id) }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {history.length === 0 ? null : (
        <p className="muted">
          Correcting an entry adds an opposite change beside it. Nothing is
          deleted, so the log still shows what was recorded and what was
          corrected.
        </p>
      )}

      <h2>Set up an item</h2>
      {stock.length === 0 ? null : (
        <details className="setup">
          <summary>Rename an item or change its unit</summary>
          <p className="muted">
            A unit can only be changed once the item is empty. A count in one
            unit is not the same number in another, and this application does
            not convert between units.
          </p>
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
        </details>
      )}

      <KitchenForm
        operation="add_item"
        heading="Start tracking an item"
        submitLabel="Add item"
        fields={[
          { name: "name", label: "Name", kind: "text", placeholder: "onions" },
          {
            name: "quantity",
            label: "How many you have now",
            kind: "number",
            min: "0",
            step: "any",
            placeholder: "10",
          },
          { name: "unit", label: "Unit", kind: "text", placeholder: "pieces" },
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
    </>
  );
}
