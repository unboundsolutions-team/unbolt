import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CONNECTION, pool, reset, testDb, type Fixture } from "./setup-db";

vi.mock("@/db/client", async () => ({
  db: testDb,
  schema: (await import("@/db/schema")) as unknown,
}));

const {
  adjustCredits,
  AllowanceError,
  balanceFor,
  consumeCredit,
  grantFromPurchase,
  ledgerFor,
  refundCredit,
} = await import("@/server/billing/allowance");

const describeDb = CONNECTION ? describe : describe.skip;

/** Record a paid purchase the way an admin would, and return its id. */
async function recordPaidPurchase(
  orgId: string,
  planCode: string,
  actorId: string,
): Promise<string> {
  const plan = (
    await pool.query<{
      id: string;
      task_allowance: number;
      concurrency_limit: number;
      max_task_hours: string | null;
      sla_hours: number;
      price_cents: number;
    }>(`SELECT * FROM plans WHERE code = $1`, [planCode])
  ).rows[0]!;

  const purchase = await pool.query<{ id: string }>(
    `INSERT INTO plan_purchases (
       organization_id, plan_id, status, method, tasks_granted, price_cents_paid,
       concurrency_at_purchase, max_task_hours_at_purchase, sla_hours_at_purchase,
       recorded_by, paid_at
     ) VALUES ($1,$2,'paid','manual',$3,$4,$5,$6,$7,$8,now()) RETURNING id`,
    [
      orgId,
      plan.id,
      plan.task_allowance,
      plan.price_cents,
      plan.concurrency_limit,
      plan.max_task_hours,
      plan.sla_hours,
      actorId,
    ],
  );
  return purchase.rows[0]!.id;
}

/** The invariant that has to hold no matter what happened. */
async function assertLedgerMatchesCounter(orgId: string): Promise<void> {
  const row = (
    await pool.query<{ counter: number; ledger: string }>(
      `SELECT o.credits_remaining AS counter,
              COALESCE((SELECT sum(delta) FROM credit_ledger WHERE organization_id = o.id), 0) AS ledger
       FROM organizations o WHERE o.id = $1`,
      [orgId],
    )
  ).rows[0]!;
  expect(Number(row.ledger)).toBe(Number(row.counter));
}

