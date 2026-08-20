import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CONNECTION, pool, reset, testDb, type Fixture } from "./setup-db";

vi.mock("@/db/client", async () => ({
  db: testDb,
  schema: (await import("@/db/schema")) as unknown,
}));

const { claimBatch, drainOnce, MAX_ATTEMPTS, renderNotification, releaseClaim } = await import(
  "@/server/notifications"
);

/** Pretend the backoff or the lease has elapsed, without sleeping for it. */
async function expireLeases(): Promise<void> {
  await pool.query(`UPDATE notifications SET claimed_until = now() - interval '1 hour'`);
}
const { queueTask, transitionTask } = await import("@/server/task-engine");

const describeDb = CONNECTION ? describe : describe.skip;

/** Puts one real notification in the outbox by doing the thing that causes one. */
async function withOneNotification(f: Fixture): Promise<void> {
  const t = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Notify me" });
  await transitionTask({
    taskId: t.id,
    organizationId: f.orgId,
    actorId: f.ownerId,
    next: "in_progress",
  });
}

describeDb("notification outbox (real Postgres)", () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await reset({ concurrencyLimit: 2 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("claims pending rows and joins the recipient's address", async () => {
    await withOneNotification(f);

    const batch = await claimBatch();
    expect(batch).toHaveLength(1);
    expect(batch[0]!.email).toBe("member@test.dev");
    expect(batch[0]!.type).toBe("task.in_progress");
    expect(batch[0]!.attempts).toBe(1);
  });

  it("does not hand the same row to two workers", async () => {
    await withOneNotification(f);

    // The bug this pins: with FOR UPDATE SKIP LOCKED alone, the lock died with
    // the claim statement and a second worker a heartbeat later re-claimed the
    // same row — telling the customer twice that work had started.
    const [a, b] = await Promise.all([claimBatch(), claimBatch()]);
    expect(a.length + b.length).toBe(1);

    // And still not, once the statements are nowhere near simultaneous.
    expect(await claimBatch()).toHaveLength(0);
  });

  it("returns leased work to the pool when the lease expires", async () => {
    await withOneNotification(f);
    expect(await claimBatch()).toHaveLength(1);

    // A worker that claimed and then died. Nothing releases the row; only the
    // deadline passing does.
    expect(await claimBatch()).toHaveLength(0);
    await expireLeases();
    expect(await claimBatch()).toHaveLength(1);
  });

  it("releases a claim on demand for a clean shutdown", async () => {
    await withOneNotification(f);
    const [row] = await claimBatch();
    expect(await claimBatch()).toHaveLength(0);

    await releaseClaim(row!.id);
    expect(await claimBatch()).toHaveLength(1);
  });

  it("marks a delivered row so it is never claimed again", async () => {
    await withOneNotification(f);

    const result = await drainOnce({ send: async () => {} });
    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });

    const again = await drainOnce({ send: async () => {} });
    expect(again.claimed).toBe(0);
  });

  it("keeps a failed row pending so a transient outage is retried", async () => {
    await withOneNotification(f);

    const failing = { send: async () => { throw new Error("mail provider 503"); } };
    const first = await drainOnce(failing);
    expect(first).toEqual({ claimed: 1, sent: 0, failed: 1 });

    const row = (
      await pool.query<{ attempts: number; failed_at: Date | null; last_error: string }>(
        `SELECT attempts, failed_at, last_error FROM notifications`,
      )
    ).rows[0]!;

    expect(row.attempts).toBe(1);
    expect(row.failed_at).toBeNull();
    expect(row.last_error).toContain("503");

    // Backed off, not abandoned: an overloaded provider must not be hammered
    // with the same batch a millisecond later.
    expect((await drainOnce(failing)).claimed).toBe(0);

    await expireLeases();
    expect((await drainOnce(failing)).claimed).toBe(1);
  });

  it("gives up only after the retry budget is spent", async () => {
    await withOneNotification(f);
    const failing = { send: async () => { throw new Error("hard bounce"); } };

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await drainOnce(failing);
      await expireLeases();
    }

    const row = (
      await pool.query<{ attempts: number; failed_at: Date | null }>(
        `SELECT attempts, failed_at FROM notifications`,
      )
    ).rows[0]!;

    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.failed_at).not.toBeNull();

    // And it stops consuming quota forever, lease or no lease.
    await expireLeases();
    expect((await drainOnce(failing)).claimed).toBe(0);
  });

  it("one bad address does not abandon the rest of the batch", async () => {
    for (let i = 0; i < 3; i += 1) {
      const t = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: `B${i}` });
      await transitionTask({
        taskId: t.id,
        organizationId: f.orgId,
        actorId: f.ownerId,
        next: "in_progress",
      });
      await transitionTask({
        taskId: t.id,
        organizationId: f.orgId,
        actorId: f.ownerId,
        next: "in_review",
      });
      await transitionTask({
        taskId: t.id,
        organizationId: f.orgId,
        actorId: f.ownerId,
        next: "shipped",
      });
    }

    let seen = 0;
    const flaky = {
      send: async () => {
        seen += 1;
        if (seen === 2) throw new Error("bad address");
      },
    };

    const result = await drainOnce(flaky);
    expect(result.claimed).toBe(6); // 3 tasks × (started + shipped)
    expect(result.sent).toBe(5);
    expect(result.failed).toBe(1);
  });

  describe("copy", () => {
    it("speaks to the customer, not about the system", () => {
      const started = renderNotification({
        id: "1",
        userId: "u",
        email: "a@b.c",
        name: "A",
        type: "task.in_progress",
        payload: { reference: "UNB-004", title: "Checkout drops the discount code" },
        attempts: 1,
      });

      expect(started.subject).toBe("UNB-004 — we've started");
      expect(started.body).toContain("Checkout drops the discount code");
      // No state machine vocabulary in anything a customer reads.
      expect(started.body).not.toMatch(/in_progress|transition|state/i);
    });

    it("falls back rather than rendering an empty email", () => {
      const unknown = renderNotification({
        id: "1",
        userId: "u",
        email: "a@b.c",
        name: null,
        type: "task.something_new",
        payload: {},
        attempts: 1,
      });
      expect(unknown.subject).toContain("your task");
    });
  });
});
