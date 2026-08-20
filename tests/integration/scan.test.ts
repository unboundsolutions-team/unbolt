import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CONNECTION, pool, reset, testDb, type Fixture } from "./setup-db";

vi.mock("@/db/client", async () => ({
  db: testDb,
  schema: (await import("@/db/schema")) as unknown,
}));

const { claimJobs, completeJob, failJob } = await import("@/server/jobs");
const { createScan, getScan, runScan, SCAN_JOB_KIND, ScanRateLimitError, MAX_SCANS_PER_TARGET } =
  await import("@/server/scan/service");
const { UnsafeTargetError } = await import("@/server/scan/target");
const { AuditUnavailableError } = await import("@/server/scan/provider");

const describeDb = CONNECTION ? describe : describe.skip;

/** An audit provider that returns whatever the test needs, without a network. */
function fakeProvider(result: unknown, name = "fake") {
  return {
    name,
    run: async () => {
      if (result instanceof Error) throw result;
      return result as never;
    },
  };
}

describeDb("store health scan (real Postgres)", () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await reset();
    await pool.query("TRUNCATE scans, jobs RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("creating a scan", () => {
    it("normalises the target and enqueues exactly one job", async () => {
      const { scanId, targetUrl } = await createScan({ rawUrl: "northline.co/products?x=1" });

      expect(targetUrl).toBe("https://northline.co/products");

      const jobs = await pool.query<{ kind: string; payload: { scanId: string } }>(
        `SELECT kind, payload FROM jobs`,
      );
      expect(jobs.rows).toHaveLength(1);
      expect(jobs.rows[0]!.kind).toBe(SCAN_JOB_KIND);
      expect(jobs.rows[0]!.payload.scanId).toBe(scanId);
    });

    it("refuses an SSRF target before any row is written", async () => {
      await expect(
        createScan({ rawUrl: "http://169.254.169.254/latest/meta-data/" }),
      ).rejects.toBeInstanceOf(UnsafeTargetError);

      // Nothing queued, nothing recorded — the request never became work.
      const scans = await pool.query(`SELECT count(*)::int n FROM scans`);
      const jobs = await pool.query(`SELECT count(*)::int n FROM jobs`);
      expect((scans.rows[0] as { n: number }).n).toBe(0);
      expect((jobs.rows[0] as { n: number }).n).toBe(0);
    });

    it("attributes a scan to an organisation when one is supplied", async () => {
      const { scanId } = await createScan({
        rawUrl: "https://northline.co",
        organizationId: f.orgId,
      });
      const row = await pool.query<{ organization_id: string }>(
        `SELECT organization_id FROM scans WHERE id = $1`,
        [scanId],
      );
      expect(row.rows[0]!.organization_id).toBe(f.orgId);
    });

    it("rate-limits repeat scans of the same target", async () => {
      // The endpoint is public and each call makes our servers fetch a URL a
      // stranger chose. Without this it is a free traffic amplifier.
      for (let i = 0; i < MAX_SCANS_PER_TARGET; i += 1) {
        await createScan({ rawUrl: "https://northline.co" });
      }
      await expect(createScan({ rawUrl: "https://northline.co" })).rejects.toBeInstanceOf(
        ScanRateLimitError,
      );
    });

    it("does not let one target's limit block a different store", async () => {
      for (let i = 0; i < MAX_SCANS_PER_TARGET; i += 1) {
        await createScan({ rawUrl: "https://northline.co" });
      }
      await expect(createScan({ rawUrl: "https://otherstore.com" })).resolves.toBeTruthy();
    });

    it("counts only recent scans towards the limit", async () => {
      for (let i = 0; i < MAX_SCANS_PER_TARGET; i += 1) {
        await createScan({ rawUrl: "https://northline.co" });
      }
      await pool.query(`UPDATE scans SET created_at = now() - interval '1 hour'`);
      await expect(createScan({ rawUrl: "https://northline.co" })).resolves.toBeTruthy();
    });
  });

  describe("running a scan", () => {
    it("stores scores, metrics and ranked findings", async () => {
      const { scanId } = await createScan({ rawUrl: "https://northline.co" });

      await runScan(
        scanId,
        fakeProvider({
          performanceScore: 41,
          accessibilityScore: 88,
          seoScore: 92,
          bestPracticesScore: 75,
          metrics: { lcp: 5200, cls: 0.31, thirdParties: 17, jsBytes: 1_800_000 },
        }),
      );

      const scan = (await getScan(scanId))!;
      expect(scan.status).toBe("complete");
      expect(scan.performanceScore).toBe(41);
      expect(scan.metrics?.lcp).toBe(5200);

      // Ranked by commercial impact, not by metric badness or alphabetically.
      expect(scan.findings.length).toBeGreaterThan(2);
      expect(scan.findings[0]!.id).toBe("lcp-poor");
      const ranks = scan.findings.map((x) => x.rank);
      expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    });

    it("records a reason when the audit cannot run", async () => {
      const { scanId } = await createScan({ rawUrl: "https://northline.co" });

      await runScan(
        scanId,
        fakeProvider(new AuditUnavailableError("upstream 500", "That page didn't load for us.")),
      );

      const scan = (await getScan(scanId))!;
      expect(scan.status).toBe("failed");
      // The visitor's message, not the internal one.
      expect(scan.errorMessage).toBe("That page didn't load for us.");
    });

    it("does not leak an unexpected error to the visitor", async () => {
      const { scanId } = await createScan({ rawUrl: "https://northline.co" });
      await runScan(scanId, fakeProvider(new Error("ECONNREFUSED 10.0.0.5:5432")));

      const scan = (await getScan(scanId))!;
      expect(scan.status).toBe("failed");
      expect(scan.errorMessage).not.toContain("10.0.0.5");
      expect(scan.errorMessage).toMatch(/try again/i);
    });

    it("ignores a duplicate delivery instead of scanning twice", async () => {
      const { scanId } = await createScan({ rawUrl: "https://northline.co" });

      let runs = 0;
      const counting = {
        name: "counting",
        run: async () => {
          runs += 1;
          return { metrics: { lcp: 1000 } };
        },
      };

      await runScan(scanId, counting);
      await runScan(scanId, counting); // retry, or two workers

      expect(runs).toBe(1);
    });

    it("satisfies the database's own terminal-state rule", async () => {
      // scans_terminal_ck: a failed scan must carry a reason. If runScan ever
      // stopped writing one, this insert path would throw rather than quietly
      // leaving a visitor staring at a blank failure.
      const { scanId } = await createScan({ rawUrl: "https://northline.co" });
      await runScan(scanId, fakeProvider(new Error("boom")));

      const row = await pool.query<{ status: string; error_message: string | null }>(
        `SELECT status, error_message FROM scans WHERE id = $1`,
        [scanId],
      );
      expect(row.rows[0]!.status).toBe("failed");
      expect(row.rows[0]!.error_message).not.toBeNull();
    });
  });

  describe("the job queue", () => {
    it("claims a job once and leases it against other workers", async () => {
      await createScan({ rawUrl: "https://northline.co" });

      const first = await claimJobs(SCAN_JOB_KIND, 5);
      expect(first).toHaveLength(1);
      // Leased — a second worker must not pick up the same scan.
      expect(await claimJobs(SCAN_JOB_KIND, 5)).toHaveLength(0);
    });

    it("returns an abandoned job to the queue when its lease expires", async () => {
      await createScan({ rawUrl: "https://northline.co" });
      await claimJobs(SCAN_JOB_KIND, 1);

      await pool.query(`UPDATE jobs SET claimed_until = now() - interval '1 minute'`);
      expect(await claimJobs(SCAN_JOB_KIND, 1)).toHaveLength(1);
    });

    it("gives a job to exactly one of two simultaneous workers", async () => {
      await createScan({ rawUrl: "https://northline.co" });
      const [a, b] = await Promise.all([claimJobs(SCAN_JOB_KIND, 1), claimJobs(SCAN_JOB_KIND, 1)]);
      expect(a.length + b.length).toBe(1);
    });

    it("backs off between retries rather than burning the budget instantly", async () => {
      await createScan({ rawUrl: "https://northline.co" });
      const [job] = await claimJobs(SCAN_JOB_KIND, 1);
      await failJob(job!.id, "timeout");

      // Not immediately claimable — retrying a timeout instantly just times out.
      expect(await claimJobs(SCAN_JOB_KIND, 1)).toHaveLength(0);

      await pool.query(`UPDATE jobs SET run_after = now() - interval '1 minute'`);
      expect(await claimJobs(SCAN_JOB_KIND, 1)).toHaveLength(1);
    });

    it("stops claiming once the attempt budget is spent", async () => {
      await createScan({ rawUrl: "https://northline.co" }); // maxAttempts: 2

      for (let i = 0; i < 2; i += 1) {
        const [job] = await claimJobs(SCAN_JOB_KIND, 1);
        expect(job).toBeDefined();
        await failJob(job!.id, "still broken");
        await pool.query(`UPDATE jobs SET run_after = now() - interval '1 hour'`);
      }

      expect(await claimJobs(SCAN_JOB_KIND, 1)).toHaveLength(0);

      const row = await pool.query<{ failed_at: Date | null }>(`SELECT failed_at FROM jobs`);
      expect(row.rows[0]!.failed_at).not.toBeNull();
    });

    it("never reclaims a completed job", async () => {
      await createScan({ rawUrl: "https://northline.co" });
      const [job] = await claimJobs(SCAN_JOB_KIND, 1);
      await completeJob(job!.id);

      await pool.query(`UPDATE jobs SET claimed_until = NULL`);
      expect(await claimJobs(SCAN_JOB_KIND, 1)).toHaveLength(0);
    });
  });

  describe("polling", () => {
    it("returns null for an id that does not exist", async () => {
      expect(await getScan("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("never exposes the lead email or the owning organisation", async () => {
      const { scanId } = await createScan({
        rawUrl: "https://northline.co",
        organizationId: f.orgId,
        leadEmail: "founder@northline.co",
      });

      // The id is unguessable, but the payload must still carry only what is
      // public about a public web page.
      const serialised = JSON.stringify(await getScan(scanId));
      expect(serialised).not.toContain("founder@northline.co");
      expect(serialised).not.toContain(f.orgId);
    });
  });
});
