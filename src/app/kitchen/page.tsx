/**
 * The Kitchen page: what is in stock, and the three ways to change that.
 *
 * A Server Component. It reads persisted state on the server and renders it; the only
 * interactive part is `CommandForm`, which submits to the endpoint. Nothing here can change
 * data, which is the point — a page that could both display and mutate state would make it
 * unclear which numbers came from where.
 */
import { ChatInput } from "@/components/ChatInput";
import { CommandForm, type CommandField } from "@/components/CommandForm";
import { Nav } from "@/components/Nav";
import { OutcomeBanner } from "@/components/OutcomeBanner";
import { parserAvailability } from "@/features/chat/runtime";
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
  placeholder: "count",
};

const SET_QUANTITY: CommandField = {
  name: "quantity",
  label: "New count",
  kind: "number",
  min: "0",
  step: "any",
};

export default function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const items = listInventoryView();
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
      {items.length === 0 ? (
        <p className="empty">
          Nothing is tracked yet. This page is empty until an item exists, and
          that is not an error.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Quantity</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className={item.lowStock ? "row-low" : undefined}
              >
                <th scope="row">{item.name}</th>
                <td>
                  {item.quantity} {item.unit}
                </td>
                <td>
                  {item.lowStock ? (
                    <span className="badge badge-low">
                      Low
                      {item.lowThreshold === null
                        ? ""
                        : ` (under ${item.lowThreshold})`}
                    </span>
                  ) : (
                    <span className="badge badge-ok">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
    </>
  );
}
