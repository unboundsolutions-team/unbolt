"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth. Only ever used by the sign-in and sign-up forms and the
 * sign-out control — everything else reads the session on the server, where it
 * cannot be spoofed.
 */
export const authClient = createAuthClient({
  baseURL: process.env["NEXT_PUBLIC_SITE_URL"] ?? undefined,
});

export const { signIn, signUp, signOut, useSession } = authClient;
