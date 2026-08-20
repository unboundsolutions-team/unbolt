import type { Config } from "@netlify/functions";

/**
 * Wakes the scan worker on a schedule.
 *
 * A Netlify function cannot be both background and scheduled — the background
 * runtime is what buys the 15-minute budget a scan needs, and scheduling is a
 * separate mechanism. So this is a tiny scheduled function whose only job is to
 * invoke the background one.
 *
 * ── Why this is not optional ────────────────────────────────────────
 * `POST /api/scans` kicks the worker directly, and that kick is deliberately
 * best-effort (see src/server/scan/kick.ts): the job is already durable in
 * Postgres before it fires, so a failed kick must not fail the request. This
 * sweep is what makes that trade safe. Without it, a kick that does not land
 * leaves a visitor polling a scan nobody will ever run.
 *
 * It also picks up work the kick could never have started: jobs whose lease
 * expired because a worker died mid-scan, and jobs backed off after a failure.
 *
 * Every two minutes rather than every minute — a scan takes ~30s and the worker
 * claims a small batch, so a tighter schedule just stacks invocations that find
 * nothing.
 */
export default async function handler(): Promise<Response> {
  const origin = process.env["URL"] ?? process.env["DEPLOY_PRIME_URL"];
  if (!origin) {
    console.error("[scan-sweeper] no site URL in the environment; cannot reach the worker.");
    return Response.json({ error: "no site url" }, { status: 500 });
  }

  const target = new URL("/.netlify/functions/scan-worker-background", origin).toString();

  try {
    // Background functions answer 202 immediately and keep running; there is
    // nothing to wait for beyond confirming the invocation was accepted.
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });

    return Response.json({ invoked: response.status });
  } catch (error) {
    console.error("[scan-sweeper] could not invoke the worker", error);
    return Response.json({ error: "invoke failed" }, { status: 500 });
  }
}

export const config: Config = {
  schedule: "*/2 * * * *",
};
