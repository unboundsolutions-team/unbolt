import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/db/client";
import { memberships, organizations, users } from "@/db/schema";
import type { OrgRole } from "@/db/schema";
import { auth } from "@/lib/auth";

import { getSessionUser } from "./onboarding";
import { ForbiddenError, can, permissionsFor, type Permission } from "./rbac";

/**
 * The server-side authorization boundary.
 *
 * Middleware can only check that a session cookie exists — it runs at the edge
 * with no database. So this module is where "is this person allowed?" is
 * actually answered, and every portal page and mutation must go through it.
 *
 * The rule: **never trust an organization id that arrived from the client.**
 * A URL, form field or header naming an org is an assertion, not a fact. Every
 * function here re-derives membership from the session against the database.
 */

export interface AuthContext {
  userId: string;
  email: string;
  name: string | null;
  isInternal: boolean;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrgRole;
  permissions: readonly Permission[];
}

/**
 * `cache` dedupes this for the lifetime of one request, so a layout and three
 * nested server components resolving the same context cost one set of queries
 * rather than four.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;

  const userId = session.user.id;

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isInternal: users.isInternal,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;

  // The session may name an active org; it is only honoured if the database
  // agrees the user is still a member. A revoked membership must take effect
  // immediately, not whenever the session happens to expire.
  const claimed = (session.session as { activeOrganizationId?: string | null })
    .activeOrganizationId;

  const rows = await db
    .select({
      organizationId: memberships.organizationId,
      role: memberships.role,
      name: organizations.name,
      slug: organizations.slug,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      claimed
        ? and(eq(memberships.userId, userId), eq(memberships.organizationId, claimed))
        : eq(memberships.userId, userId),
    )
    .limit(1);

  const membership = rows[0];
  if (!membership) return null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    isInternal: user.isInternal,
    organizationId: membership.organizationId,
    organizationName: membership.name,
    organizationSlug: membership.slug,
    role: membership.role,
    permissions: permissionsFor(membership.role),
  };
});

/**
 * For pages. Redirects rather than throwing, and carries the intended
 * destination so the user lands where they were going after signing in.
 */
export async function requireAuth(returnTo?: string): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (ctx) return ctx;

  // A null context has two very different causes and they need different exits.
  //
  // Sending both to /login produced an infinite redirect for anyone who had
  // just registered: they hold a valid session, so middleware bounces /login
  // straight back to /app, which redirects to /login again. The user sees the
  // browser flicker and never reaches anything.
  const user = await getSessionUser();

  if (user && !user.hasOrganization) {
    /*
     * Staff are not customers, and /welcome asks you to create a workspace.
     *
     * A delivery engineer works across every customer and belongs to none, so
     * they have no membership — and every one of them was landing on a form
     * inviting them to set up a company. The admin panel they were promoted to
     * use was never mentioned, and there is no link to it from anywhere on the
     * customer side.
     *
     * This is the same class of mistake as M6's `requireInternal`, which sent
     * staff to /welcome for the same reason: asking "does this person have an
     * organisation?" when the question is "is this person a customer?".
     */
    redirect(user.isInternal ? "/admin" : "/welcome");
  }

  const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login";
  redirect(target);
}

/**
 * For pages that need a specific capability. A member hitting /app/billing
 * should be told no, not shown a broken page.
 */
export async function requirePermission(
  permission: Permission,
  returnTo?: string,
): Promise<AuthContext> {
  const ctx = await requireAuth(returnTo);
  if (!can(ctx.role, permission)) {
    throw new ForbiddenError(
      `Role "${ctx.role}" does not carry "${permission}".`,
      permission,
    );
  }
  return ctx;
}

/**
 * For mutations — server actions and route handlers. Throws instead of
 * redirecting, because a POST should fail loudly rather than 302 to a page.
 */
export async function assertPermission(
  ctx: AuthContext,
  permission: Permission,
): Promise<void> {
  if (!can(ctx.role, permission)) {
    throw new ForbiddenError(
      `Role "${ctx.role}" does not carry "${permission}".`,
      permission,
    );
  }
}

/** Gates /admin. Internal staff only — never a customer role, however senior. */
export interface InternalContext {
  userId: string;
  email: string;
  name: string | null;
}

/**
 * Gates /admin. Internal staff only — never a customer role, however senior.
 *
 * ── Why this does NOT go through requireAuth ────────────────────────
 * requireAuth resolves an organisation membership, and staff do not have one:
 * a delivery engineer works across every customer and belongs to none of them.
 * Routing them through it sent anyone on the team to /welcome to create a
 * workspace, which is both wrong and a confusing thing to be shown by your own
 * product on your first day.
 *
 * So this asks the narrower question — is this person signed in, and are they
 * staff — and returns only what an admin page legitimately needs. There is no
 * organisation on this context by design, which means an admin page cannot
 * accidentally scope itself to "the current org" and silently show one
 * customer's data on a page meant to show all of them.
 */
export async function requireInternal(): Promise<InternalContext> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/admin")}`);

  if (!user.isInternal) {
    throw new ForbiddenError("This area is restricted to Unbound staff.");
  }

  return { userId: user.userId, email: user.email, name: user.name };
}
