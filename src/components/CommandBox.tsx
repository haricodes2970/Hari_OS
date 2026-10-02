/**
 * The command box: the one place the user tells Hari OS what happened.
 *
 * ## It replaces the old `ChatInput`, and the endpoint is unchanged
 *
 * This posts to `/api/commands/parse` with the same field names and reads the same tokens back out
 * of the query string, so the command engine, the parser contract, and the redirect safety checks
 * are all untouched. What changed is the surface around them: the sentence field is now the largest
 * control on the page, and it sits directly under a title that says what it is for.
 *
 * ## There is no client JavaScript here, and the suggestion chips are why that matters
 *
 * A chip that filled the box on click would need a click handler. The obvious implementation — a
 * small client island holding a ref to the input — works, and it would be the first client state in
 * the whole data-entry path. It would also mean that with scripts blocked, unavailable, or still
 * loading, the chips would be buttons that do nothing at all: decorative controls that look
 * actionable and silently are not.
 *
 * So each chip is a link to this same page with the example in `?example=`, and this component
 * reads that back as the input's `defaultValue`. It works with scripting entirely disabled, it is
 * reachable by keyboard as a link, it costs one page load for an action that is not time-critical,
 * and — the part that actually matters — **it cannot record anything**. Every chip is a link to a
 * GET. There is no path by which pressing one changes a row, which is the only acceptable answer to
 * "what if the user presses the wrong one".
 *
 * The examples are examples. They prefill a box and nothing more; the sentence is still sent to the
 * existing parser, which decides what it means.
 */
import {
  describeChatResult,
  type ChatResult,
} from "@/features/chat/presentation";

/** Query parameters, as `Next.js` supplies them. */
export type CommandBoxProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
  /** Where the endpoint should return to. */
  readonly returnTo: string;
  /** False when no provider is configured, so the box can say so instead of failing. */
  readonly available: boolean;
  /** Present only to explain a missing configuration before anything is typed. */
  readonly unavailableReason: string | null;
  /** Hides the examples on pages where they would be noise. */
  readonly showExamples?: boolean;
};

const ENDPOINT = "/api/commands/parse";

/**
 * The examples, in the order of a day.
 *
 * Each one is a real sentence the parser already understands, spanning the modules a person might
 * be recording at any moment. They are chosen to be *varied* rather than to demonstrate the
 * system: four kitchen examples in a row would be a tutorial, and this is not a tutorial.
 */
const EXAMPLES: readonly string[] = [
  "I used 2 onions",
  "I bought milk for 40 rupees",
  "I slept at 11:30",
  "I finished cooking",
  "I did laundry",
] as const;

/**
 * Facts a clarification may name, filtered on the way in.
 *
 * Anything else in the query string is discarded here and again in `presentation.ts`, so an edited
 * URL cannot introduce a phrase that gets rendered as a question.
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
 * Every branch reads a token from a closed set and nothing else. The result is reconstructed so that
 * the same `ChatResult` the server produced drives the same wording, which is what keeps the
 * no-JavaScript path and the JSON path from saying different things about the same outcome.
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

/** The longest an example may be before it is ignored, matching the input's own limit. */
const MAX_EXAMPLE = 200;

export async function CommandBox({
  searchParams,
  returnTo,
  available,
  unavailableReason,
  showExamples = true,
}: CommandBoxProps) {
  const params = await searchParams;
  const { result, said } = resultFromQuery(params);
  const message = describeChatResult(result);

  // Only the page's own examples may prefill the box. Anything else in the URL — a crafted
  // `?example=`, or a link pasted from somewhere else — is ignored, because this value is not
  // submitted as a command, but a box pre-filled with someone else's sentence is still a box the
  // user might press send on believing it is their own.
  const requested = single(params.example);
  const prefilled =
    requested !== null &&
    requested.length > 0 &&
    requested.length <= MAX_EXAMPLE &&
    EXAMPLES.includes(requested)
      ? requested
      : null;

  return (
    <section
      className="command-shell command-shell-focus"
      aria-label="Natural language command"
    >
      <form className="command-form" method="post" action={ENDPOINT}>
        <input type="hidden" name="next" value={returnTo} />
        <label className="visually-hidden" htmlFor="chat-sentence">
          Tell Hari OS what you did, bought, used, or want to do
        </label>
        <span className="command-spark" aria-hidden="true">
          <SparkGlyph />
        </span>
        <input
          id="chat-sentence"
          name="text"
          type="text"
          className="command-input"
          placeholder="Tell me what you did, bought, used, or want to do..."
          defaultValue={prefilled ?? ""}
          maxLength={500}
          autoComplete="off"
          disabled={!available}
          required
        />
        <button className="command-send" type="submit" disabled={!available}>
          <span aria-hidden="true">→</span>
          <span className="visually-hidden">Record it</span>
        </button>
      </form>

      {showExamples && available ? (
        <div className="chips">
          <span className="chips-label" id="example-label">
            Try
          </span>
          {EXAMPLES.map((example) => (
            <a
              key={example}
              className="chip"
              href={`${returnTo}?example=${encodeURIComponent(example)}`}
              aria-describedby="example-label"
            >
              {example}
            </a>
          ))}
        </div>
      ) : null}

      {available ? null : (
        <p className="outcome outcome-warn" role="status">
          <strong>Parsing is not available.</strong> {unavailableReason}{" "}
          Everything else on this page still works — the structured forms below
          post the same commands.
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

/**
 * A four-point sparkle, drawn rather than imported.
 *
 * The application has no icon library, and a dependency added for one glyph would be a heavier
 * change than the glyph. It is `aria-hidden` at the call site: the input beside it carries the real
 * label, so this is decoration pointing at the box, not a second control.
 */
function SparkGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5l1.6 5.1 5.1 1.6-5.1 1.6L12 16l-1.6-5.2L5.3 9.2l5.1-1.6L12 2.5z" />
      <path d="M18.5 15l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4z" />
    </svg>
  );
}