describeDb("task allowance (real Postgres)", () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await reset();
    await pool.query(`TRUNCATE credit_ledger, plan_purchases CASCADE`);
    await pool.query(
      `UPDATE organizations SET credits_remaining = 0, credits_granted_total = 0,
                                credits_used_total = 0, current_plan_id = NULL`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("granting from a purchase", () => {
    it("credits the pack and applies the plan's terms", async () => {
      const purchaseId = await recordPaidPurchase(f.orgId, "professional", f.ownerId);
      const result = await grantFromPurchase({ purchaseId, actorId: f.ownerId });

      expect(result.granted).toBe(10);
      expect(result.remaining).toBe(10);

      const org = (
        await pool.query<{
          concurrency_limit: number;
          max_task_hours: string;
          sla_hours: number;
          status: string;
        }>(
          `SELECT concurrency_limit, max_task_hours, sla_hours, status
           FROM organizations WHERE id = $1`,
          [f.orgId],
        )
      ).rows[0]!;

      // The purchase is the moment the plan takes effect.
      expect(org.concurrency_limit).toBe(2);
      expect(Number(org.max_task_hours)).toBe(16);
      expect(org.sla_hours).toBe(24);
      expect(org.status).toBe("active");

      await assertLedgerMatchesCounter(f.orgId);
    });

    it("stacks a second pack on top rather than replacing the balance", async () => {
      // "Purchase the same plan again" has to add, not reset — a customer who
      // tops up early must not lose what they already paid for.
      await grantFromPurchase({ purchaseId: await recordPaidPurchase(f.orgId, "standard", f.ownerId) });
      const second = await grantFromPurchase({
        purchaseId: await recordPaidPurchase(f.orgId, "standard", f.ownerId),
      });

      expect(second.remaining).toBe(10);
      expect((await balanceFor(f.orgId)).grantedTotal).toBe(10);
    });

    it("refuses to grant the same purchase twice", async () => {
      const purchaseId = await recordPaidPurchase(f.orgId, "standard", f.ownerId);
      await grantFromPurchase({ purchaseId });

      // A webhook redelivery, a double-clicked button, a retried job.
      await expect(grantFromPurchase({ purchaseId })).rejects.toBeInstanceOf(AllowanceError);
      expect((await balanceFor(f.orgId)).remaining).toBe(5);
    });

    it("grants only once when the same purchase is applied concurrently", async () => {
      const purchaseId = await recordPaidPurchase(f.orgId, "standard", f.ownerId);

      const results = await Promise.allSettled([
        grantFromPurchase({ purchaseId }),
        grantFromPurchase({ purchaseId }),
        grantFromPurchase({ purchaseId }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await balanceFor(f.orgId)).remaining).toBe(5);
      await assertLedgerMatchesCounter(f.orgId);
    });

    it("will not grant from an unpaid purchase", async () => {
      const plan = (await pool.query<{ id: string }>(`SELECT id FROM plans WHERE code='standard'`))
        .rows[0]!;
      const pending = (
        await pool.query<{ id: string }>(
          `INSERT INTO plan_purchases (organization_id, plan_id, status, tasks_granted)
           VALUES ($1,$2,'pending',5) RETURNING id`,
          [f.orgId, plan.id],
        )
      ).rows[0]!;

      await expect(grantFromPurchase({ purchaseId: pending.id })).rejects.toBeInstanceOf(
        AllowanceError,
      );
      expect((await balanceFor(f.orgId)).remaining).toBe(0);
    });
  });

  describe("spending a credit", () => {
    beforeEach(async () => {
      await grantFromPurchase({ purchaseId: await recordPaidPurchase(f.orgId, "standard", f.ownerId) });
    });

    it("decrements and reports what is left", async () => {
      expect(await consumeCredit({ organizationId: f.orgId, actorId: f.ownerId })).toBe(4);
      expect(await consumeCredit({ organizationId: f.orgId, actorId: f.ownerId })).toBe(3);

      const balance = await balanceFor(f.orgId);
      expect(balance.remaining).toBe(3);
      expect(balance.usedTotal).toBe(2);
      await assertLedgerMatchesCounter(f.orgId);
    });

    it("refuses once the pack is exhausted", async () => {
      for (let i = 0; i < 5; i += 1) {
        await consumeCredit({ organizationId: f.orgId, actorId: f.ownerId });
      }

      // Assert the sentence the CUSTOMER sees, not the one that goes to the
      // log — they are deliberately different, and only one of them is a
      // promise we are making to a person.
      await expect(
        consumeCredit({ organizationId: f.orgId, actorId: f.ownerId }),
      ).rejects.toMatchObject({
        publicMessage: expect.stringMatching(/used all the tasks in your plan/i),
      });

      let caught: InstanceType<typeof AllowanceError> | null = null;
      try {
        await consumeCredit({ organizationId: f.orgId, actorId: f.ownerId });
      } catch (error) {
        caught = error as InstanceType<typeof AllowanceError>;
      }

      // It has to tell them what to do next, not just that they cannot.
      expect(caught?.publicMessage).toMatch(/buy another pack|move up a plan/i);
    });

    it("NEVER lets two simultaneous submissions spend the same last credit", async () => {
      // The money bug. Five credits, eight people clicking submit at once.
      //
      // A SUM-over-ledger balance check would let several through: every CTE in
      // a statement shares one snapshot, so each reads the pre-spend balance.
      // The counter works because UPDATE re-evaluates its WHERE clause against
      // the freshly-locked row — the same reason a bank withdrawal is written
      // `WHERE balance >= amount` rather than checked first.
      const attempts = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          consumeCredit({ organizationId: f.orgId, actorId: f.ownerId }),
        ),
      );

      expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(5);
      expect((await balanceFor(f.orgId)).remaining).toBe(0);
      await assertLedgerMatchesCounter(f.orgId);
    });

    it("holds under sustained contention, not just once", async () => {
      for (let round = 0; round < 12; round += 1) {
        const fx = await reset();
        await pool.query(
          `UPDATE organizations SET credits_remaining = 0, credits_granted_total = 0, credits_used_total = 0`,
        );
        await grantFromPurchase({
          purchaseId: await recordPaidPurchase(fx.orgId, "standard", fx.ownerId),
        });

        const attempts = await Promise.allSettled(
          Array.from({ length: 10 }, () =>
            consumeCredit({ organizationId: fx.orgId, actorId: fx.ownerId }),
          ),
        );

        expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(5);
        expect((await balanceFor(fx.orgId)).remaining).toBe(0);
        await assertLedgerMatchesCounter(fx.orgId);
      }
    });

    it("cannot be driven below zero even by the database", async () => {
      // The CHECK constraint is the backstop for a bug in this file.
      await expect(
        pool.query(`UPDATE organizations SET credits_remaining = -1 WHERE id = $1`, [f.orgId]),
      ).rejects.toThrow(/organizations_credits_ck/);
    });
  });

  describe("refunds and adjustments", () => {
    beforeEach(async () => {
      await grantFromPurchase({ purchaseId: await recordPaidPurchase(f.orgId, "standard", f.ownerId) });
    });

    it("hands a credit back and corrects the used count", async () => {
      await consumeCredit({ organizationId: f.orgId, actorId: f.ownerId });
      await refundCredit({
        organizationId: f.orgId,
        actorId: f.ownerId,
        reason: "Cancelled before we started",
      });

      const balance = await balanceFor(f.orgId);
      expect(balance.remaining).toBe(5);
      // Otherwise "1 of 5 used" stays on screen for work nobody did.
      expect(balance.usedTotal).toBe(0);
      await assertLedgerMatchesCounter(f.orgId);
    });

    it("lets an admin grant goodwill credits with a reason", async () => {
      const after = await adjustCredits({
        organizationId: f.orgId,
        actorId: f.ownerId,
        delta: 2,
        reason: "Goodwill after the outage",
      });
      expect(after).toBe(7);

      const [latest] = await ledgerFor(f.orgId, 1);
      expect(latest!.type).toBe("adjust");
      expect(latest!.reason).toBe("Goodwill after the outage");
    });

    it("refuses an adjustment with no reason", async () => {
      await expect(
        adjustCredits({ organizationId: f.orgId, actorId: f.ownerId, delta: 1, reason: "" }),
      ).rejects.toMatchObject({ publicMessage: expect.stringMatching(/say why/i) });
    });

    it("refuses an adjustment that would go below zero", async () => {
      await expect(
        adjustCredits({
          organizationId: f.orgId,
          actorId: f.ownerId,
          delta: -99,
          reason: "Clawback",
        }),
      ).rejects.toMatchObject({ publicMessage: expect.stringMatching(/below zero/i) });
      expect((await balanceFor(f.orgId)).remaining).toBe(5);
    });
  });

  describe("the ledger", () => {
    it("explains every movement in order", async () => {
      await grantFromPurchase({ purchaseId: await recordPaidPurchase(f.orgId, "standard", f.ownerId) });
      await consumeCredit({ organizationId: f.orgId, actorId: f.ownerId });
      await adjustCredits({
        organizationId: f.orgId,
        actorId: f.ownerId,
        delta: 1,
        reason: "Goodwill",
      });

      const entries = await ledgerFor(f.orgId);
      expect(entries.map((e) => e.type)).toEqual(["adjust", "consume", "grant"]);
      expect(entries.map((e) => e.balanceAfter)).toEqual([5, 4, 5]);
      // "Where did my tasks go" has an answer with a name on it.
      expect(entries[1]!.actorName).toBe("Owner");
    });

    it("cannot be rewritten", async () => {
      await grantFromPurchase({ purchaseId: await recordPaidPurchase(f.orgId, "standard", f.ownerId) });

      await pool.query(`UPDATE credit_ledger SET delta = 999`);
      await pool.query(`DELETE FROM credit_ledger`);

      // A billing history that can be edited is not a billing history.
      const entries = await ledgerFor(f.orgId);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.delta).toBe(5);
    });
  });

  describe("append-only tables do not make rows undeletable", () => {
    it("lets a user be deleted while preserving what they did", async () => {
    // The bug this pins, latent since M0: audit_logs and task_events are
    // append-only (DO INSTEAD NOTHING) AND carried ON DELETE SET NULL foreign
    // keys to users. Deleting a user made Postgres try to null those columns,
    // the rules discarded the update, and the delete aborted with
    // "referential integrity query ... gave unexpected result".
    //
    // No user could be deleted at all — not an offboarded engineer, not a GDPR
    // erasure. Nothing about the schema reads as wrong; only running a DELETE
    // finds it.
    const f = await reset();
    await pool.query(
      `INSERT INTO audit_logs (organization_id, actor_id, action)
       VALUES ($1, $2, 'test.action')`,
      [f.orgId, f.ownerId],
    );

    await expect(
      pool.query(`DELETE FROM users WHERE id = $1`, [f.memberId]),
    ).resolves.toBeTruthy();

    // And the record of what they did survives — an audit entry that loses its
    // actor has destroyed the one fact it existed to preserve.
    const log = await pool.query<{ actor_id: string | null }>(
      `SELECT actor_id FROM audit_logs WHERE organization_id = $1`,
      [f.orgId],
    );
    expect(log.rows[0]!.actor_id).toBe(f.ownerId);
  });
  });
});
