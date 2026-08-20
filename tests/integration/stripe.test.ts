import { createHmac } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CONNECTION, pool, reset, testDb, type Fixture } from "./setup-db";

vi.mock("@/db/client", async () => ({
  db: testDb,
  schema: (await import("@/db/schema")) as unknown,
}));

const WEBHOOK_SECRET = "whsec_test_secret_for_signature_verification";
process.env["STRIPE_SECRET_KEY"] = "sk_test_not_a_real_key";
process.env["STRIPE_WEBHOOK_SECRET"] = WEBHOOK_SECRET;

const { fulfilCheckoutSession } = await import("@/server/billing/stripe-fulfilment");
const { verifyWebhook } = await import("@/server/billing/stripe");
const { balanceFor } = await import("@/server/billing/allowance");

const describeDb = CONNECTION ? describe : describe.skip;

/**
 * Sign a payload the way Stripe does.
 *
 * Written out rather than using the SDK's test helper, because the point is to
 * prove our verification rejects things — and a helper that produces only valid
 * signatures cannot demonstrate that. This also makes the forged and stale
 * cases trivial to construct.
 */
function sign(payload: string, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function checkoutEvent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_test_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_session_1",
        payment_status: "paid",
        payment_intent: "pi_test_1",
        amount_total: 149900,
        currency: "usd",
        metadata: {},
        ...overrides,
      },
    },
  });
}

