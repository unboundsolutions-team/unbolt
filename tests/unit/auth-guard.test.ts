import { describe, expect, it } from "vitest";

import { assertAuthSecret } from "@/lib/auth-guard";

describe("production auth secret", () => {
  it("refuses to start production with no secret", () => {
    expect(() => assertAuthSecret("production", undefined)).toThrow(/not set in production/);
  });

  it("refuses a secret too short to be safe", () => {
    expect(() => assertAuthSecret("production", "short")).toThrow(/too short/);
    expect(() => assertAuthSecret("production", "a".repeat(31))).toThrow(/too short/);
  });

  it("accepts a real secret", () => {
    expect(() => assertAuthSecret("production", "a".repeat(32))).not.toThrow();
    // What `openssl rand -base64 32` actually produces.
    expect(() =>
      assertAuthSecret("production", "xBCV4eCr7KazBH83gCE9oFb/5C9U8kzxmCC4XVjuHEI="),
    ).not.toThrow();
  });

  it("leaves preview and local development alone", () => {
    // Requiring a secret here would mean `npm run dev` needs setup before it
    // runs at all, which is a worse trade than the risk it removes.
    for (const env of [undefined, "preview", "staging", "development"]) {
      expect(() => assertAuthSecret(env, undefined)).not.toThrow();
    }
  });
});
