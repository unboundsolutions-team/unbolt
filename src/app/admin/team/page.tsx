import { sql } from "drizzle-orm";

import { StaffAccessForm, RevokeStaffButton } from "@/components/admin/staff-form";
import { Text } from "@/components/ui/text";
import { db } from "@/db/client";
import { requireInternal } from "@/server/auth-context";

export const dynamic = "force-dynamic";

export const metadata = { title: "Team" };

/**
 * Who can get into /admin.
 *
 * Until this page existed, promoting a colleague was a manual SQL UPDATE —
 * which meant only whoever had database access could add anyone to the team.
 */
export default async function AdminTeamPage() {
  const me = await requireInternal();

  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT id, email, name, internal_role::text AS internal_role, last_login_at, created_at
    FROM users WHERE is_internal
    ORDER BY internal_role, email
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  const team = (Array.isArray(result) ? result : []) as Record<string, unknown>[];

  const superadmins = team.filter((u) => u["internal_role"] === "superadmin").length;

  return (
    <>
      <Text variant="eyebrow">Team</Text>
      <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] text-ink">
        Who can reach admin
      </h1>
      <p className="mt-3 max-w-prose text-pretty font-sans text-sm leading-[1.6] text-ink-2">
        Staff see every customer&rsquo;s work. Access is all-or-nothing today — the role is
        recorded for later, but it does not yet restrict anything inside admin.
      </p>

      <ul className="mt-10 flex flex-col gap-3">
        {team.map((user) => {
          const email = String(user["email"]);
          const isMe = email.toLowerCase() === me.email.toLowerCase();
          const role = String(user["internal_role"] ?? "engineer");

          return (
            <li
              key={String(user["id"])}
              className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-(--radius-lg) border border-line bg-raised px-5 py-4"
            >
              <div className="min-w-0">
                <p className="truncate font-sans text-sm font-medium text-ink">
                  {user["name"] ? String(user["name"]) : email}
                  {isMe ? <span className="ml-2 font-normal text-ink-3">(you)</span> : null}
                </p>
                <p className="mt-1 truncate font-mono text-xs text-ink-3">
                  {email} &middot; {role}
                </p>
              </div>

              {/* Removing your own access locks you out of the page you are
                  standing on. The action refuses the last superadmin outright,
                  but not offering the button to yourself avoids the confusion
                  in the first place. */}
              {isMe ? (
                <span className="font-mono text-xs text-ink-3">
                  {superadmins === 1 ? "Last superadmin" : "Signed in"}
                </span>
              ) : (
                <RevokeStaffButton email={email} />
              )}
            </li>
          );
        })}
      </ul>

      <section className="mt-12 max-w-2xl rounded-(--radius-lg) border border-line bg-raised p-6">
        <Text variant="eyebrow">Grant access</Text>
        <p className="mb-5 mt-2 max-w-prose font-sans text-sm text-ink-2">
          They need an Unbolt account first — this promotes an existing one. Granting
          access does not give them a customer workspace, and it should not: staff work
          across every account rather than belonging to one.
        </p>
        <StaffAccessForm />
      </section>
    </>
  );
}
