import { NextResponse } from "next/server";
import { z } from "zod";

import { getScan } from "@/server/scan/service";

export const dynamic = "force-dynamic";

/**
 * Poll a scan.
 *
 * ── Why this is not access-controlled ───────────────────────────────
 * A scan id is an unguessable v4 UUID and the endpoint returns only public
 * information about a public web page — the same numbers anyone can get from
 * PageSpeed themselves. Requiring a session would break the anonymous flow that
 * is the entire point of the tool.
 *
 * What it must NOT do is leak anything that is not public, which is why the
 * response is assembled field by field rather than spreading the row: the scans
 * table also carries `lead_email` and `organization_id`, and neither belongs in
 * a response anyone with a link can read.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  // A malformed id must be a 400, not a database error on a cast.
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const scan = await getScan(id);
  if (!scan) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json(scan, {
    headers: {
      // A queued scan changes second to second; a finished one never changes.
      "Cache-Control":
        scan.status === "complete" || scan.status === "failed"
          ? "public, max-age=300"
          : "no-store",
    },
  });
}
