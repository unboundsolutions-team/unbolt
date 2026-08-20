/**
 * Grant the first internal role, against whatever database you point it at.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 * There is deliberately no way to make yourself an admin from inside the
 * product — /admin/team requires you to already be one. That is correct, and it
 * leaves exactly one gap: the very first person, on a fresh deployment.
 *
 * The runbook used to close that gap with a hand-written UPDATE against
 * production. Two things are wrong with that. The schema requires `is_internal`
 * and `internal_role` to move together (a CHECK constraint from M0), so the
 * obvious one-column version fails in a way that reads like a database problem.
 * And an ad-hoc UPDATE writes nothing to the audit trail, so the most
 * privileged grant in the system is the only one with no record of who made it.
 *
 * ── Usage ───────────────────────────────────────────────────────────
 * The person must have registered through the site first — this promotes an
 * existing account, it does not create one, because creating a login outside
 * the auth system means a password hash written by hand.
 *
 *   # Against production. The URL is in the Netlify UI under the DB extension.
 *   NETLIFY_DATABASE_URL='postgres://…' npx tsx scripts/promote-admin.ts you@unboundsolutions.in
 *
 *   # Against local development.
 *   npx tsx scripts/promote-admin.ts you@example.com --role engineer
 */

import { sql } from "drizzle-orm";

import { db } from "../src/db/client";

const ROLES = ["engineer", "pm", "superadmin"] as const;
type Role = (typeof ROLES)[number];

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const roleFlag = args.indexOf("--role");
const role = (roleFlag >= 0 ? args[roleFlag + 1] : "superadmin") as Role;

if (!email) {
  console.error(
    "Usage: npx tsx scripts/promote-admin.ts <email> [--role engineer|pm|superadmin]",
  );
  process.exit(2);
}

if (!ROLES.includes(role)) {
  console.error(`--role must be one of: ${ROLES.join(", ")}. Got "${role}".`);
  process.exit(2);
}

function rowsOf<T>(result: unknown): T[] {
  const inner = (result as { rows?: unknown[] }).rows ?? result;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

async function main(): Promise<void> {
  const existing = rowsOf<{ id: string; name: string | null; internal_role: string | null }>(
    await db.execute(sql`
      SELECT id, name, internal_role FROM users WHERE lower(email) = lower(${email})
    `),
  );

  const user = existing[0];
  if (!user) {
    console.error(
      `No account for ${email}.\n\n` +
        "Register through the site first, then run this again. This promotes an " +
        "existing login rather than creating one — a password hash written by " +
        "hand outside the auth system is a login nobody can support.",
    );
    process.exit(1);
  }

  if (user.internal_role === role) {
    console.log(`${email} is already ${role}. Nothing to do.`);
    return;
  }

  // Both columns together: a CHECK constraint requires internal_role whenever
  // is_internal is set, so "staff with no role" is not a state the schema
  // allows and this does not try to produce one.
  const updated = rowsOf<{ email: string; internal_role: string }>(
    await db.execute(sql`
      WITH promoted AS (
        UPDATE users
           SET is_internal = true,
               internal_role = ${role}::internal_role
         WHERE id = ${user.id}::uuid
        RETURNING id, email, internal_role
      ),
      logged AS (
        -- The most privileged grant in the system should not be the only one
        -- with no record of who made it. actor_id is the subject here, because
        -- a bootstrap grant has no other actor to name.
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, metadata)
        SELECT id, 'internal_role.granted', 'user', id::text,
               jsonb_build_object(
                 'role', internal_role,
                 'via', 'scripts/promote-admin.ts',
                 -- ::text is not optional. previousRole is null on a first
                 -- promotion, and Postgres cannot infer a parameter's type from
                 -- a null inside jsonb_build_object — it refuses the whole
                 -- statement with "could not determine data type of parameter".
                 'previousRole', ${user.internal_role}::text
               )
        FROM promoted
      )
      SELECT email, internal_role FROM promoted
    `),
  );

  const result = updated[0];
  console.log(
    `${result?.email} is now ${result?.internal_role}.\n` +
      "They can reach /admin, and add everybody else from /admin/team — this " +
      "script should not need running twice.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("Promotion failed:", error);
    process.exit(1);
  });
