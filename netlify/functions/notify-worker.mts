import type { Config } from "@netlify/functions";

import { consoleChannel, drainOnce } from "../../src/server/notifications";

/**
 * Drains the notification outbox.
 *
 * Scheduled rather than triggered by the write path on purpose. The task engine
 * writes an outbox row in the same statement as the state change and returns;
 * it never waits on a mail provider. That is what stops a Resend outage from
 * refusing a customer's task transition, and what stops a committed transition
 * from losing its notification when a send fails.
 *
 * Running every minute means a customer hears about their task within a minute
 * of it moving, which is well inside what anyone notices for email.
 *
 * Safe to overlap with itself: claims are leased, so a run that starts while
 * the previous one is still working picks up different rows rather than sending
 * the same messages twice.
 */
export default async function handler(): Promise<Response> {
  const started = Date.now();

  try {
    const result = await drainOnce(consoleChannel, 25);

    // Only speak up when there was something to do. A log line every minute
    // saying "nothing happened" is a log nobody reads when it matters.
    if (result.claimed > 0) {
      console.log(
        `[notify-worker] claimed=${result.claimed} sent=${result.sent} ` +
          `failed=${result.failed} in ${Date.now() - started}ms`,
      );
    }

    return Response.json(result);
  } catch (error) {
    // A thrown error here is an infrastructure problem, not a delivery problem:
    // nothing was claimed, so nothing is stranded and the next run retries.
    console.error("[notify-worker]", error);
    return Response.json({ error: "drain failed" }, { status: 500 });
  }
}

export const config: Config = {
  schedule: "* * * * *",
};
