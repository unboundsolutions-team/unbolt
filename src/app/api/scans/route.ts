import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getAuthContext } from "@/server/auth-context";
import { kickScanWorker } from "@/server/scan/kick";
import { createScan, ScanRateLimitError } from "@/server/scan/service";
import { UnsafeTargetError } from "@/server/scan/target";
import { clientIdentifier, consumeRateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Start a scan.
 *
 * Returns immediately with an id; the audit itself runs in a background
 * function. That is not a nicety — §2.1 of the addendum: a synchronous Netlify
 * function times out at ~10s and a scan takes ~30s, so request/response is not
 * available. It also happens to be better UX than a thirty-second spinner.
 *
 * This endpoint is deliberately open to anonymous visitors: the scan is the
 * top-of-funnel lead magnet and putting it behind a signup would defeat it. The
 * protections are therefore in the input validation (see scan/target.ts — this
 * makes our servers fetch a URL a stranger chose) and the rate limit.
 */
const schema = z.object({
  url: z.string().min(1, "Enter your store's web address."),
  // Optional. The report is shown on screen regardless; an address is only for
  // sending a copy, and asking for one to see results would be a dark pattern.
  email: z.string().email().optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That request wasn't valid." },
      { status: 400 },
    );
  }

  // A ceiling on the CALLER, not just on the target. The per-target cap in
  // createScan stops one store being scanned repeatedly; this stops one person
  // scanning a thousand different stores through our infrastructure.
  const limited = await consumeRateLimit({
    kind: "scan",
    identifier: clientIdentifier(request.headers),
    limit: 10,
    windowSeconds: 600,
  });

  if (!limited.allowed) {
    return NextResponse.json(
      { error: "That's a lot of scans. Give it a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  // If the visitor happens to be signed in, attribute the scan — but never
  // require it, and never read an organisation from the request body.
  const ctx = await getAuthContext();

  try {
    const { scanId, targetUrl } = await createScan({
      rawUrl: parsed.data.url,
      organizationId: ctx?.organizationId,
      leadEmail: parsed.data.email,
    });

    // Best effort. The job is already durable in Postgres; this only decides
    // whether it starts now or on the next scheduled sweep.
    kickScanWorker(request.nextUrl.origin);

    return NextResponse.json({ id: scanId, targetUrl, status: "queued" }, { status: 202 });
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      // 400, not 403: from the visitor's side this is a bad address, and
      // distinguishing "blocked" from "invalid" tells a prober which of their
      // payloads got closest.
      return NextResponse.json({ error: error.publicMessage }, { status: 400 });
    }
    if (error instanceof ScanRateLimitError) {
      return NextResponse.json(
        { error: error.publicMessage },
        { status: 429, headers: { "Retry-After": "300" } },
      );
    }

    console.error("[POST /api/scans]", error);
    return NextResponse.json(
      { error: "We couldn't start that scan. Try again in a moment." },
      { status: 500 },
    );
  }
}