describeDb("stripe (real Postgres)", () => {
  let f: Fixture;
  let planId: string;
  let planAllowance: number;

  beforeEach(async () => {
    f = await reset({ credits: 0 });
    const plan = await pool.query<{ id: string; task_allowance: number }>(
      `SELECT id, task_allowance FROM plans WHERE code = 'professional'`,
    );
    planId = plan.rows[0]!.id;
    planAllowance = Number(plan.rows[0]!.task_allowance);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("verifying a delivery", () => {
    it("accepts a correctly signed payload", () => {
      const body = checkoutEvent();
      const event = verifyWebhook(body, sign(body));
      expect(event.type).toBe("checkout.session.completed");
    });

    it("REFUSES a payload signed with the wrong secret", () => {
      // This endpoint grants credits. An attacker who could post to it unsigned
      // could mint an unlimited allowance for any workspace whose id they know.
      const body = checkoutEvent();
      expect(() => verifyWebhook(body, sign(body, "whsec_attacker_guess"))).toThrow();
    });

    it("REFUSES a payload whose body was altered after signing", () => {
      const original = checkoutEvent();
      const signature = sign(original);
      const tampered = original.replace('"amount_total":149900', '"amount_total":1');
      expect(() => verifyWebhook(tampered, signature)).toThrow();
    });

    it("REFUSES a captured payload replayed later", () => {
      // Stripe's tolerance window is what stops somebody who once saw a valid
      // delivery from re-posting it forever.
      const body = checkoutEvent();
      const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
      expect(() => verifyWebhook(body, sign(body, WEBHOOK_SECRET, anHourAgo))).toThrow();
    });

    it("refuses a request with no signature at all", () => {
      expect(() => verifyWebhook(checkoutEvent(), null)).toThrow();
    });
  });

  describe("fulfilment", () => {
    const session = (overrides: Record<string, unknown> = {}) => ({
      id: "cs_test_1",
      paymentStatus: "paid",
      paymentIntentId: "pi_test_1",
      amountTotal: 149900,
      currency: "usd",
      organizationId: f.orgId,
      planId,
      ...overrides,
    });

    it("grants the pack and records the purchase", async () => {
      const before = await balanceFor(f.orgId);
      const result = await fulfilCheckoutSession(session());

      expect(result.status).toBe("granted");
      const after = await balanceFor(f.orgId);
      expect(after.remaining).toBe(before.remaining + planAllowance);

      const purchase = await pool.query<{ status: string; method: string }>(
        `SELECT status, method FROM plan_purchases WHERE stripe_checkout_session_id = 'cs_test_1'`,
      );
      expect(purchase.rows[0]).toMatchObject({ status: "paid", method: "stripe" });
    });

    it("GRANTS ONCE when the same event is delivered four times", async () => {
      // Stripe retries on timeouts, on 500s, and on a deploy that happened
      // mid-request. Delivering twice is normal operation, not an attack, and
      // the customer must not receive two packs for one payment.
      const results = [];
      for (let i = 0; i < 4; i += 1) results.push(await fulfilCheckoutSession(session()));

      expect(results.filter((r) => r.status === "granted")).toHaveLength(1);
      expect(results.filter((r) => r.status === "already-granted")).toHaveLength(3);

      const balance = await balanceFor(f.orgId);
      expect(balance.remaining).toBe(planAllowance);

      const purchases = await pool.query(
        `SELECT 1 FROM plan_purchases WHERE stripe_checkout_session_id = 'cs_test_1'`,
      );
      expect(purchases.rowCount).toBe(1);
    });

    it("grants once when deliveries arrive concurrently", async () => {
      // The retry above is sequential. Stripe can also have two deliveries in
      // flight at the same moment, which is where a check-then-act would let
      // both through.
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => fulfilCheckoutSession(session())),
      );
      const granted = results.filter(
        (r) => r.status === "fulfilled" && r.value.status === "granted",
      );
      expect(granted.length).toBeLessThanOrEqual(1);

      const balance = await balanceFor(f.orgId);
      expect(balance.remaining).toBe(planAllowance);
    });

    it("grants what the PLAN says, not what the session claims", async () => {
      // The task count is read from the plan row at fulfilment. If it came from
      // session metadata, anyone who could influence a checkout session could
      // choose their own allowance.
      await pool.query(`UPDATE plans SET task_allowance = 3 WHERE id = $1`, [planId]);
      await fulfilCheckoutSession(session());
      expect((await balanceFor(f.orgId)).remaining).toBe(3);
    });

    it("does NOT grant while payment is still pending", async () => {
      // checkout.session.completed fires for asynchronous methods before the
      // money arrives, and that payment can still fail.
      const result = await fulfilCheckoutSession(session({ paymentStatus: "unpaid" }));
      expect(result.status).toBe("ignored");
      expect((await balanceFor(f.orgId)).remaining).toBe(0);
    });

    it("ignores a session that carries no workspace", async () => {
      // A payment link created by hand in the Stripe dashboard. There is no
      // workspace to credit, and guessing from the email would credit whichever
      // one it matched first.
      const result = await fulfilCheckoutSession(session({ organizationId: undefined }));
      expect(result.status).toBe("ignored");
    });

    it("refuses to grant a plan that has since been deactivated", async () => {
      await pool.query(`UPDATE plans SET is_active = false WHERE id = $1`, [planId]);
      const result = await fulfilCheckoutSession(session());
      expect(result.status).toBe("ignored");
      expect((await balanceFor(f.orgId)).remaining).toBe(0);
    });

    it("writes exactly one grant to the ledger", async () => {
      await fulfilCheckoutSession(session());
      await fulfilCheckoutSession(session());

      const ledger = await pool.query<{ type: string; delta: number }>(
        `SELECT type, delta FROM credit_ledger WHERE organization_id = $1 AND type = 'grant'`,
        [f.orgId],
      );
      // The ledger is the account of record. Two rows here would mean the
      // balance and its history disagree, which is the one thing a ledger
      // exists to prevent.
      expect(ledger.rowCount).toBe(1);
      expect(Number(ledger.rows[0]!.delta)).toBe(planAllowance);
    });

    it("lets a customer buy a second pack in a separate session", async () => {
      await fulfilCheckoutSession(session());
      await fulfilCheckoutSession(session({ id: "cs_test_2" }));

      // Idempotency must key on the session, not on the plan or the workspace —
      // buying the same pack again is the entire business model.
      expect((await balanceFor(f.orgId)).remaining).toBe(planAllowance * 2);
    });
  });
});
