/**
 * `POST /api/kitchen` — the Kitchen operations that are not commands.
 *
 * ## Why a third endpoint, and why it is narrow
 *
 * Two endpoints already exist and neither is replaced. `POST /api/commands` (ADR-036) takes an
 * already-shaped command and is still the only way to execute one. `POST /api/commands/parse`
 * (ADR-041) takes a sentence and converges on the same executor.
 *
 * This one handles only the operations that move no stock: starting to track an item, changing
 * a low-stock threshold, renaming an item, and correcting a logged entry. The reasoning is in
 * `src/features/kitchen/setup.ts` — a rename or a threshold is not a movement, so it has no
 * event to log and nothing for a sentence to state.
 *
 * A correction is included here only as a *form target*. The correction itself is built and
 * executed through `runCommand`, so a corrected entry is validated, computed by the domain,
 * and logged exactly like any other movement. This endpoint is not able to execute a command;
 * it can only ask the executor to.
 *
 * ## Why it cannot be reached from another site
 *
 * Same rule and same shared implementation as the parse route (ADR-042). This route writes, and
 * V1 has no session, so without the check any page the user had open could change the user's
 * kitchen. The guard is imported rather than copied so it cannot drift.
 *
 * ## The outcome is tokens, never text
 *
 * As on both other routes: a form cannot read a response body, so the answer is a `303` back
 * to `/kitchen` carrying an enum and a message written by this application. Nothing the user
 * typed is reflected into the URL except through fixed field names.
 *
 * Server-only.
 */
import { NextResponse } from "next/server";

import {
  addKitchenItem,
  changeLowThreshold,
  editKitchenItem,
} from "@/features/kitchen/setup";
import type { KitchenResult } from "@/features/kitchen/setup";
import { correctInventoryEntry } from "@/features/kitchen/correction";
import { isSameOriginRequest } from "@/features/shared/same-origin";

export const dynamic = "force-dynamic";

/** Every Kitchen write goes to this endpoint. */
const RETURN_PATH = "/kitchen";

/** The operations this endpoint performs. A closed set, like the command kinds. */
type KitchenOperation = "add_item" | "set_threshold" | "rename" | "correct";

const OPERATIONS: readonly KitchenOperation[] = [
  "add_item",
  "set_threshold",
  "rename",
  "correct",
];

/**
 * A quantity exactly as typed, refusing anything that is not recognisably a number.
 *
 * A loose `Number()` is the trap here: `Number("")` is `0`, so a blank box would silently
 * record "0 onions" and an empty threshold would become zero rather than "no threshold". A
 * form field is a person's typing, not a model's output, so the right response to something
 * unreadable is a refusal naming the field — not a value passed downstream to be interpreted.
 *
 * Unlike the command path, this does not forward the raw string for a validator to reject.
 * The domain functions below take a `Quantity`, so there is nothing downstream that could
 * safely receive one; the check belongs here, where the mistake can still be explained.
 */
const NUMERIC = /^-?\d+(\.\d+)?$/;

function readQuantity(
  raw: string,
  label: string,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: string } {
  if (!NUMERIC.test(raw)) {
    return {
      ok: false,
      error:
        raw === "" ? `${label} cannot be empty.` : `${label} must be a number.`,
    };
  }

  return { ok: true, value: Number(raw) };
}

/**
 * The id of the row a form is acting on.
 *
 * An id and not a name, because a name is editable: a form left open across a rename would
 * otherwise act on whatever item now carries that name.
 */
function readItemId(
  fields: ReadonlyMap<string, string>,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: string } {
  const raw = fields.get("itemId") ?? "";

  if (!/^\d+$/.test(raw)) {
    return { ok: false, error: "That item could not be identified." };
  }

  return { ok: true, value: Number(raw) };
}

/**
 * The low-stock threshold, where an empty field means "no threshold".
 *
 * Distinct from a quantity: an absent threshold is a real, meaningful state — it means the item
 * is never flagged — and the schema stores it as NULL. Zero is not the same thing and is
 * rejected by the domain as a threshold of zero, which would flag everything.
 */
function readThreshold(
  raw: string,
):
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly error: string } {
  if (raw === "") {
    return { ok: true, value: null };
  }

  const parsed = readQuantity(raw, "Low-stock alert");

  return parsed.ok ? { ok: true, value: parsed.value } : parsed;
}

function isOperation(value: string): value is KitchenOperation {
  return (OPERATIONS as readonly string[]).includes(value);
}

/** What every operation returns, so the redirect can render any of them the same way. */
type OperationResult =
  | { readonly ok: true; readonly message: string }
  | {
      readonly ok: false;
      /** A closed-set token, so a failure travels in a URL as an enum and never as prose. */
      readonly token: string;
      readonly error: string;
    };

