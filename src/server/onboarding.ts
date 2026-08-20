import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isUniqueViolation } from "./pg-error";

/**
 * The gap between "has an account" and "has somewhere to work".
 *
 * Better Auth creates a user. It does not create an organisation, and every
 * other server module here refuses to do anything without one — correctly, but
 * it left a new customer authenticated and homeless: getAuthContext returned
 * null, requireAuth redirected to /login, middleware saw a valid session cookie
 * and redirected back to /app. A registration loop with no exit.
 *
 * This module is the exit.
 */

export interface SessionUser {
  userId: string;
  email: string;
  name: string | null;
  isInternal: boolean;
  hasOrganization: boolean;
}

/**
 * Who is signed in, independent of whether they belong anywhere yet.
 *
 * Deliberately separate from getAuthContext. That function answers "what may
 * this person do in their organisation?" and returning a half-populated context
 * for someone with no organisation would push a null check into every caller.
 * This answers the narrower question onboarding actually needs.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isInternal: users.isInternal,
      memberships: sql<number>`(
        SELECT count(*)::int FROM memberships WHERE memberships.user_id = ${users.id}
      )`,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!row) return null;

  return {
    userId: row.id,
    email: row.email,
    name: row.name,
    isInternal: row.isInternal,
    hasOrganization: row.memberships > 0,
  };
});

export class OnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingError";
  }
}

/**
 * Create an organisation and make the caller its owner.
 *
 * One statement, for the same reason every write in this codebase is one
 * statement: the HTTP driver has no transactions, so an organisation created in
 * one round trip and a membership created in another can leave a customer
 * owning nothing and locked out of the workspace they just made — with no way
 * to recover it, because there is no owner to grant them access.
 */
export async function createOrganizationFor(input: {
  userId: string;
  name: string;
}): Promise<{ organizationId: string; slug: string }> {
  const base = slugify(input.name);

  // Slug collisions are resolved by trying a fresh suffix rather than by
  // reading existing slugs first — a read-then-write would race two people
  // naming their workspace the same thing in the same second.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${suffix(attempt)}`;

    try {
      const rows = await db.execute<{ id: string; slug: string }>(sql`
        WITH new_org AS (
          INSERT INTO organizations (name, slug)
          VALUES (${input.name}, ${slug})
          RETURNING id, slug
        ),
        owner AS (
          -- Owner, not admin: the person who creates the workspace must be able
          -- to manage billing and, eventually, delete it. Anything less and the
          -- account has no one who can fully act on it.
          INSERT INTO memberships (organization_id, user_id, role)
          SELECT id, ${input.userId}::uuid, 'owner' FROM new_org
        )
        SELECT id, slug FROM new_org
      `);

      const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
      const created = (Array.isArray(result) ? result[0] : undefined) as
        | { id: string; slug: string }
        | undefined;

      if (!created) throw new OnboardingError("Could not create that workspace.");
      return { organizationId: created.id, slug: created.slug };
    } catch (error) {
      if (isSlugConflict(error) && attempt < 5) continue;
      throw error;
    }
  }

  throw new OnboardingError(
    "That workspace name is taken. Try adding your city or a word that's yours.",
  );
}

function isSlugConflict(error: unknown): boolean {
  return isUniqueViolation(error, "organizations_slug_key");
}

/**
 * "Acme Store & Co." → "acme-store-co"
 *
 * Falls back to a generic stem rather than an empty string: a name written
 * entirely in a non-Latin script would otherwise produce a slug of "" and hit
 * the NOT NULL constraint instead of just getting a suffix.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

  return slug.length >= 2 ? slug : "workspace";
}

/** Short, non-sequential, and never leaks how many organisations exist. */
function suffix(attempt: number): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 3 + attempt; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
