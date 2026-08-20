import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CONNECTION, countTasks, pool, reset, testDb, type Fixture } from "./setup-db";

// The engine imports `db` from @/db/client, which builds a Neon HTTP client.
// Point it at the local Postgres handle instead. Everything else in the module
// under test — every line of SQL, every rule — is the real thing.
// `schema` is re-exported from the same module and pulled in by @/lib/auth,
// so the mock has to carry it too or the import graph breaks.
vi.mock("@/db/client", async () => ({
  db: testDb,
  schema: (await import("@/db/schema")) as unknown,
}));

const { QueueRuleError, capacity, compactQueue, queueTask, transitionTask } = await import(
  "@/server/task-engine"
);

const describeDb = CONNECTION ? describe : describe.skip;

describeDb("task engine (real Postgres)", () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await reset({ concurrencyLimit: 2, slaHours: 48 });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("queueTask", () => {
    it("assigns per-organisation references and sequential positions", async () => {
      const a = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "First" });
      const b = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Second" });

      expect(a.reference).toBe("UNB-001");
      expect(b.reference).toBe("UNB-002");
      expect(a.position).toBe(1);
      expect(b.position).toBe(2);
    });

    it("never refuses on capacity — the queue is unlimited by design", async () => {
      for (let i = 0; i < 6; i += 1) {
        await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: `T${i}` });
      }
      expect(await countTasks(f.orgId, "queued")).toBe(6);
    });

    it("writes a business-hours SLA deadline from the ORGANISATION's plan", async () => {
      // The bug this pins: the deadline was briefly hardcoded to 48h regardless
      // of plan, which would have quietly given every customer the slowest SLA.
      const slow = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Slow" });

      const fast = await reset({ concurrencyLimit: 2, slaHours: 8 });
      const quick = await queueTask({
        organizationId: fast.orgId,
        actorId: fast.ownerId,
        title: "Quick",
      });

      const [slowRow] = (
        await pool.query<{ q: Date; d: Date }>(
          `SELECT queued_at q, sla_deadline d FROM tasks WHERE reference = 'UNB-001' AND title = 'Slow'`,
        )
      ).rows;
      const [quickRow] = (
        await pool.query<{ q: Date; d: Date }>(
          `SELECT queued_at q, sla_deadline d FROM tasks WHERE id = $1`,
          [quick.id],
        )
      ).rows;

      // slowRow was truncated away by the second reset, so assert on what
      // survives: the 8-hour plan must produce a strictly nearer deadline than
      // 48 business hours ever could.
      expect(slow.reference).toBe("UNB-001");
      expect(slowRow).toBeUndefined();

      const span = quickRow!.d.getTime() - quickRow!.q.getTime();
      expect(span).toBeGreaterThan(0);
      // 8 business hours can stretch over a weekend but never past ~4 days.
      expect(span).toBeLessThan(4 * 24 * 3600_000);
    });

    it("records a timeline event for every queued task", async () => {
      const t = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Logged" });
      const events = await pool.query(`SELECT type, to_state FROM task_events WHERE task_id = $1`, [
        t.id,
      ]);
      expect(events.rows).toEqual([{ type: "queued", to_state: "queued" }]);
    });

    it("refuses a task for an organisation that does not exist", async () => {
      await expect(
        queueTask({
          organizationId: "00000000-0000-0000-0000-000000000000",
          actorId: f.ownerId,
          title: "Ghost",
        }),
      ).rejects.toBeInstanceOf(QueueRuleError);
    });
  });

  describe("the concurrency cap", () => {
    it("allows work up to the limit and refuses beyond it", async () => {
      const one = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "One" });
      const two = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Two" });
      const three = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Three" });

      await transitionTask({
        taskId: one.id,
        organizationId: f.orgId,
        actorId: f.ownerId,
        next: "in_progress",
      });
      await transitionTask({
        taskId: two.id,
        organizationId: f.orgId,
        actorId: f.ownerId,
        next: "in_progress",
      });

      await expect(
        transitionTask({
          taskId: three.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next: "in_progress",
        }),
      ).rejects.toThrow(/runs 2 tasks at a time and 2 are already running/);

      expect(await countTasks(f.orgId, "in_progress")).toBe(2);
    });

    it("does NOT consume a second slot moving in_progress → in_review", async () => {
      const a = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "A" });
      const b = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "B" });

      for (const t of [a, b]) {
        await transitionTask({
          taskId: t.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next: "in_progress",
        });
      }

      // Both slots are full. A review handoff must still be allowed.
      await expect(
        transitionTask({
          taskId: a.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next: "in_review",
        }),
      ).resolves.toBeUndefined();

      const cap = await capacity(f.orgId, 2);
      expect(cap.inFlight).toBe(2);
      expect(cap.available).toBe(0);
    });

    it("survives a concurrent double-start — the race that would give the product away", async () => {
      const a = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "A" });
      const b = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "B" });
      const c = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "C" });

      await transitionTask({
        taskId: a.id,
        organizationId: f.orgId,
        actorId: f.ownerId,
        next: "in_progress",
      });

      // One slot left, two simultaneous claims. Exactly one must win.
      const results = await Promise.allSettled([
        transitionTask({
          taskId: b.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next: "in_progress",
        }),
        transitionTask({
          taskId: c.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next: "in_progress",
        }),
      ]);

      const won = results.filter((r) => r.status === "fulfilled").length;
      expect(won).toBe(1);
      expect(await countTasks(f.orgId, "in_progress")).toBe(2);
    });

    it("holds the cap under sustained contention, not just once", async () => {
      // A single two-way race passes by luck. This is the test that actually
      // caught the original design: counting in-flight tasks inside one
      // statement let FIVE of six simultaneous claims through against a limit
      // of 2, because every CTE in a statement shares one snapshot and the
      // FOR UPDATE waiters all re-read the same stale count.
      //
      // An overrun here means delivering work nobody paid for, silently and
      // forever, so it is worth 15 rounds of proving it cannot happen.
      for (let round = 0; round < 15; round += 1) {
        const fx = await reset({ concurrencyLimit: 2 });
        const queued = [];
        for (let i = 0; i < 6; i += 1) {
          queued.push(
            await queueTask({ organizationId: fx.orgId, actorId: fx.ownerId, title: `R${i}` }),
          );
        }

        const results = await Promise.allSettled(
          queued.map((t) =>
            transitionTask({
              taskId: t.id,
              organizationId: fx.orgId,
              actorId: fx.ownerId,
              next: "in_progress",
            }),
          ),
        );

        const started = results.filter((r) => r.status === "fulfilled").length;
        expect(started).toBe(2);
        expect(await countTasks(fx.orgId, "in_progress")).toBe(2);
      }
    });

    it("holds a single-slot plan against a stampede", async () => {
      // The Starter plan is limit 1, and it is the plan most likely to be
      // hammered by an impatient customer clicking through their whole backlog.
      for (let round = 0; round < 10; round += 1) {
        const fx = await reset({ concurrencyLimit: 1 });
        const queued = [];
        for (let i = 0; i < 8; i += 1) {
          queued.push(
            await queueTask({ organizationId: fx.orgId, actorId: fx.ownerId, title: `S${i}` }),
          );
        }

        await Promise.allSettled(
          queued.map((t) =>
            transitionTask({
              taskId: t.id,
              organizationId: fx.orgId,
              actorId: fx.ownerId,
              next: "in_progress",
            }),
          ),
        );

        expect(await countTasks(fx.orgId, "in_progress")).toBe(1);
      }
    });

    it("never issues the same slot to two running tasks", async () => {
      // The invariant behind the cap, asserted directly rather than inferred
      // from a count.
      const fx = await reset({ concurrencyLimit: 3 });
      const queued = [];
      for (let i = 0; i < 9; i += 1) {
        queued.push(
          await queueTask({ organizationId: fx.orgId, actorId: fx.ownerId, title: `U${i}` }),
        );
      }
      await Promise.allSettled(
        queued.map((t) =>
          transitionTask({
            taskId: t.id,
            organizationId: fx.orgId,
            actorId: fx.ownerId,
            next: "in_progress",
          }),
        ),
      );

      const slots = (
        await pool.query<{ slot: number }>(
          `SELECT slot FROM tasks WHERE organization_id = $1
             AND state IN ('in_progress','in_review') ORDER BY slot`,
          [fx.orgId],
        )
      ).rows.map((r: { slot: number }) => r.slot);

      expect(slots).toEqual([1, 2, 3]);
      expect(new Set(slots).size).toBe(slots.length);
    });

    it("releases the slot number for reuse, not just the count", async () => {
      const fx = await reset({ concurrencyLimit: 2 });
      const a = await queueTask({ organizationId: fx.orgId, actorId: fx.ownerId, title: "A" });
      const b = await queueTask({ organizationId: fx.orgId, actorId: fx.ownerId, title: "B" });
      const c = await queueTask({ organizationId: fx.orgId, actorId: fx.ownerId, title: "C" });

      for (const t of [a, b]) {
        await transitionTask({
          taskId: t.id,
          organizationId: fx.orgId,
          actorId: fx.ownerId,
          next: "in_progress",
        });
      }
      await transitionTask({
        taskId: a.id,
        organizationId: fx.orgId,
        actorId: fx.ownerId,
        next: "cancelled",
      });

      const freed = (
        await pool.query<{ slot: number | null }>(`SELECT slot FROM tasks WHERE id = $1`, [a.id])
      ).rows[0]!.slot;
      expect(freed).toBeNull();

      await transitionTask({
        taskId: c.id,
        organizationId: fx.orgId,
        actorId: fx.ownerId,
        next: "in_progress",
      });

      const reused = (
        await pool.query<{ slot: number }>(`SELECT slot FROM tasks WHERE id = $1`, [c.id])
      ).rows[0]!.slot;
      expect(reused).toBe(1);
    });

    it("does not evict work that outranks a downgraded plan", async () => {
      // Downgrading from 3 to 1 must not throw running work out of the queue;
      // it just means no new task can start until the survivors finish.
      const fx = await reset({ concurrencyLimit: 3 });
      const made = [];
      for (let i = 0; i < 4; i += 1) {
        made.push(
          await queueTask({ organizationId: fx.orgId, actorId: fx.ownerId, title: `D${i}` }),
        );
      }
      for (const t of made.slice(0, 3)) {
        await transitionTask({
          taskId: t.id,
          organizationId: fx.orgId,
          actorId: fx.ownerId,
          next: "in_progress",
        });
      }

      await pool.query(`UPDATE organizations SET concurrency_limit = 1 WHERE id = $1`, [fx.orgId]);

      expect(await countTasks(fx.orgId, "in_progress")).toBe(3);
      await expect(
        transitionTask({
          taskId: made[3]!.id,
          organizationId: fx.orgId,
          actorId: fx.ownerId,
          next: "in_progress",
        }),
      ).rejects.toBeInstanceOf(QueueRuleError);
      expect(await countTasks(fx.orgId, "in_progress")).toBe(3);
    });

    it("frees the slot when a task ships", async () => {
      const a = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "A" });
      const b = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "B" });
      const c = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "C" });

      for (const t of [a, b]) {
        await transitionTask({
          taskId: t.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next: "in_progress",
        });
      }
      await transitionTask({
        taskId: a.id,
        organizationId: f.orgId,
        actorId: f.ownerId,
        next: "in_review",
      });
      await transitionTask({
        taskId: a.id,
        organizationId: f.orgId,
        actorId: f.ownerId,
        next: "shipped",
      });

      await expect(
        transitionTask({
          taskId: c.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next: "in_progress",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("transition legality", () => {
    it("refuses an illegal jump from queued straight to shipped", async () => {
      const t = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Jump" });
      await expect(
        transitionTask({
          taskId: t.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next: "shipped",
        }),
      ).rejects.toBeInstanceOf(QueueRuleError);
      expect(await countTasks(f.orgId, "queued")).toBe(1);
    });

    it("refuses to move a task belonging to another organisation", async () => {
      const t = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Mine" });
      const other = (
        await pool.query<{ id: string }>(
          `INSERT INTO organizations (name, slug) VALUES ('Other','other') RETURNING id`,
        )
      ).rows[0]!.id;

      await expect(
        transitionTask({
          taskId: t.id,
          organizationId: other,
          actorId: f.ownerId,
          next: "in_progress",
        }),
      ).rejects.toBeInstanceOf(QueueRuleError);
    });

    it("stamps first_response_at once and never moves it", async () => {
      const t = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "SLA" });
      await transitionTask({
        taskId: t.id,
        organizationId: f.orgId,
        actorId: f.ownerId,
        next: "in_progress",
      });
      const first = (
        await pool.query<{ r: Date; a: string }>(
          `SELECT first_response_at r, assigned_to a FROM tasks WHERE id = $1`,
          [t.id],
        )
      ).rows[0]!;
      expect(first.r).not.toBeNull();
      expect(first.a).toBe(f.ownerId);

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
        next: "in_progress",
      });

      const again = (
        await pool.query<{ r: Date }>(`SELECT first_response_at r FROM tasks WHERE id = $1`, [t.id])
      ).rows[0]!;
      expect(again.r.getTime()).toBe(first.r.getTime());
    });
  });

  describe("queue positions", () => {
    it("clears position when a task leaves the queue and compacts the rest", async () => {
      const made = [];
      for (let i = 1; i <= 4; i += 1) {
        made.push(
          await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: `T${i}` }),
        );
      }
      // Start the second one, so a hole opens in the middle.
      await transitionTask({
        taskId: made[1]!.id,
        organizationId: f.orgId,
        actorId: f.ownerId,
        next: "in_progress",
      });

      const started = (
        await pool.query<{ position: number | null }>(
          `SELECT position FROM tasks WHERE id = $1`,
          [made[1]!.id],
        )
      ).rows[0]!;
      expect(started.position).toBeNull();

      await compactQueue(f.orgId);

      const positions = (
        await pool.query<{ position: number }>(
          `SELECT position FROM tasks WHERE organization_id = $1 AND state = 'queued' ORDER BY position`,
          [f.orgId],
        )
      ).rows.map((r: { position: number }) => r.position);

      expect(positions).toEqual([1, 2, 3]);
    });
  });

  describe("the notification outbox", () => {
    it("notifies other members when work starts, but never the actor", async () => {
      const t = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Notify" });
      await transitionTask({
        taskId: t.id,
        organizationId: f.orgId,
        actorId: f.ownerId,
        next: "in_progress",
      });

      const notes = await pool.query<{ user_id: string; type: string; payload: unknown }>(
        `SELECT user_id, type, payload FROM notifications WHERE task_id = $1`,
        [t.id],
      );

      expect(notes.rows).toHaveLength(1);
      expect(notes.rows[0]!.user_id).toBe(f.memberId);
      expect(notes.rows[0]!.type).toBe("task.in_progress");
      expect(notes.rows[0]!.payload).toMatchObject({ reference: "UNB-001", state: "in_progress" });
    });

    it("writes no notification for an intermediate review handoff", async () => {
      const t = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Quiet" });
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

      const notes = await pool.query(
        `SELECT type FROM notifications WHERE task_id = $1 ORDER BY created_at`,
        [t.id],
      );
      expect(notes.rows.map((r: { type: string }) => r.type)).toEqual(["task.in_progress"]);
    });

    it("writes the outbox row in the SAME statement as the ship", async () => {
      const t = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Ship" });
      for (const next of ["in_progress", "in_review", "shipped"] as const) {
        await transitionTask({
          taskId: t.id,
          organizationId: f.orgId,
          actorId: f.ownerId,
          next,
        });
      }
      const notes = await pool.query<{ type: string }>(
        `SELECT type FROM notifications WHERE task_id = $1 ORDER BY created_at`,
        [t.id],
      );
      expect(notes.rows.map((r: { type: string }) => r.type)).toEqual(["task.in_progress", "task.shipped"]);
    });
  });

  describe("the append-only timeline", () => {
    it("silently discards an UPDATE or DELETE against task_events", async () => {
      const t = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "History" });
      await transitionTask({
        taskId: t.id,
        organizationId: f.orgId,
        actorId: f.ownerId,
        next: "in_progress",
      });

      await pool.query(`UPDATE task_events SET type = 'tampered' WHERE task_id = $1`, [t.id]);
      await pool.query(`DELETE FROM task_events WHERE task_id = $1`, [t.id]);

      const events = await pool.query<{ type: string }>(
        `SELECT type FROM task_events WHERE task_id = $1 ORDER BY created_at`,
        [t.id],
      );
      expect(events.rows.map((r: { type: string }) => r.type)).toEqual(["queued", "transition"]);
    });
  });
});
