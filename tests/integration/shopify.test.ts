import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CONNECTION, pool, reset, testDb, type Fixture } from "./setup-db";

vi.mock("@/db/client", async () => ({
  db: testDb,
  schema: (await import("@/db/schema")) as unknown,
}));

process.env["SHOPIFY_TOKEN_KEY"] = "integration-test-key-long-enough-32ch";

const { parseShopDomain } = await import("@/server/shopify/domain");
const { decryptToken } = await import("@/server/shopify/crypto");
const {
  consumeOAuthState,
  createOAuthState,
  disconnectByDomain,
  disconnectStore,
  purgeExpiredStates,
  recordConnection,
  StoreConnectionError,
  storesFor,
} = await import("@/server/shopify/store-service");

const describeDb = CONNECTION ? describe : describe.skip;
const SHOP = parseShopDomain("acme-store.myshopify.com")!;

describeDb("shopify store connections (real Postgres)", () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await reset();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("OAuth state nonces", () => {
    it("mints a nonce and consumes it exactly once", async () => {
      await createOAuthState({
        state: "nonce-1",
        shop: SHOP,
        organizationId: f.orgId,
        userId: f.ownerId,
      });

      const first = await consumeOAuthState("nonce-1");
      expect(first?.organizationId).toBe(f.orgId);
      expect(first?.shop).toBe(SHOP);

      // Replaying the same callback must not work a second time.
      expect(await consumeOAuthState("nonce-1")).toBeNull();
    });

    it("gives the nonce to exactly one of two racing callbacks", async () => {
      await createOAuthState({
        state: "nonce-race",
        shop: SHOP,
        organizationId: f.orgId,
        userId: f.ownerId,
      });

      const [a, b] = await Promise.all([
        consumeOAuthState("nonce-race"),
        consumeOAuthState("nonce-race"),
      ]);

      // A read-then-write would let both through under load.
      expect([a, b].filter(Boolean)).toHaveLength(1);
    });

    it("refuses an expired nonce", async () => {
      await createOAuthState({
        state: "nonce-old",
        shop: SHOP,
        organizationId: f.orgId,
        userId: f.ownerId,
      });
      await pool.query(`UPDATE oauth_states SET expires_at = now() - interval '1 minute'`);

      expect(await consumeOAuthState("nonce-old")).toBeNull();
    });

    it("refuses a nonce that was never minted", async () => {
      expect(await consumeOAuthState("attacker-invented-this")).toBeNull();
    });

    it("rejects a duplicate state value at the database level", async () => {
      await createOAuthState({
        state: "dup", shop: SHOP, organizationId: f.orgId, userId: f.ownerId,
      });
      await expect(
        createOAuthState({
          state: "dup", shop: SHOP, organizationId: f.orgId, userId: f.ownerId,
        }),
      ).rejects.toThrow();
    });

    it("sweeps only long-expired nonces", async () => {
      await createOAuthState({
        state: "fresh", shop: SHOP, organizationId: f.orgId, userId: f.ownerId,
      });
      await createOAuthState({
        state: "ancient", shop: SHOP, organizationId: f.orgId, userId: f.ownerId,
      });
      await pool.query(
        `UPDATE oauth_states SET expires_at = now() - interval '2 days' WHERE state = 'ancient'`,
      );

      await purgeExpiredStates();
      const left = await pool.query<{ state: string }>(`SELECT state FROM oauth_states`);
      expect(left.rows.map((r: { state: string }) => r.state)).toEqual(["fresh"]);
    });
  });

  describe("recording a connection", () => {
    it("stores the token encrypted, never in plaintext", async () => {
      await recordConnection({
        organizationId: f.orgId,
        userId: f.ownerId,
        shop: SHOP,
        accessToken: "shpat_supersecret_value",
        scope: "read_products,read_themes,read_orders,read_script_tags",
        profile: { name: "Acme Store", planName: "Shopify Plus", currency: "USD" },
      });

      const row = (
        await pool.query<{ access_token_encrypted: string }>(
          `SELECT access_token_encrypted FROM stores`,
        )
      ).rows[0]!;

      // The literal credential must not appear anywhere in the row.
      expect(row.access_token_encrypted).not.toContain("shpat_supersecret_value");
      expect(row.access_token_encrypted).not.toContain("supersecret");
      expect(row.access_token_encrypted.startsWith("v1.")).toBe(true);
      // And it must still be recoverable, or the connection is worthless.
      expect(decryptToken(row.access_token_encrypted)).toBe("shpat_supersecret_value");
    });

    it("reports scopes the merchant declined to grant", async () => {
      const result = await recordConnection({
        organizationId: f.orgId,
        userId: f.ownerId,
        shop: SHOP,
        accessToken: "shpat_partial",
        scope: "read_products",
      });
      expect(result.missingScopes).toContain("read_themes");
    });

    it("refreshes in place when a merchant reinstalls", async () => {
      const first = await recordConnection({
        organizationId: f.orgId, userId: f.ownerId, shop: SHOP,
        accessToken: "shpat_first", scope: "read_products",
      });
      const second = await recordConnection({
        organizationId: f.orgId, userId: f.ownerId, shop: SHOP,
        accessToken: "shpat_second", scope: "read_products,read_themes",
      });

      expect(second.storeId).toBe(first.storeId);

      const rows = await pool.query<{ access_token_encrypted: string }>(
        `SELECT access_token_encrypted FROM stores`,
      );
      expect(rows.rows).toHaveLength(1);
      expect(decryptToken(rows.rows[0]!.access_token_encrypted)).toBe("shpat_second");
    });

    it("refuses to attach a store another organisation already has connected", async () => {
      await recordConnection({
        organizationId: f.orgId, userId: f.ownerId, shop: SHOP,
        accessToken: "shpat_a", scope: "read_products",
      });

      const rival = (
        await pool.query<{ id: string }>(
          `INSERT INTO organizations (name, slug) VALUES ('Rival','rival') RETURNING id`,
        )
      ).rows[0]!.id;

      // Without the partial unique index, a rival who can reach the OAuth flow
      // for a shop they don't own would attach it to their own workspace.
      await expect(
        recordConnection({
          organizationId: rival, userId: f.ownerId, shop: SHOP,
          accessToken: "shpat_b", scope: "read_products",
        }),
      ).rejects.toThrow(StoreConnectionError);
    });

    it("explains a cross-workspace collision instead of failing opaquely", async () => {
      await recordConnection({
        organizationId: f.orgId, userId: f.ownerId, shop: SHOP,
        accessToken: "shpat_a", scope: "read_products",
      });
      const rival = (
        await pool.query<{ id: string }>(
          `INSERT INTO organizations (name, slug) VALUES ('Rival','rival') RETURNING id`,
        )
      ).rows[0]!.id;

      try {
        await recordConnection({
          organizationId: rival, userId: f.ownerId, shop: SHOP,
          accessToken: "shpat_b", scope: "read_products",
        });
        expect.unreachable();
      } catch (error) {
        const e = error as InstanceType<typeof StoreConnectionError>;
        // A merchant hitting this needs to know what to do next.
        expect(e.publicMessage).toContain("already connected");
        expect(e.publicMessage).toMatch(/disconnect it there/i);
      }
    });

    it("lets a store move to another organisation after it is released", async () => {
      const { storeId } = await recordConnection({
        organizationId: f.orgId, userId: f.ownerId, shop: SHOP,
        accessToken: "shpat_a", scope: "read_products",
      });
      await disconnectStore({ organizationId: f.orgId, storeId });

      const rival = (
        await pool.query<{ id: string }>(
          `INSERT INTO organizations (name, slug) VALUES ('Rival','rival') RETURNING id`,
        )
      ).rows[0]!.id;

      await expect(
        recordConnection({
          organizationId: rival, userId: f.ownerId, shop: SHOP,
          accessToken: "shpat_b", scope: "read_products",
        }),
      ).resolves.toBeTruthy();
    });
  });

  describe("disconnecting", () => {
    it("destroys the credential rather than flagging it", async () => {
      const { storeId } = await recordConnection({
        organizationId: f.orgId, userId: f.ownerId, shop: SHOP,
        accessToken: "shpat_gone", scope: "read_products",
      });

      expect(await disconnectStore({ organizationId: f.orgId, storeId })).toBe(true);

      const row = (
        await pool.query<{ access_token_encrypted: string | null; disconnected_at: Date | null }>(
          `SELECT access_token_encrypted, disconnected_at FROM stores WHERE id = $1`,
          [storeId],
        )
      ).rows[0]!;

      // "We deleted your access" has to be true at the row level.
      expect(row.access_token_encrypted).toBeNull();
      expect(row.disconnected_at).not.toBeNull();
    });

    it("will not let one organisation disconnect another's store", async () => {
      const { storeId } = await recordConnection({
        organizationId: f.orgId, userId: f.ownerId, shop: SHOP,
        accessToken: "shpat_x", scope: "read_products",
      });

      const rival = (
        await pool.query<{ id: string }>(
          `INSERT INTO organizations (name, slug) VALUES ('Rival','rival') RETURNING id`,
        )
      ).rows[0]!.id;

      expect(await disconnectStore({ organizationId: rival, storeId })).toBe(false);

      const still = (
        await pool.query<{ access_token_encrypted: string | null }>(
          `SELECT access_token_encrypted FROM stores WHERE id = $1`,
          [storeId],
        )
      ).rows[0]!;
      expect(still.access_token_encrypted).not.toBeNull();
    });

    it("is idempotent, because Shopify retries webhooks", async () => {
      await recordConnection({
        organizationId: f.orgId, userId: f.ownerId, shop: SHOP,
        accessToken: "shpat_u", scope: "read_products",
      });

      expect(await disconnectByDomain(SHOP)).toBe(1);
      expect(await disconnectByDomain(SHOP)).toBe(0);
    });

    it("ignores an uninstall naming a domain that is not a store", async () => {
      // The header is inside the HMAC, but it is still re-validated — a
      // signature proves who sent it, not that the contents make sense.
      expect(await disconnectByDomain("evil.com")).toBe(0);
      expect(await disconnectByDomain("")).toBe(0);
    });
  });

  describe("listing stores for the portal", () => {
    it("never selects the token column", async () => {
      await recordConnection({
        organizationId: f.orgId, userId: f.ownerId, shop: SHOP,
        accessToken: "shpat_never_render_me", scope: "read_products,read_themes",
      });

      const list = await storesFor(f.orgId);
      expect(list).toHaveLength(1);
      // A column that never enters a render path cannot leak into one.
      expect(JSON.stringify(list)).not.toContain("shpat");
      expect(JSON.stringify(list)).not.toContain("v1.");
    });

    it("hides disconnected stores and other tenants' stores", async () => {
      const { storeId } = await recordConnection({
        organizationId: f.orgId, userId: f.ownerId, shop: SHOP,
        accessToken: "shpat_a", scope: "read_products",
      });

      const rival = (
        await pool.query<{ id: string }>(
          `INSERT INTO organizations (name, slug) VALUES ('Rival','rival') RETURNING id`,
        )
      ).rows[0]!.id;
      expect(await storesFor(rival)).toHaveLength(0);

      await disconnectStore({ organizationId: f.orgId, storeId });
      expect(await storesFor(f.orgId)).toHaveLength(0);
    });

    it("surfaces scopes a merchant did not grant", async () => {
      await recordConnection({
        organizationId: f.orgId, userId: f.ownerId, shop: SHOP,
        accessToken: "shpat_a", scope: "read_products",
      });
      const [store] = await storesFor(f.orgId);
      expect(store!.missingScopes).toContain("read_themes");
    });
  });
});
