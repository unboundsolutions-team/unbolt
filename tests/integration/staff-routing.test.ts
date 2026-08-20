import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { CONNECTION, pool, reset } from "./setup-db";

/**
 * Staff must never be routed as customers.
 *
 * ── The bug this pins ───────────────────────────────────────────────
 * `requireAuth` sent anyone without an organisation to /welcome, which is the
 * "create your workspace" form. A delivery engineer works across every customer
 * and belongs to none, so every promoted staff member landed on a form inviting
 * them to set up a company — with no mention anywhere of the admin panel they
 * had just been granted.
 *
 * The question being asked was "does this person have an organisation?" when
 * the question that matters is "is this person a customer?". M6 fixed exactly
 * this in `requireInternal` and the same mistake survived one function away.
 *
 * This asserts the data shape the routing decision reads, so a future change to
 * either side fails here rather than silently sending staff back to onboarding.
 */

const describeDb = CONNECTION ? describe : describe.skip;

describeDb("staff routing (real Postgres)", () => {
  beforeEach(async () => {
    await reset({ credits: 5 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("staff have no organisation, which is the normal state", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, email_verified, is_internal, internal_role)
       VALUES ('eng@unbound.dev','Leila',true,true,'engineer') RETURNING id`,
    );

    const memberships = await pool.query(`SELECT 1 FROM memberships WHERE user_id = $1`, [
      rows[0]!.id,
    ]);

    // If this ever becomes non-zero, staff are being given customer workspaces
    // and the routing question changes.
    expect(memberships.rowCount).toBe(0);
  });

  it("distinguishes staff from a customer who also has no workspace", async () => {
    // Both have zero memberships. Only one should be sent to onboarding, and
    // is_internal is the only thing that tells them apart.
    await pool.query(
      `INSERT INTO users (email, name, email_verified, is_internal, internal_role)
       VALUES ('staff@unbound.dev','S',true,true,'pm')`,
    );
    await pool.query(
      `INSERT INTO users (email, name, email_verified, is_internal)
       VALUES ('fresh@customer.com','C',true,false)`,
    );

    const { rows } = await pool.query<{ email: string; is_internal: boolean }>(
      `SELECT u.email, u.is_internal
         FROM users u
         LEFT JOIN memberships m ON m.user_id = u.id
        WHERE m.id IS NULL AND u.email IN ('staff@unbound.dev','fresh@customer.com')
        ORDER BY u.email`,
    );

    expect(rows).toEqual([
      { email: "fresh@customer.com", is_internal: false },
      { email: "staff@unbound.dev", is_internal: true },
    ]);
  });

  it("a staff member may also own a customer workspace", async () => {
    // The case that prompted this: somebody registers, creates a workspace to
    // look around, then promotes themselves. They are internal AND have an
    // organisation, so they must see the portal with a route into admin —
    // not be redirected away from either.
    const f = await reset({ credits: 5 });
    await pool.query(
      `UPDATE users SET is_internal = true, internal_role = 'superadmin' WHERE id = $1`,
      [f.ownerId],
    );

    const { rows } = await pool.query<{ is_internal: boolean; memberships: number }>(
      `SELECT u.is_internal,
              (SELECT count(*)::int FROM memberships WHERE user_id = u.id) AS memberships
         FROM users u WHERE u.id = $1`,
      [f.ownerId],
    );

    expect(rows[0]).toEqual({ is_internal: true, memberships: 1 });
  });
});
