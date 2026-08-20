import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { oauthStates, stores } from "@/db/schema";

import { encryptToken } from "./crypto";
import { parseShopDomain, type ShopDomain } from "./domain";
import { missingScopes } from "./oauth";
import { isUniqueViolation } from "../pg-error";

/**
 * Persistence for store connections.
 *
 * Same discipline as the task engine: every mutation is a single statement,
 * because the HTTP driver has no transactions and a half-applied connection
 * leaves a store row with no token — which the `stores_token_ck` constraint
 * would reject anyway, loudly, at the worst possible moment.
 */

export class StoreConnectionError extends Error {
  constructor(
    message: string,
    readonly publicMessage = "That store could not be connected.",
  ) {
    super(message);
    this.name = "StoreConnectionError";
  }
}

/** How long a merchant has to complete the consent screen. */
export const STATE_TTL_MS = 15 * 60 * 1000;

export async function createOAuthState(input: {
  state: string;
  shop: ShopDomain;
  organizationId: string;
  userId: string;
  returnTo?: string | undefined;
}): Promise<void> {
  await db.insert(oauthStates).values({
    state: input.state,
    shop: input.shop,
    organizationId: input.organizationId,
    userId: input.userId,
    returnTo: input.returnTo ?? null,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
}

export interface ConsumedState extends Record<string, unknown> {
  shop: string;
  organizationId: string;
  userId: string;
  returnTo: string | null;
}

/**
 * Consume a nonce, or refuse.
 *
 * The claim and the consumption are ONE statement with `consumed_at IS NULL` in
 * the WHERE clause. That is what makes it genuinely single-use: two callbacks
 * racing the same nonce both match the row, but only one UPDATE returns it.
 * A read-then-write would let a replayed callback through under load.
 */
export async function consumeOAuthState(state: string): Promise<ConsumedState | null> {
  const rows = await db.execute<ConsumedState>(sql`
    UPDATE oauth_states SET consumed_at = now()
    WHERE state = ${state}
      AND consumed_at IS NULL
      AND expires_at > now()
    RETURNING shop, organization_id AS "organizationId",
              user_id AS "userId", return_to AS "returnTo"
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  const row = Array.isArray(result) ? result[0] : undefined;
  return (row as ConsumedState | undefined) ?? null;
}

/** Housekeeping. Expired nonces are useless and there is no reason to keep them. */
export async function purgeExpiredStates(): Promise<void> {
  await db.execute(sql`
    DELETE FROM oauth_states
    WHERE expires_at < now() - interval '1 day'
  `);
}

export interface ShopProfile {
  name?: string | undefined;
  email?: string | undefined;
  planName?: string | undefined;
  currency?: string | undefined;
}

/**
 * Record a completed connection.
 *
 * Upsert on `(organization_id, lower(domain))` so reconnecting an existing
 * store refreshes its token in place instead of accumulating a row per install
 * — a merchant who reinstalls twice should not see three copies of their store.
 *
 * The token is encrypted here rather than by the caller, so there is no call
 * site from which a plaintext token could reach the database by omission.
 */
export async function recordConnection(input: {
  organizationId: string;
  userId: string;
  shop: ShopDomain;
  accessToken: string;
  scope: string;
  profile?: ShopProfile;
}): Promise<{ storeId: string; missingScopes: string[] }> {
  const encrypted = encryptToken(input.accessToken);
  const profile = input.profile ?? {};

  try {
    return await insertConnection(input, encrypted, profile);
  } catch (error) {
    // The partial unique index fired: this shop is actively connected to a
    // different workspace. It is a real and unremarkable situation — an agency
    // connects a client's store, then the client tries to connect it too — and
    // it deserves a sentence that explains it rather than "something failed".
    if (isActiveDomainConflict(error)) {
      throw new StoreConnectionError(
        `${input.shop} is already connected to another organisation.`,
        `${input.shop} is already connected to a different Unbolt workspace. ` +
          `Disconnect it there first, or ask us to move it.`,
      );
    }
    throw error;
  }
}

function isActiveDomainConflict(error: unknown): boolean {
  return isUniqueViolation(error, "stores_active_domain_key");
}

async function insertConnection(
  input: {
    organizationId: string;
    userId: string;
    shop: ShopDomain;
    accessToken: string;
    scope: string;
  },
  encrypted: string,
  profile: ShopProfile,
): Promise<{ storeId: string; missingScopes: string[] }> {
  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO stores (
      organization_id, domain, platform, access_token_encrypted, granted_scopes,
      shop_name, shop_email, plan_name, currency,
      connected_at, disconnected_at, last_verified_at, connected_by
    )
    VALUES (
      ${input.organizationId}, ${input.shop}, 'shopify',
      ${encrypted}, ${input.scope},
      ${profile.name ?? null}, ${profile.email ?? null},
      ${profile.planName ?? null}, ${profile.currency ?? null},
      now(), NULL, now(), ${input.userId}::uuid
    )
    ON CONFLICT (organization_id, lower(domain)) DO UPDATE SET
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      granted_scopes         = EXCLUDED.granted_scopes,
      shop_name              = COALESCE(EXCLUDED.shop_name, stores.shop_name),
      shop_email             = COALESCE(EXCLUDED.shop_email, stores.shop_email),
      plan_name              = COALESCE(EXCLUDED.plan_name, stores.plan_name),
      currency               = COALESCE(EXCLUDED.currency, stores.currency),
      connected_at           = COALESCE(stores.connected_at, now()),
      -- Reconnecting clears a previous disconnect; otherwise the partial unique
      -- index would still consider this store inactive.
      disconnected_at        = NULL,
      last_verified_at       = now(),
      connected_by           = EXCLUDED.connected_by
    RETURNING id
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  const created = (Array.isArray(result) ? result[0] : undefined) as { id: string } | undefined;
  if (!created) throw new StoreConnectionError("Store connection produced no row.");

  return { storeId: created.id, missingScopes: missingScopes(input.scope) };
}

/**
 * Disconnect, and actually destroy the credential.
 *
 * The row stays as history — tasks reference it — but the token is set to NULL,
 * not merely flagged. "We deleted your access" has to be true at the row level,
 * because a merchant revoking access is a security action, not a preference.
 */
export async function disconnectStore(input: {
  organizationId: string;
  storeId: string;
}): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE stores SET
      access_token_encrypted = NULL,
      disconnected_at = now(),
      connected_at = NULL
    WHERE id = ${input.storeId}
      AND organization_id = ${input.organizationId}
      AND disconnected_at IS NULL
    RETURNING id
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  return Array.isArray(result) && result.length > 0;
}

/**
 * Uninstall arriving from Shopify's webhook.
 *
 * Scoped by domain alone — an uninstall is not initiated by a signed-in user,
 * so there is no organisation in context. Idempotent, because Shopify retries
 * webhooks and may deliver the same one more than once.
 */
export async function disconnectByDomain(shop: string): Promise<number> {
  const parsed = parseShopDomain(shop);
  if (!parsed) return 0;

  const rows = await db.execute<{ id: string }>(sql`
    UPDATE stores SET
      access_token_encrypted = NULL,
      disconnected_at = now(),
      connected_at = NULL
    WHERE lower(domain) = ${parsed}
      AND disconnected_at IS NULL
    RETURNING id
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  return Array.isArray(result) ? result.length : 0;
}

export interface StoreSummary {
  id: string;
  domain: string;
  shopName: string | null;
  planName: string | null;
  currency: string | null;
  connectedAt: Date | null;
  grantedScopes: string | null;
  missingScopes: string[];
}

/**
 * Stores for the portal.
 *
 * Note what is NOT selected: the encrypted token. A page has no use for it, and
 * a column that never enters a render path cannot leak into one.
 */
export async function storesFor(organizationId: string): Promise<StoreSummary[]> {
  const rows = await db
    .select({
      id: stores.id,
      domain: stores.domain,
      shopName: stores.shopName,
      planName: stores.planName,
      currency: stores.currency,
      connectedAt: stores.connectedAt,
      grantedScopes: stores.grantedScopes,
    })
    .from(stores)
    .where(and(eq(stores.organizationId, organizationId), isNull(stores.disconnectedAt)))
    .orderBy(desc(stores.connectedAt));

  return rows.map((row) => ({
    ...row,
    missingScopes: row.grantedScopes ? missingScopes(row.grantedScopes) : [],
  }));
}
