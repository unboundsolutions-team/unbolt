import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CONNECTION, pool, reset, testDb, type Fixture } from "./setup-db";

vi.mock("@/db/client", async () => ({
  db: testDb,
  schema: (await import("@/db/schema")) as unknown,
}));

const { assignTask, AssignmentError, assignableStaff, teamWorkload, unassignedCount } =
  await import("@/server/assignment");
const { queueTask, transitionTask } = await import("@/server/task-engine");
const { estimateTask } = await import("@/server/billing/review");

const describeDb = CONNECTION ? describe : describe.skip;

describeDb("assignment and workload (real Postgres)", () => {
  let f: Fixture;
  let engineerId: string;

  beforeEach(async () => {
    f = await reset({ credits: 20, concurrencyLimit: 3 });
    engineerId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (email, name, email_verified, is_internal, internal_role)
         VALUES ('eng@unbound.dev','Leila Haddad',true,true,'engineer') RETURNING id`,
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("assigns a task and records it on the timeline", async () => {
    const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "T" });
    const result = await assignTask({
      taskId: task.id,
      assigneeId: engineerId,
      actorId: engineerId,
    });

    expect(result.reference).toBe(task.reference);

    const row = await pool.query<{ assigned_to: string }>(
      `SELECT assigned_to FROM tasks WHERE id = $1`,
      [task.id],
    );
    expect(row.rows[0]!.assigned_to).toBe(engineerId);

    // "Who was working on this in March" is a question that gets asked.
    const events = await pool.query<{ type: string }>(
      `SELECT type FROM task_events WHERE task_id = $1 ORDER BY created_at`,
      [task.id],
    );
    expect(events.rows.map((r: { type: string }) => r.type)).toContain("assigned");
  });

  it("hands a task back when the assignee is cleared", async () => {
    const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "T" });
    await assignTask({ taskId: task.id, assigneeId: engineerId, actorId: engineerId });

    // An engineer going on leave needs to release their queue. Unassigning is a
    // real action, not an oversight.
    await assignTask({ taskId: task.id, assigneeId: null, actorId: engineerId });

    const row = await pool.query<{ assigned_to: string | null }>(
      `SELECT assigned_to FROM tasks WHERE id = $1`,
      [task.id],
    );
    expect(row.rows[0]!.assigned_to).toBeNull();

    const events = await pool.query<{ type: string }>(
      `SELECT type FROM task_events WHERE task_id = $1 ORDER BY created_at`,
      [task.id],
    );
    expect(events.rows.map((r: { type: string }) => r.type)).toContain("unassigned");
  });

  it("REFUSES to assign a task to a customer", async () => {
    const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "T" });

    // f.memberId is a customer. Assigning to them would put the task in the
    // workload of someone who cannot open /admin to see it.
    await expect(
      assignTask({ taskId: task.id, assigneeId: f.memberId, actorId: engineerId }),
    ).rejects.toBeInstanceOf(AssignmentError);

    const row = await pool.query<{ assigned_to: string | null }>(
      `SELECT assigned_to FROM tasks WHERE id = $1`,
      [task.id],
    );
    expect(row.rows[0]!.assigned_to).toBeNull();
  });

  it("refuses to assign closed work", async () => {
    const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "T" });
    await transitionTask({
      taskId: task.id, organizationId: f.orgId, actorId: f.ownerId, next: "cancelled",
    });

    await expect(
      assignTask({ taskId: task.id, assigneeId: engineerId, actorId: engineerId }),
    ).rejects.toBeInstanceOf(AssignmentError);
  });

  it("only offers internal staff as assignees", async () => {
    const staff = await assignableStaff();
    const emails = staff.map((s) => s.email);

    expect(emails).toContain("eng@unbound.dev");
    // Customers must never appear in the picker.
    expect(emails).not.toContain("owner@test.dev");
    expect(emails).not.toContain("member@test.dev");
  });

  describe("workload", () => {
    it("counts open work, running work and estimated hours", async () => {
      const a = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "A" });
      const b = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "B" });

      await estimateTask({ taskId: a.id, actorId: engineerId, hours: 4 });
      await estimateTask({ taskId: b.id, actorId: engineerId, hours: 2.5 });
      await assignTask({ taskId: a.id, assigneeId: engineerId, actorId: engineerId });
      await assignTask({ taskId: b.id, assigneeId: engineerId, actorId: engineerId });
      await transitionTask({
        taskId: a.id, organizationId: f.orgId, actorId: engineerId, next: "in_progress",
      });

      const [person] = (await teamWorkload()).filter((p) => p.userId === engineerId);
      expect(person!.open).toBe(2);
      expect(person!.inFlight).toBe(1);
      expect(person!.estimatedHours).toBe(6.5);
    });

    it("stops counting a task once it ships", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "T" });
      await assignTask({ taskId: task.id, assigneeId: engineerId, actorId: engineerId });

      for (const next of ["in_progress", "in_review", "shipped"] as const) {
        await transitionTask({
          taskId: task.id, organizationId: f.orgId, actorId: engineerId, next,
        });
      }

      const [person] = (await teamWorkload()).filter((p) => p.userId === engineerId);
      // Delivered work is history, not load. Counting it would make everyone
      // look permanently overloaded.
      expect(person!.open).toBe(0);
    });

    it("includes staff with nothing assigned", async () => {
      // A list that silently omits idle people answers the opposite of the
      // question the page exists to ask.
      const idle = (await teamWorkload()).find((p) => p.email === "eng@unbound.dev");
      expect(idle).toBeDefined();
      expect(idle!.open).toBe(0);
    });

    it("counts work nobody owns", async () => {
      await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "Orphan A" });
      const owned = await queueTask({
        organizationId: f.orgId, actorId: f.ownerId, title: "Owned",
      });
      await assignTask({ taskId: owned.id, assigneeId: engineerId, actorId: engineerId });

      expect(await unassignedCount()).toBe(1);
    });

    it("does not count closed work as unowned", async () => {
      const task = await queueTask({ organizationId: f.orgId, actorId: f.ownerId, title: "T" });
      expect(await unassignedCount()).toBe(1);

      await transitionTask({
        taskId: task.id, organizationId: f.orgId, actorId: f.ownerId, next: "cancelled",
      });
      expect(await unassignedCount()).toBe(0);
    });
  });
});
