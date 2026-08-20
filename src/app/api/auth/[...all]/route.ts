import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

/**
 * Better Auth's endpoints. Node runtime, not edge — the handler talks to
 * Postgres, and the edge runtime has no database access (§6 of the brief).
 */
export const runtime = "nodejs";

export const { GET, POST } = toNextJsHandler(auth.handler);
