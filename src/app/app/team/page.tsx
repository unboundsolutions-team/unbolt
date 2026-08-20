import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { memberships, users } from "@/db/schema";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import { requirePermission } from "@/server/auth-context";
import { can, canActOnMember } from "@/server/rbac";

export const dynamic = "force-dynamic";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requirePermission("member:read", "/app/team");

  // Scoped to the organization resolved from the SESSION, never from a
  // parameter. There is no way to ask this page for another org's members.
  const rows = await db
    .select({
      id: memberships.id,
      role: memberships.role,
      joinedAt: memberships.joinedAt,
      name: users.name,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, ctx.organizationId));

  const mayInvite = can(ctx.role, "member:invite");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Text variant="eyebrow">Team</Text>
          <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] text-ink">
            {ctx.organizationName}
          </h1>
        </div>
        {mayInvite ? (
          <span className="font-mono text-xs text-ink-3">Invitations ship in M4.</span>
        ) : null}
      </div>

      <div className="mt-10 w-full max-w-full overflow-x-auto [contain:paint]">
        <table className="w-full min-w-[38rem] border-collapse text-left">
          <caption className="sr-only">Members of {ctx.organizationName}</caption>
          <thead>
            <tr>
              {["Member", "Email", "Role", ""].map((h) => (
                <th
                  key={h}
                  className="border-b border-line-strong px-4 py-3 font-mono text-xs font-medium uppercase tracking-[0.12em] text-ink-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="transition-colors hover:bg-raised">
                <td className="border-b border-line px-4 py-3.5">
                  <span className="flex items-center gap-3">
                    <Avatar name={m.name ?? m.email} size="sm" />
                    <span className="text-sm text-ink">{m.name ?? "—"}</span>
                  </span>
                </td>
                <td className="border-b border-line px-4 py-3.5 font-mono text-xs text-ink-2">
                  {m.email}
                </td>
                <td className="border-b border-line px-4 py-3.5">
                  <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{m.role}</Badge>
                </td>
                <td className="border-b border-line px-4 py-3.5 text-right font-mono text-xs text-ink-3">
                  {/* Seniority, surfaced. You cannot act on a peer or a senior —
                      the same rule the server enforces on the mutation. */}
                  {can(ctx.role, "member:change-role") && canActOnMember(ctx.role, m.role)
                    ? "Editable"
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
