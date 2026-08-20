/**
 * The production secret check, extracted so it can be unit-tested without
 * booting Better Auth or a database connection.
 *
 * Better Auth falls back to a well-known default secret and logs a warning. A
 * warning in a build log is not a control — it scrolls past, and the result is
 * every session token in production signed with a value that is public
 * knowledge, meaning anyone can forge one.
 */
export function assertAuthSecret(
  appEnv: string | undefined,
  secret: string | undefined,
): void {
  if (appEnv !== "production") return;
  if (secret && secret.trim().length >= 32) return;

  throw new Error(
    secret
      ? "BETTER_AUTH_SECRET is too short. Use at least 32 characters — " +
        "`openssl rand -base64 32`."
      : "BETTER_AUTH_SECRET is not set in production. Session tokens would be " +
        "signed with Better Auth's public default secret, which makes them " +
        "forgeable. Generate one with `openssl rand -base64 32` and set it in " +
        "the Netlify site's environment variables.",
  );
}
