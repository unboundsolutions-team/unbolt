import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CONNECTION, pool, testDb } from "./setup-db";

vi.mock("@/db/client", async () => ({
  db: testDb,
  schema: (await import("@/db/schema")) as unknown,
}));

const { clientIdentifier, consumeRateLimit, purgeExpiredWindows } = await import(
  "@/server/rate-limit"
);

const describeDb = CONNECTION ? describe : describe.skip;

describeDb("rate limiting (real Postgres)", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE rate_limits");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("allows up to the limit and refuses past it", async () => {
    const opts = { kind: "scan", identifier: "1.2.3.4", limit: 3, windowSeconds: 600 };

    for (let i = 1; i <= 3; i += 1) {
      const result = await consumeRateLimit(opts);
      expect(result.allowed).toBe(true);
      expect(result.used).toBe(i);
    }

    const blocked = await consumeRateLimit(opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.used).toBe(4);
  });

  it("keeps callers in separate buckets", async () => {
    const opts = { kind: "scan", limit: 2, windowSeconds: 600 };

    await consumeRateLimit({ ...opts, identifier: "1.1.1.1" });
    await consumeRateLimit({ ...opts, identifier: "1.1.1.1" });

    // One noisy caller must not lock everybody else out.
    const other = await consumeRateLimit({ ...opts, identifier: "2.2.2.2" });
    expect(other.allowed).toBe(true);
    expect(other.used).toBe(1);
  });

  it("keeps different kinds of limit separate", async () => {
    const id = "1.2.3.4";
    await consumeRateLimit({ kind: "scan", identifier: id, limit: 1, windowSeconds: 600 });

    // Using up the scan allowance must not also block the contact form.
    const lead = await consumeRateLimit({
      kind: "lead", identifier: id, limit: 1, windowSeconds: 600,
    });
    expect(lead.allowed).toBe(true);
  });

  it("COUNTS EVERY CONCURRENT REQUEST — the race a naive limiter loses", async () => {
    // Read-then-write would let a burst through: each request reads the same
    // pre-increment count and each concludes it is under the limit. The atomic
    // upsert is what makes the count exact under load, which is precisely when
    // a limiter has to be right.
    const opts = { kind: "scan", identifier: "burst", limit: 5, windowSeconds: 600 };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeRateLimit(opts)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(new Set(results.map((r) => r.used)).size).toBe(20);

    const row = await pool.query<{ count: number }>(`SELECT count FROM rate_limits`);
    expect(Number(row.rows[0]!.count)).toBe(20);
  });

  it("starts a fresh window when the old one rolls over", async () => {
    const opts = { kind: "scan", identifier: "roll", limit: 1, windowSeconds: 600 };

    expect((await consumeRateLimit(opts)).allowed).toBe(true);
    expect((await consumeRateLimit(opts)).allowed).toBe(false);

    // Age the window rather than waiting ten minutes for it.
    await pool.query(`UPDATE rate_limits SET window_start = window_start - interval '20 minutes'`);

    expect((await consumeRateLimit(opts)).allowed).toBe(true);
  });

  it("reports how long until the window rolls over", async () => {
    const result = await consumeRateLimit({
      kind: "scan", identifier: "retry", limit: 1, windowSeconds: 600,
    });
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(600);
  });

  it("sweeps only windows that have long since rolled over", async () => {
    await consumeRateLimit({ kind: "scan", identifier: "fresh", limit: 5, windowSeconds: 600 });
    await consumeRateLimit({ kind: "scan", identifier: "old", limit: 5, windowSeconds: 600 });
    await pool.query(
      `UPDATE rate_limits SET window_start = now() - interval '3 days' WHERE bucket LIKE '%old'`,
    );

    await purgeExpiredWindows();
    const left = await pool.query<{ bucket: string }>(`SELECT bucket FROM rate_limits`);
    expect(left.rows.map((r: { bucket: string }) => r.bucket)).toEqual(["scan:fresh"]);
  });

  describe("identifying the caller", () => {
    it("prefers the header the platform sets itself", () => {
      // x-forwarded-for is client-settable. Anywhere it is not overwritten by a
      // proxy, an attacker puts a different value on every request and lands in
      // a fresh bucket each time — the limiter looks fine and does nothing.
      const headers = new Headers({
        "x-nf-client-connection-ip": "203.0.113.9",
        "x-forwarded-for": "1.1.1.1",
      });
      expect(clientIdentifier(headers)).toBe("203.0.113.9");
    });

    it("takes only the first entry of a forwarded chain", () => {
      // Later entries are appended by intermediaries and are attacker-supplied.
      const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" });
      expect(clientIdentifier(headers)).toBe("203.0.113.9");
    });

    it("buckets an unidentifiable caller rather than exempting them", () => {
      // Waving through anyone who omits a header would be a documented bypass.
      expect(clientIdentifier(new Headers())).toBe("unknown");
    });
  });
});
