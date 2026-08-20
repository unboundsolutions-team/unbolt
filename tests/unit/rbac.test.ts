import { describe, expect, it } from "vitest";

import type { OrgRole } from "@/db/schema";
import {
  PERMISSIONS,
  can,
  canActOnMember,
  canGrantRole,
  permissionsFor,
  type Permission,
} from "@/server/rbac";

const ROLES: OrgRole[] = ["owner", "admin", "member", "viewer"];

describe("permission matrix", () => {
  it("gives every role a defined permission set", () => {
    for (const role of ROLES) expect(permissionsFor(role).length).toBeGreaterThan(0);
  });

  it("only ever grants permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of ROLES) {
      for (const p of permissionsFor(role)) expect(known.has(p)).toBe(true);
    }
  });

  it("makes owner the only role that can delete the org or manage billing", () => {
    for (const p of ["org:delete", "billing:manage"] as Permission[]) {
      expect(can("owner", p)).toBe(true);
      expect(can("admin", p)).toBe(false);
      expect(can("member", p)).toBe(false);
      expect(can("viewer", p)).toBe(false);
    }
  });

  it("keeps viewer genuinely read-only", () => {
    for (const p of permissionsFor("viewer")) {
      expect(p.endsWith(":read")).toBe(true);
    }
  });

  it("does not let a member touch stores, people or billing", () => {
    const forbidden: Permission[] = [
      "store:connect",
      "store:disconnect",
      "member:invite",
      "member:remove",
      "member:change-role",
      "billing:read",
      "billing:manage",
      "org:update",
      "org:delete",
    ];
    for (const p of forbidden) expect(can("member", p)).toBe(false);
  });

  it("lets a member do the actual job", () => {
    for (const p of ["task:create", "task:comment", "task:cancel"] as Permission[]) {
      expect(can("member", p)).toBe(true);
    }
  });

  // Seniority must be a real containment relationship, or the hierarchy is
  // decorative and a "promotion" could silently remove an ability.
  it("makes each role a superset of the one below it", () => {
    const order: OrgRole[] = ["viewer", "member", "admin", "owner"];
    for (let i = 1; i < order.length; i += 1) {
      const lower = permissionsFor(order[i - 1] as OrgRole);
      const higher = new Set(permissionsFor(order[i] as OrgRole));
      for (const p of lower) {
        expect(higher.has(p), `${order[i]} is missing ${p} held by ${order[i - 1]}`).toBe(true);
      }
    }
  });
});

describe("acting on other members", () => {
  it("refuses to let anyone act at or above their own rank", () => {
    expect(canActOnMember("admin", "owner")).toBe(false);
    expect(canActOnMember("admin", "admin")).toBe(false);
    expect(canActOnMember("member", "member")).toBe(false);
    // An owner cannot remove a fellow owner — that is irreversible and has to
    // go through the person themselves or through support.
    expect(canActOnMember("owner", "owner")).toBe(false);
  });

  it("lets seniors act on juniors", () => {
    expect(canActOnMember("owner", "admin")).toBe(true);
    expect(canActOnMember("admin", "member")).toBe(true);
    expect(canActOnMember("member", "viewer")).toBe(true);
  });
});

describe("granting roles", () => {
  it("stops privilege escalation", () => {
    // The attack this blocks: an admin invites a second account as owner,
    // signs in as it, and now owns the organization.
    expect(canGrantRole("admin", "owner")).toBe(false);
    expect(canGrantRole("member", "admin")).toBe(false);
    expect(canGrantRole("viewer", "viewer")).toBe(false);
  });

  it("allows granting at or below your own rank, for roles that manage people", () => {
    expect(canGrantRole("owner", "owner")).toBe(true);
    expect(canGrantRole("owner", "admin")).toBe(true);
    expect(canGrantRole("admin", "admin")).toBe(true);
    expect(canGrantRole("admin", "member")).toBe(true);
  });

  it("never lets a role grant something it cannot itself exercise", () => {
    for (const actor of ROLES) {
      for (const target of ROLES) {
        if (!canGrantRole(actor, target)) continue;
        const actorPerms = new Set(permissionsFor(actor));
        for (const p of permissionsFor(target)) {
          expect(actorPerms.has(p), `${actor} may grant ${target} but lacks ${p}`).toBe(true);
        }
      }
    }
  });
});
