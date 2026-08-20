import { claimJobs, completeJob, failJob, isTerminal, type Job } from "../../src/server/jobs";
import { loadProvider } from "../../src/server/scan/provider";
import { runScan, SCAN_JOB_KIND } from "../../src/server/scan/service";

/**
 * The Store Health Scan worker.
 *
 * A **background** function (the `-background` suffix is what tells Netlify),
 * so it gets up to 15 minutes instead of the ~10s a synchronous function has.
 * A scan takes roughly 30 seconds, which is why the addendum made this the
 * architecture rather than a request/response endpoint.
 *
 * Invoked two ways, deliberately:
 *  - fire-and-forget after `POST /api/scans`, so a visitor's scan starts now
 *  - on a schedule, which sweeps anything that was queued while a worker was
 *    cold, failed mid-flight, or had its lease expire
 *
 * Both paths call the same claim, so an overlap is safe: leases mean two
 * workers pick up different jobs rather than racing the same one.
 */
export default async function handler(): Promise<Response> {
  const provider = loadProvider();
  const started = Date.now();

  // Small batch. Each scan is a long external call, and holding many leases in
  // one invocation means a cold stop strands all of them until they expire.
  const jobs = await claimJobs<{ scanId: string }>(SCAN_JOB_KIND, 3);

  if (jobs.length === 0) return Response.json({ claimed: 0 });

  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await processOne(job);
      await completeJob(job.id);
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failJob(job.id, message);
      failed += 1;

      // On the last attempt the scan row must be told, or a visitor polls a
      // "queued" scan forever with no explanation.
      if (isTerminal(job)) await markScanAbandoned(job.payload.scanId);
      console.error(`[scan-worker] job ${job.id} failed (attempt ${job.attempts})`, error);
    }
  }

  console.log(
    `[scan-worker] claimed=${jobs.length} completed=${completed} failed=${failed} ` +
      `provider=${provider.name} in ${Date.now() - started}ms`,
  );

  return Response.json({ claimed: jobs.length, completed, failed });
}

async function processOne(job: Job<{ scanId: string }>): Promise<void> {
  const scanId = job.payload?.scanId;
  if (typeof scanId !== "string") throw new Error("Job payload carried no scanId.");
  // runScan owns its own failure reporting — it writes a reason onto the scan
  // row rather than throwing for an audit that legitimately could not run.
  await runScan(scanId, loadProvider());
}

/**
 * A scan whose job ran out of attempts.
 *
 * Without this the row sits at `queued` and the page polls it indefinitely.
 * Saying "we couldn't finish" is the honest end state.
 */
async function markScanAbandoned(scanId: string): Promise<void> {
  const { db } = await import("../../src/db/client");
  const { sql } = await import("drizzle-orm");

  await db.execute(sql`
    UPDATE scans SET
      status = 'failed',
      error_message = 'We couldn''t finish this scan. Try again, or send us the address.',
      completed_at = now()
    WHERE id = ${scanId} AND status IN ('queued', 'running')
  `);
}
