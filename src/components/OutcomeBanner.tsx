/**
 * Renders the outcome of a form post, after a redirect.
 *
 * A Server Component, because it is finished rendering by the time it is sent — there is
 * nothing here to hydrate. It reads the outcome token from the query string that
 * `POST /api/commands` redirected with, which is what makes the failure visible on a page
 * load with no JavaScript at all.
 *
 * `describeOutcome` supplies the wording. This file decides nothing about what is valid; it
 * only displays what the executor already decided, and returns null when there is no
 * outcome to show, so an ordinary page visit renders nothing extra.
 */
import { describeOutcome } from "@/features/shared/outcomes";

export type OutcomeBannerProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The confirmation a successful write left in the query string.
 *
 * Rendered only when the endpoint also sent `saved=ok`, and only up to a fixed length. The text
 * is written by this application from a stored result, never by a model and never by the user,
 * so it is safe to display. The cap is belt and braces: a redirect is a place that ends up in
 * browser history, and nothing that long is worth keeping there.
 *
 * A failure never renders `msg`. Those are tokens expanded to fixed wording below, so no input
 * a user typed can reach the page through a URL.
 */
const MAX_MESSAGE = 300;

export async function OutcomeBanner({ searchParams }: OutcomeBannerProps) {
  const params = await searchParams;
  const error = single(params.err);

  if (error === null) {
    const saved = single(params.saved);
    const message = single(params.msg);

    if (saved !== "ok" || message === null || message.trim() === "") {
      return null;
    }

    return (
      <p className="outcome outcome-ok" role="status">
        {message.slice(0, MAX_MESSAGE)}
      </p>
    );
  }

  const message = describeOutcome(error, single(params.field));

  if (message === null) {
    return null;
  }

  return (
    <p
      className={`outcome outcome-${message.tone}`}
      role={message.tone === "error" ? "alert" : "status"}
    >
      <strong>{message.title}</strong> {message.detail}
    </p>
  );
}
