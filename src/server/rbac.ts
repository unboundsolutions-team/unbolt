import type { OrgRole } from "@/db/schema";

/**
 * Authorization, as data.
 *
 * ── Why this is a pure module ───────────────────────────────────────
 * Middleware runs at the edge on Deno with no database (§6 of the brief), so it
 * can only ever check that a session cookie is *present*. That means every real
 * authorization decision has to happen somewhere else — and the safest place is
 * a pure function with no I/O, because it can be exhaustively unit-tested
 * without a database, an auth server or a browser.
 *
 * Nothing here reads a request, a session or a connection. It answers one
 * question: given a role, is this action allowed?
 */

/** Every distinct thing a member can attempt inside an organization. */
export const PERMISSIONS = [
  "task:create",
  "task:read",
  "task:comment",
  "task:cancel",
  "task:reprioritise",
  "store:read",
  "store:connect",
  "store:disconnect",
  "member:read",
  "member:invite",
  "member:change-role",
  "member:remove",
  "billing:read",
  "billing:manage",
  "org:read",
  "org:update",
  "org:delete",
  "apikey:read",
  "apikey:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The matrix. Roles are cumulative in practice but written out in full rather
 * than by inheritance — an explicit table is greppable, diffable in review, and
 * cannot surprise you when someone reorders the hierarchy.
 *
 * The shape of the product decision:
 *  - `viewer` is genuinely read-only. It exists so a client can give their
 *    agency or an investor visibility without handing over billing.
 *  - `member` is the default. It can queue and discuss work — that is the job —
 *    but cannot connect a store, touch billing or change who has access.
 *  - `admin` runs the account day to day, including people and stores, but
 *    cannot delete the organization or take over billing ownership.
 *  - `owner` is the only role that can delete the org or manage billing.
 *    At least one must always exist; the database enforces that with a trigger,
 *    not just this table.
 */
const MATRIX: Record<OrgRole, readonly Permission[]> = {
  viewer: ["task:read", "store:read", "member:read", "org:read"],

  member: [
    "task:create",
    "task:read",
    "task:comment",
    "task:cancel",
    "task:reprioritise",
    "store:read",
    "member:read",
    "org:read",
  ],

  admin: [
    "task:create",
    "task:read",
    "task:comment",
    "task:cancel",
    "task:reprioritise",
    "store:read",
    "store:connect",
    "store:disconnect",
    "member:read",
    "member:invite",
    "member:change-role",
    "member:remove",
    "billing:read",
    "org:read",
    "org:update",
    "apikey:read",
    "apikey:manage",
  ],

  owner: [...PERMISSIONS],
};

/** Does this role carry this permission? */
export function can(role: OrgRole, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

/** Every permission a role holds. Used to send a capability set to the client. */
export function permissionsFor(role: OrgRole): readonly Permission[] {
  return MATRIX[role];
}

/**
 * Role seniority, for comparisons. Deliberately NOT used to derive the matrix —
 * only to answer "may this actor act on that member?".
 */
const RANK: Record<OrgRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/**
 * Can `actor` change or remove `target`?
 *
 * The rule that matters: **you may not act on someone at or above your own
 * rank.** Without it an admin could demote an owner, or two admins could
 * demote each other in a loop. Owners are equals, so an owner cannot remove
 * another owner either — that has to go through the person themselves or
 * through support, which is the safe default for an irreversible action.
 */
export function canActOnMember(actor: OrgRole, target: OrgRole): boolean {
  return RANK[actor] > RANK[target];
}

/**
 * Can `actor` grant `role`?
 *
 * You may not grant a role senior to your own — otherwise an admin promotes
 * themselves to owner via a second account and the hierarchy is decorative.
 */
export function canGrantRole(actor: OrgRole, role: OrgRole): boolean {
  return RANK[actor] >= RANK[role] && actor !== "member" && actor !== "viewer";
}

/** Thrown by the guards in src/server/auth-context.ts. */
export class ForbiddenError extends Error {
  readonly permission: Permission | undefined;

  constructor(message: string, permission?: Permission) {
    super(message);
    this.name = "ForbiddenError";
    this.permission = permission;
  }
}