/**
 * The outcome as query parameters.
 *
 * A success carries `saved=ok` and the sentence this application wrote from the stored result.
 *
 * A refusal carries only a token. The domain's own sentence is *not* reflected into the URL,
 * because it quotes the item name the user typed, and a redirect is a place where input should
 * not travel: it ends up in history, in a referrer, and in a screenshot. The token is one of a
 * fixed set, and `OutcomeBanner` expands it to the wording that already exists in
 * `features/shared/outcomes.ts`. The result is the same sentence the rest of the application
 * uses for the same failure, without putting user text in a URL.
 */
function outcomeQuery(result: OperationResult): URLSearchParams {
  const query = new URLSearchParams();

  if (result.ok) {
    query.set("saved", "ok");
    query.set("msg", result.message);
    return query;
  }

  query.set("err", result.token);

  return query;
}

/**
 * A structured result reduced to the one sentence the redirect carries.
 *
 * The executor's three failure kinds are kept apart by `tokenForError` elsewhere; here the
 * domain's own message is preferred because it names the real problem ("no item named
 * basil"), and a persistence failure falls back to a sentence that says the change was not
 * stored rather than echoing a driver's text into a URL.
 */
function flatten(result: KitchenResult): OperationResult {
  if (result.ok) {
    return { ok: true, message: result.message };
  }

  const error = result.error;

  return {
    ok: false,
    token: error.kind === "domain" ? error.error.code : "persistence_failed",
    error:
      error.kind === "domain"
        ? error.error.message
        : "That change could not be stored. Nothing was modified.",
  };
}

/**
 * Runs one operation.
 *
 * Split from the handler so the dispatch is a function of the form fields alone and can be
 * tested without constructing a request. Domain refusals are flattened to their own sentence
 * here, which is the only translation in this file.
 */
export function runKitchenOperation(
  fields: ReadonlyMap<string, string>,
): OperationResult {
  const operation = fields.get("operation") ?? "";

  if (!isOperation(operation)) {
    return {
      ok: false,
      token: "invalid_command",
      error: "That is not a Kitchen action.",
    };
  }

  if (operation === "add_item") {
    const amount = readQuantity(fields.get("quantity") ?? "", "Quantity");
    if (!amount.ok) {
      return { ...amount, token: "invalid_quantity" };
    }

    const alert = readThreshold(fields.get("lowThreshold") ?? "");
    if (!alert.ok) {
      return { ...alert, token: "invalid_quantity" };
    }

    return flatten(
      addKitchenItem({
        name: fields.get("name") ?? "",
        quantity: amount.value,
        unit: fields.get("unit") ?? "",
        lowThreshold: alert.value,
        sourceText: null,
      }),
    );
  }

  if (operation === "set_threshold") {
    const itemId = readItemId(fields);
    if (!itemId.ok) {
      return { ...itemId, token: "unknown_item" };
    }

    const alert = readThreshold(fields.get("lowThreshold") ?? "");
    if (!alert.ok) {
      return { ...alert, token: "invalid_quantity" };
    }

    return flatten(changeLowThreshold(itemId.value, alert.value));
  }

  if (operation === "rename") {
    const itemId = readItemId(fields);
    if (!itemId.ok) {
      return { ...itemId, token: "unknown_item" };
    }

    return flatten(
      editKitchenItem(itemId.value, {
        name: fields.get("name") ?? "",
        unit: fields.get("unit") ?? "",
      }),
    );
  }

  // Read like `readItemId` above, and for the same reason. `Number` alone is a reader that
  // guesses: `1e3` is 1000, `0x1f` is 31, an empty field is 0, and `  12  ` is 12 — so a
  // correction could be aimed at an entry the user did not name. A correction reverses a
  // movement, which is the last thing in this application to address loosely.
  const rawEventId = fields.get("eventId") ?? "";

  if (!/^\d+$/.test(rawEventId)) {
    return {
      ok: false,
      token: "unknown_item",
      error: "That entry could not be identified.",
    };
  }

  return correctInventoryEntry(Number(rawEventId));
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin submissions are not accepted." },
      { status: 403 },
    );
  }

  const form = await request.formData().catch(() => null);

  if (form === null) {
    return NextResponse.json(
      { error: "The request body was not readable." },
      { status: 400 },
    );
  }

  const fields = new Map<string, string>();

  for (const [key, value] of form.entries()) {
    if (typeof value === "string" && !fields.has(key)) {
      fields.set(key, value.trim());
    }
  }

  const result = runKitchenOperation(fields);

  return NextResponse.redirect(
    new URL(`${RETURN_PATH}?${outcomeQuery(result).toString()}`, request.url),
    { status: 303 },
  );
}

/** The Kitchen surface accepts writes only. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "Use POST to submit a Kitchen change." },
    { status: 405, headers: { allow: "POST" } },
  );
}
