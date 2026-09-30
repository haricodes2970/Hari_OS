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

export async function OutcomeBanner({ searchParams }: OutcomeBannerProps) {
  const params = await searchParams;
  const message = describeOutcome(single(params.err), single(params.field));

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
