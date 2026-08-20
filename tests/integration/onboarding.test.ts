import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CONNECTION, pool, testDb } from "./setup-db";

// `schema` is re-exported from the same module and pulled in by @/lib/auth,
// so the mock has to carry it too or the import graph breaks.
vi.mock("@/db/client", async () => ({
  db: testDb,
  schema: (await import("@/db/schema")) as unknown,
}));

const { createOrganizationFor, slugify } = await import("@/server/onboarding");

const describeDb = CONNECTION ? describe : describe.skip;

describeDb("onboarding (real Postgres)", () => {
  let userId: string;

  beforeEach(async () => {
    await pool.query("TRUNCATE users, organizations RESTART IDENTITY CASCADE");
    userId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (email, name, email_verified)
         VALUES ('new@acme.dev','New Person',true) RETURNING id`,
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates the organisation and the owner membership together", async () => {
    const { organizationId, slug } = await createOrganizationFor({
      userId,
      name: "Acme Supply Co.",
    });

    expect(slug).toBe("acme-supply-co");

    const membership = (
      await pool.query<{ role: string; user_id: string }>(
        `SELECT role, user_id FROM memberships WHERE organization_id = $1`,
        [organizationId],
      )
    ).rows;

    expect(membership).toHaveLength(1);
    expect(membership[0]!.role).toBe("owner");
    expect(membership[0]!.user_id).toBe(userId);
  });

  it("gives a new workspace the conservative plan defaults", async () => {
    const { organizationId } = await createOrganizationFor({ userId, name: "Defaults Co" });
    const org = (
      await pool.query<{ concurrency_limit: number; sla_hours: number; billing_type: string }>(
        `SELECT concurrency_limit, sla_hours, billing_type FROM organizations WHERE id = $1`,
        [organizationId],
      )
    ).rows[0]!;

    // A workspace must never start out able to run more work than the cheapest
    // plan sells, or the first customer to sign up gets Scale for free.
    expect(org.concurrency_limit).toBe(1);
    expect(org.sla_hours).toBe(48);
    expect(org.billing_type).toBe("trial");
  });

  it("resolves a duplicate name into a distinct slug rather than failing", async () => {
    const first = await createOrganizationFor({ userId, name: "Acme" });

    const other = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (email, name, email_verified)
         VALUES ('two@acme.dev','Two',true) RETURNING id`,
      )
    ).rows[0]!.id;

    const second = await createOrganizationFor({ userId: other, name: "Acme" });

    expect(first.slug).toBe("acme");
    expect(second.slug).not.toBe(first.slug);
    expect(second.slug.startsWith("acme-")).toBe(true);
  });

  it("leaves nothing behind when the organisation insert fails", async () => {
    // The whole reason this is one statement. Force a failure by exceeding what
    // the slug retry can resolve, then assert no orphan rows exist.
    const before = await pool.query(`SELECT count(*)::int n FROM memberships`);

    await expect(
      createOrganizationFor({ userId: "00000000-0000-0000-0000-000000000000", name: "Orphan" }),
    ).rejects.toThrow();

    const after = await pool.query(`SELECT count(*)::int n FROM memberships`);
    const orgs = await pool.query(`SELECT count(*)::int n FROM organizations WHERE name = 'Orphan'`);

    expect(after.rows[0]).toEqual(before.rows[0]);
    // An organisation with no owner is unrecoverable — nobody can be granted
    // access to it, because granting access needs an owner.
    expect((orgs.rows[0] as { n: number }).n).toBe(0);
  });

  describe("slugify", () => {
    it("strips punctuation and accents", () => {
      expect(slugify("Café Niño & Sons!")).toBe("cafe-nino-sons");
    });

    it("falls back rather than producing an empty slug", () => {
      // A name with no Latin characters would otherwise slug to "" and hit the
      // NOT NULL constraint instead of getting a suffix.
      expect(slugify("日本語")).toBe("workspace");
      expect(slugify("!!!")).toBe("workspace");
    });

    it("never ends in a hyphen after truncation", () => {
      const long = slugify("a".repeat(38) + " something else entirely");
      expect(long.endsWith("-")).toBe(false);
      expect(long.length).toBeLessThanOrEqual(40);
    });
  });
});
