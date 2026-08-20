/**
 * Run the scan worker once, locally.
 *
 * The Netlify background function is a thin wrapper around exactly these calls
 * — claim, run, complete or fail — and there is no Netlify functions runtime in
 * local dev. This script is how the pipeline gets exercised end to end without
 * one, and how a queued scan gets unstuck on a developer machine.
 *
 *   npm run scan:worker
 *
 * Wrapped in main() rather than using top-level await: tsx compiles .ts as CJS
 * in this package (there is no "type": "module"), and esbuild refuses TLA in a
 * CJS output format.
 */
import { claimJobs, completeJob, failJob, isTerminal } from "../src/server/jobs";
import { loadProvider } from "../src/server/scan/provider";
import { runScan, SCAN_JOB_KIND } from "../src/server/scan/service";

async function main(): Promise<void> {
  const provider = loadProvider();
  const jobs = await claimJobs<{ scanId: string }>(SCAN_JOB_KIND, 5);

  if (jobs.length === 0) {
    console.log("No queued scans.");
    return;
  }

  console.log(`Claimed ${jobs.length} scan(s) \u00b7 provider=${provider.name}`);

  for (const job of jobs) {
    const scanId = job.payload?.scanId;
    try {
      if (typeof scanId !== "string") throw new Error("Job payload carried no scanId.");
      await runScan(scanId, provider);
      await completeJob(job.id);
      console.log(`  \u2713 ${scanId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failJob(job.id, message);
      console.log(
        `  \u2717 ${scanId ?? job.id} \u2014 ${message}${isTerminal(job) ? " (final attempt)" : ""}`,
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
