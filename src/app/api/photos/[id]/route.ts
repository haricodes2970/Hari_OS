/**
 * The photo route is `/api/photos/<id>/<filename>`, and this file is the other half of that path.
 *
 * `habit_log.photo_url` stores the URL with both parts — the row's id and the server-generated
 * filename — so a copied link keeps working and `loadPhoto` has something to check the request
 * against. This route exists so that `/api/photos/<id>` alone is not a half-formed URL that
 * answers with something confusing. It refuses, and says where the real one is.
 */
import { NextResponse } from "next/server";

/** Runs per request, so the route holds no state. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error:
        "A stored photo is read from /api/photos/<id>/<filename>, which is the URL recorded with the entry.",
    },
    { status: 405, headers: { allow: "GET" } },
  );
}
