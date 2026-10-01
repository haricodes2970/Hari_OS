/**
 * `GET /expenses/daily-bill` — today's bill as plain text.
 *
 * ## Why a route rather than a copy button
 *
 * The PRD wants a bill "as shareable text to send to his father", and the rest of this
 * application works with no client-side JavaScript at all (ADR-037). A copy button needs
 * JavaScript, and adding the first client component to the project to save three keystrokes would
 * be a poor trade. A plain-text document can be selected, copied, saved, or opened in any mail
 * app, and it works with scripting disabled — which is the same reason the expense form posts
 * straight to an endpoint.
 *
 * Native sharing is left as a possible later enhancement. If it is ever added, the content stays
 * exactly what is below: the browser would pass the same string to the share sheet, and nothing
 * about that string would come from a model.
 *
 * ## Read-only, so it is not a write endpoint
 *
 * This only reads persisted rows and renders them. It changes nothing, so it needs no origin
 * guard — ADR-042's check protects writes. It is also not a second way to execute a command: the
 * only path to the executor is unchanged.
 *
 * Server-only.
 */
import { currentUtcDate } from "@/features/shared/command-runtime";
import { readDailyBill } from "@/features/expenses/view";

export const dynamic = "force-dynamic";

/** Shown when the domain refuses to total the day. Never a fake zero. */
const UNCOMPUTED =
  "Hari OS daily bill\n\nToday's bill could not be computed from the recorded entries.\n";

export async function GET(): Promise<Response> {
  const bill = readDailyBill(currentUtcDate());

  return new Response(bill === null ? UNCOMPUTED : bill.text, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // A bill is a snapshot of a moment; the browser must not show a stale one from a cache.
      "cache-control": "no-store",
    },
  });
}
