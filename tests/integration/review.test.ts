import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CONNECTION, pool, reset, testDb, type Fixture } from "./setup-db";

vi.mock("@/db/client", async () => ({
  db: testDb,
  schema: (await import("@/db/schema")) as unknown,
}));

const { clearBlock, estimateTask, ReviewError } = await import("@/server/billing/review");
const { commentsFor, postComment, CommentError } = await import("@/server/comments");
const { queueTask, transitionTask, QueueRuleError } = await import("@/server/task-engine");
const { balanceFor } = await import("@/server/billing/allowance");

const describeDb = CONNECTION ? describe : describe.skip;

describeDb("review, estimation and comments (real Postgres)", () => {
  let f: Fixture;

  beforeEach(async () => {
    // 8-hour ceiling, matching the Standard plan.
    f = await reset({ credits: 10, maxTaskHours: 8 });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("spending a credit on submission", () => {
    it("takes one credit per task and reports the balance", async () => {
      const first = await queueTask({
        organizationId: f.orgId,
        actorId: f.ownerId,
        title: "First",
      });
      expect(first.creditsRemaining).toBe(9);

      const second = await queueTask({
        organizationId: f.orgId,
        actorId: f.ownerId,
        title: "Second",
      });
      expect(second.creditsRemaining).toBe(8);
      expect((await balanceFor(f.orgId)).usedTotal).toBe(2);
    });

    it("refuses a submission once the pack is spent, with a way forward", async () => {
      const fx = await reset({ credits: 1 });
      await queueTask({ organizationId: fx.orgId, actorId: fx.ownerId, title: "Only one" });

      await expect(
        queueTask({ organizationId: fx.orgId, actorId: fx.ownerId, title: "One too many" }),
      ).rejects.toMatchObject({
        publicMessage: expect.stringMatching(/buy another pack|move up a plan/i),
      });

      // And nothing was written — no half-created task sitting unpaid.
      const count = await pool.query(`SELECT count(*)::int n FROM tasks WHERE organization_id = $1`, [
        fx.orgId,
      ]);
      expect((count.rows[0] as { n: number }).n).toBe(1);
    });

    it("ties each spend to the task it paid for", async () => {
      const task = await queueTask({
        organizationId: f.orgId,
        actorId: f.ownerId,
        title: "Traceable",
      });

      const entry = await pool.query<{ task_id: string; type: string }>(
        `SELECT task_id, type FROM credit_ledger WHERE organization_id = $1 AND type = 'consume'`,
        [f.orgId],
      );
      // "Where did my five tasks go" has to be answerable per task.
      expect(entry.rows[0]!.task_id).toBe(task.id);
    });

    it("does not charge for work the team raises on the customer's behalf", async () => {
      const before = (await balanceFor(f.orgId)).remaining;
      await queueTask({
        organizationId: f.orgId,
        actorId: f.ownerId,
        title: "We spotted this ourselves",
        skipCredit: true,
      });
      expect((await balanceFor(f.orgId)).remaining).toBe(before);
    });

    it("lets a customer submit more tasks than they can have worked at once", async () => {
      // 10 credits, concurrency 2. Allowance and concurrency are different
      // limits and conflating them would refuse work already paid for.
      for (let i = 0; i < 6; i += 1) {
        await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: `T${i}` });
      }
      const queued = await pool.query(
        `SELECT count(*)::int n FROM tasks WHERE organization_id = $1 AND state = 'queued'`,
        [f.orgId],
      );
      expect((queued.rows[0] as { n: number }).n).toBe(6);
    });
  });

  describe("estimation against the ceiling", () => {
    it("clears a task that fits", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Small" });
      const outcome = await estimateTask({ taskId: task.id, actorId: f.ownerId, hours: 6 });

      expect(outcome.allowed).toBe(true);
      const row = await pool.query<{ blocked_at: Date | null; estimated_hours: string }>(
        `SELECT blocked_at, estimated_hours FROM tasks WHERE id = $1`,
        [task.id],
      );
      expect(row.rows[0]!.blocked_at).toBeNull();
      expect(Number(row.rows[0]!.estimated_hours)).toBe(6);
    });

    it("allows an estimate exactly on the ceiling", async () => {
      // A plan sold as "up to 8 hours" that rejects 8 hours lies by an hour,
      // and that is not an argument worth having with a customer.
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Exact" });
      expect((await estimateTask({ taskId: task.id, actorId: f.ownerId, hours: 8 })).allowed).toBe(
        true,
      );
    });

    it("holds a task that exceeds the ceiling and names the plan that covers it", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Big" });
      const outcome = await estimateTask({ taskId: task.id, actorId: f.ownerId, hours: 14 });

      expect(outcome.allowed).toBe(false);
      expect(outcome.blockedReason).toMatch(/14 hours/);
      expect(outcome.blockedReason).toMatch(/8 hours/);
      // Telling someone to "upgrade" without saying to what is how a blocked
      // task becomes a support ticket instead of a sale.
      expect(outcome.suggestedPlan?.code).toBe("professional");
    });

    it("STOPS a held task from entering development", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Big" });
      await estimateTask({ taskId: task.id, actorId: f.ownerId, hours: 20 });

      // Without this the block is a label on a screen, not a gate.
      await expect(
        transitionTask({
          taskId: task.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next: "in_progress",
        }),
      ).rejects.toBeInstanceOf(QueueRuleError);

      const state = await pool.query<{ state: string }>(`SELECT state FROM tasks WHERE id = $1`, [
        task.id,
      ]);
      expect(state.rows[0]!.state).toBe("queued");
    });

    it("explains the refusal as a size problem, not a capacity one", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Big" });
      await estimateTask({ taskId: task.id, actorId: f.ownerId, hours: 20 });

      let message = "";
      try {
        await transitionTask({
          taskId: task.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next: "in_progress",
        });
      } catch (error) {
        message = (error as Error).message;
      }

      // Saying "you're at 2 of 2" here sends them to entirely the wrong answer.
      expect(message).toMatch(/over the/i);
      expect(message).not.toMatch(/at a time/i);
    });

    it("still lets a customer cancel a held task", async () => {
      // They have decided not to pay to upgrade. Trapping the task would be
      // both rude and a support burden.
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Big" });
      await estimateTask({ taskId: task.id, actorId: f.ownerId, hours: 20 });

      await expect(
        transitionTask({
          taskId: task.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next: "cancelled",
        }),
      ).resolves.toBeUndefined();
    });

    it("clears the block automatically when the task is re-scoped smaller", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Big" });
      await estimateTask({ taskId: task.id, actorId: f.ownerId, hours: 20 });
      await estimateTask({ taskId: task.id, actorId: f.ownerId, hours: 5 });

      const row = await pool.query<{ blocked_at: Date | null }>(
        `SELECT blocked_at FROM tasks WHERE id = $1`,
        [task.id],
      );
      // Nobody should have to remember to unblock it by hand.
      expect(row.rows[0]!.blocked_at).toBeNull();

      await expect(
        transitionTask({
          taskId: task.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next: "in_progress",
        }),
      ).resolves.toBeUndefined();
    });

    it("lets someone senior absorb an oversized task deliberately", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Big" });
      await estimateTask({ taskId: task.id, actorId: f.ownerId, hours: 20 });

      expect(
        await clearBlock({ taskId: task.id, actorId: f.ownerId, reason: "Goodwill" }),
      ).toBe(true);

      await expect(
        transitionTask({
          taskId: task.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next: "in_progress",
        }),
      ).resolves.toBeUndefined();
    });

    it("applies no ceiling when the customer has none", async () => {
      const fx = await reset({ credits: 5, maxTaskHours: null });
      const task = await queueTask({ organizationId: fx.orgId, actorId: fx.ownerId, title: "Huge" });
      expect((await estimateTask({ taskId: task.id, actorId: fx.ownerId, hours: 500 })).allowed).toBe(
        true,
      );
    });

    it("refuses to estimate a closed task", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Done" });
      for (const next of ["in_progress", "in_review", "shipped"] as const) {
        await transitionTask({ taskId: task.id, organizationId: f.orgId, actorId: f.ownerId, next });
      }
      await expect(
        estimateTask({ taskId: task.id, actorId: f.ownerId, hours: 3 }),
      ).rejects.toBeInstanceOf(ReviewError);
    });

    it("records estimation on the timeline", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "T" });
      await estimateTask({ taskId: task.id, actorId: f.ownerId, hours: 4 });
      await estimateTask({ taskId: task.id, actorId: f.ownerId, hours: 40 });

      const events = await pool.query<{ type: string }>(
        `SELECT type FROM task_events WHERE task_id = $1 ORDER BY created_at`,
        [task.id],
      );
      expect(events.rows.map((r: { type: string }) => r.type)).toEqual([
        "queued",
        "estimated",
        "blocked",
      ]);
    });
  });

  describe("comments", () => {
    it("records a comment and puts it on the timeline", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "T" });
      await postComment({
        taskId: task.id,
        organizationId: f.orgId,
        authorId: f.ownerId,
        body: "  Which product page exactly?  ",
        authorIsInternal: true,
      });

      const thread = await commentsFor({ taskId: task.id, organizationId: f.orgId });
      expect(thread).toHaveLength(1);
      expect(thread[0]!.body).toBe("Which product page exactly?");
      expect(thread[0]!.authorName).toBe("Owner");

      const events = await pool.query<{ type: string }>(
        `SELECT type FROM task_events WHERE task_id = $1 ORDER BY created_at`,
        [task.id],
      );
      expect(events.rows.map((r: { type: string }) => r.type)).toContain("comment");
    });

    it("hides internal notes from the customer thread by default", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "T" });
      await postComment({
        taskId: task.id, organizationId: f.orgId, authorId: f.ownerId,
        body: "Customer-visible question", authorIsInternal: true,
      });
      await postComment({
        taskId: task.id, organizationId: f.orgId, authorId: f.ownerId,
        body: "Internal: this smells like the theme upgrade", isInternal: true,
        authorIsInternal: true,
      });

      // The default is the safe answer, so a new call site that forgets to
      // think about visibility cannot leak staff notes.
      const customerView = await commentsFor({ taskId: task.id, organizationId: f.orgId });
      expect(customerView).toHaveLength(1);
      expect(JSON.stringify(customerView)).not.toContain("theme upgrade");

      const staffView = await commentsFor({
        taskId: task.id, organizationId: f.orgId, includeInternal: true,
      });
      expect(staffView).toHaveLength(2);
    });

    it("will not let a customer post a hidden comment", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "T" });
      await postComment({
        taskId: task.id, organizationId: f.orgId, authorId: f.memberId,
        body: "Trying to hide this", isInternal: true, authorIsInternal: false,
      });

      const customerView = await commentsFor({ taskId: task.id, organizationId: f.orgId });
      expect(customerView).toHaveLength(1);
      expect(customerView[0]!.isInternal).toBe(false);
    });

    it("cannot attach a comment to another tenant's task", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Mine" });
      const rival = (
        await pool.query<{ id: string }>(
          `INSERT INTO organizations (name, slug) VALUES ('Rival','rival') RETURNING id`,
        )
      ).rows[0]!.id;

      await expect(
        postComment({
          taskId: task.id, organizationId: rival, authorId: f.ownerId,
          body: "Should not land", authorIsInternal: true,
        }),
      ).rejects.toBeInstanceOf(CommentError);

      expect(await commentsFor({ taskId: task.id, organizationId: f.orgId })).toHaveLength(0);
    });

    it("refuses empty and oversized comments", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "T" });
      const base = {
        taskId: task.id, organizationId: f.orgId, authorId: f.ownerId, authorIsInternal: true,
      };

      await expect(postComment({ ...base, body: "   " })).rejects.toBeInstanceOf(CommentError);
      await expect(postComment({ ...base, body: "x".repeat(5001) })).rejects.toBeInstanceOf(
        CommentError,
      );
    });
  });
});
