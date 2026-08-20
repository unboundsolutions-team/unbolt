import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db, schema } from "@/db/client";
import { assertAuthSecret } from "./auth-guard";

/**
 * Better Auth — authentication only.
 *
 * It owns credentials, sessions and verification. It does NOT own tenancy:
 * organizations, memberships, roles and the audit log stay in our schema and
 * our service layer (see src/server/rbac.ts and the M3 migration for why).
 *
 * The field mapping below exists because M0's schema was designed before this
 * decision and is deliberately richer in places. Rather than rewrite tables
 * that already model the business correctly, we tell Better Auth where things
 * live.
 */
const secret = process.env["BETTER_AUTH_SECRET"];
const baseURL = process.env["BETTER_AUTH_URL"] ?? process.env["NEXT_PUBLIC_SITE_URL"];

assertAuthSecret(process.env["NEXT_PUBLIC_APP_ENV"], secret);

export const auth = betterAuth({
  /**
   * The keys here are Better Auth's MODEL names, not table names.
   *
   * The drizzle adapter resolves a model by looking its name up in this object,
   * so the keys must be exactly what Better Auth asks for — `user`, not `users`.
   * The real SQL table name comes from the drizzle object itself
   * (`pgTable("users", …)`), which is why no modelName override is needed to
   * reach our plural tables.
   *
   * Getting this wrong fails only at runtime, on the first sign-up, with
   * "The model "users" was not found in the schema object" — nothing in the
   * type system or the build catches it. tests/e2e-flow.mjs does.
   */
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),

  ...(secret ? { secret } : {}),
  ...(baseURL ? { baseURL } : {}),

  emailAndPassword: {
    enabled: true,
    // 12 is the floor the register form advertises; keep them in step.
    minPasswordLength: 12,
    maxPasswordLength: 128,
    // Flipped on in M4 once Resend is wired — until then, requiring a
    // verification email nobody can send would lock every new account out.
    requireEmailVerification: false,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // slide the expiry at most once a day
    cookieCache: {
      // Lets middleware and layouts read the session without a DB round trip
      // on every navigation. Short, so a revocation still bites quickly.
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  user: {
    fields: {
      // Better Auth wants `image`; M0 called it avatar_url.
      image: "avatarUrl",
    },
  },

  advanced: {
    // Our PKs are uuid with a database default; let Postgres generate them
    // rather than having Better Auth insert its own string ids.
    database: { generateId: false },
    cookiePrefix: "unbolt",
    useSecureCookies: process.env["NEXT_PUBLIC_APP_ENV"] === "production",
  },
});

export type Auth = typeof auth;
