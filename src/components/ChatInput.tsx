/**
 * The shared natural-language input, present on every page.
 *
 * One component, used by Dashboard, Kitchen, and Expenses, because the PRD asks for a single
 * chat input rather than one per module. Three copies would drift, and a fix to the wording or
 * the fields would leave the other two behind.
 *
 * A Server Component with a plain `method="post"` form and no client JavaScript, matching the
 * structured `CommandForm` (ADR-037). The endpoint answers `303` back to the page with the
 * outcome as tokens, and this component renders it through `describeChatResult`. It behaves
 * identically with and without scripts, because there is only one path.
 *
 * It decides nothing. It collects a sentence, names the endpoint, and displays a message the
 * application produced. It cannot compute a balance, cannot claim an action succeeded, and has
 * no access to the provider, the database, or the clock.
 */
import {
  describeChatResult,
  type ChatResult,
} from "@/features/chat/presentation";

/** Query parameters, as `Next.js` supplies them. */
export type ChatInputProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
  /** Where the endpoint should return to. */
  readonly returnTo: string;
  /** False when no provider is configured, so the input can say so instead of failing. */
  readonly available: boolean;
  /** Present only to explain a missing configuration before anything is typed. */
  readonly unavailableReason: string | null;
};

const ENDPOINT = "/api/commands/parse";

/**
 * Facts a clarification may name, filtered on the way in.
 *
 * Anything else in the query string is discarded here and again in `presentation.ts`, so an
 * edited URL cannot introduce a phrase that gets rendered as a question.
 */
const MISSING: readonly string[] = [
  "itemName",
  "item",
  "quantity",
  "unit",
  "amount",
  "accountName",
];

function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Rebuilds the result from the URL.
 *
 * Every branch reads a token from a closed set and nothing else. The result is reconstructed
 * so that the same `ChatResult` the server produced drives the same wording, which is what
 * keeps the no-JavaScript path and the JSON path from saying different things about the same
 * outcome.
 */
function resultFromQuery(
  params: Record<string, string | string[] | undefined>,
): { result: ChatResult; said: string | null } {
  const said = single(params.said);
  const status = single(params.status);

  if (status === null) {
    return { result: { status: "empty" }, said: null };
  }

  const rawMissing = Array.isArray(params.missing) ? params.missing : [];
  const missing = MISSING.filter((fact) => rawMissing.includes(fact));

  const result: ChatResult =
    status === "applied"
      ? {
          status: "applied",
          kind: "expense.record",
          message: single(params.msg) ?? "",
        }
      : status === "needs_clarification"
        ? { status: "needs_clarification", missing }
        : status === "unsupported"
          ? { status: "unsupported" }
          : status === "unreadable"
            ? { status: "unreadable" }
            : status === "unconfigured" || status === "unavailable"
              ? {
                  status,
                  message: single(params.msg) ?? "The parser is unavailable.",
                }
              : {
                  status: "rejected",
                  token: single(params.token) ?? "invalid_command",
                  field: single(params.field),
                };

  return { result, said };
}

export async function ChatInput({
  searchParams,
  returnTo,
  available,
  unavailableReason,
}: ChatInputProps) {
  const params = await searchParams;
  const { result, said } = resultFromQuery(params);
  const message = describeChatResult(result);

  return (
    <section className="chat" aria-label="Natural language command">
      <form className="chat-form" method="post" action={ENDPOINT}>
        <input type="hidden" name="next" value={returnTo} />
        <label className="chat-label" htmlFor="chat-sentence">
          Tell me what happened
        </label>
        <div className="chat-row">
          <input
            id="chat-sentence"
            name="text"
            type="text"
            className="chat-input"
            placeholder="used 2 onions"
            maxLength={500}
            autoComplete="off"
            disabled={!available}
            required
          />
          <button type="submit" disabled={!available}>
            Record it
          </button>
        </div>
      </form>

      {available ? null : (
        <p className="outcome outcome-error" role="status">
          <strong>Parsing is not available.</strong> {unavailableReason}
        </p>
      )}

      {said === null ? null : (
        <p className="chat-echo">
          I read: <q>{said}</q>
        </p>
      )}

      {message === null ? null : (
        <p
          className={`outcome outcome-${message.tone === "warn" ? "warn" : message.tone}`}
          role={message.tone === "error" ? "alert" : "status"}
        >
          <strong>{message.title}</strong> {message.detail}
        </p>
      )}
    </section>
  );
}
