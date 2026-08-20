import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { decryptToken, encryptToken, TokenCryptoError, tokenFingerprint } from "@/server/shopify/crypto";
import { isShopDomain, parseShopDomain, shopHandle, shopOrigin } from "@/server/shopify/domain";
import { safeEqual, signQuery, signWebhook, verifyQueryHmac, verifyWebhookHmac } from "@/server/shopify/hmac";
import {
  authorizeUrl,
  callbackUrl,
  exchangeCode,
  generateState,
  missingScopes,
  parseCallback,
  ShopifyOAuthError,
  SCOPE_STRING,
} from "@/server/shopify/oauth";

const SECRET = "shpss_test_secret_value_at_least_32_chars";
const CONFIG = {
  apiKey: "test-api-key",
  apiSecret: SECRET,
  appUrl: "https://unbolt.example.com",
};

describe("shop domain validation", () => {
  it("accepts a real store domain", () => {
    expect(parseShopDomain("acme-store.myshopify.com")).toBe("acme-store.myshopify.com");
  });

  it("normalises what a merchant is likely to paste", () => {
    for (const input of [
      "  Acme-Store.myshopify.com  ",
      "https://acme-store.myshopify.com",
      "https://acme-store.myshopify.com/admin/products",
      "acme-store.myshopify.com/admin",
      "ACME-STORE.MYSHOPIFY.COM",
      "acme-store.myshopify.com.", // legal FQDN trailing dot
    ]) {
      expect(parseShopDomain(input)).toBe("acme-store.myshopify.com");
    }
  });

  describe("the attacks this exists to stop", () => {
    // Each of these has been shipped in a real published Shopify app. The app
    // then redirects the merchant to the attacker's host, or posts an access
    // token to it.
    it("rejects a suffix that is not the real domain", () => {
      expect(parseShopDomain("acme.myshopify.com.evil.com")).toBeNull();
      expect(parseShopDomain("myshopify.com.evil.com")).toBeNull();
    });

    it("rejects the domain appearing in a path", () => {
      expect(parseShopDomain("https://evil.com/acme.myshopify.com")).toBeNull();
      expect(parseShopDomain("evil.com/acme.myshopify.com")).toBeNull();
    });

    it("rejects userinfo smuggling", () => {
      // Reads as the store to a human; the browser connects to evil.com.
      expect(parseShopDomain("https://acme.myshopify.com@evil.com")).toBeNull();
      expect(parseShopDomain("https://acme.myshopify.com:x@evil.com")).toBeNull();
    });

    it("rejects extra labels in front of the store name", () => {
      // Not a store, and possibly someone else's subdomain.
      expect(parseShopDomain("a.b.myshopify.com")).toBeNull();
      expect(parseShopDomain("evil.acme.myshopify.com")).toBeNull();
    });

    it("rejects a bare unrelated host", () => {
      expect(parseShopDomain("evil.com")).toBeNull();
      expect(parseShopDomain("myshopify.com")).toBeNull();
    });

    it("rejects non-http schemes", () => {
      expect(parseShopDomain("javascript:alert(1)//acme.myshopify.com")).toBeNull();
      expect(parseShopDomain("data:text/html,acme.myshopify.com")).toBeNull();
    });

    it("rejects a port", () => {
      expect(parseShopDomain("acme.myshopify.com:8080")).toBeNull();
    });

    it("rejects empty, absurd and non-string input", () => {
      expect(parseShopDomain("")).toBeNull();
      expect(parseShopDomain(null)).toBeNull();
      expect(parseShopDomain(undefined)).toBeNull();
      expect(parseShopDomain(`${"a".repeat(300)}.myshopify.com`)).toBeNull();
      expect(parseShopDomain("-acme.myshopify.com")).toBeNull();
      expect(parseShopDomain("acme-.myshopify.com")).toBeNull();
    });
  });

  it("builds an origin only from a parsed domain", () => {
    const shop = parseShopDomain("acme.myshopify.com")!;
    expect(shopOrigin(shop)).toBe("https://acme.myshopify.com");
    expect(shopHandle(shop)).toBe("acme");
    expect(isShopDomain("acme.myshopify.com")).toBe(true);
    expect(isShopDomain("evil.com")).toBe(false);
  });
});

describe("HMAC verification", () => {
  it("accepts a correctly signed query", () => {
    const params = new URLSearchParams({
      code: "abc123",
      shop: "acme.myshopify.com",
      state: "nonce",
      timestamp: "1700000000",
    });
    params.set("hmac", signQuery(params, SECRET));
    expect(verifyQueryHmac(params, SECRET)).toBe(true);
  });

  it("rejects a tampered parameter", () => {
    const params = new URLSearchParams({ code: "abc123", shop: "acme.myshopify.com" });
    params.set("hmac", signQuery(params, SECRET));
    params.set("shop", "evil.myshopify.com");
    expect(verifyQueryHmac(params, SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const params = new URLSearchParams({ code: "abc123" });
    params.set("hmac", signQuery(params, "some-other-secret"));
    expect(verifyQueryHmac(params, SECRET)).toBe(false);
  });

  it("rejects a missing signature outright", () => {
    expect(verifyQueryHmac(new URLSearchParams({ code: "x" }), SECRET)).toBe(false);
  });

  it("ignores hmac and signature when building the message", () => {
    // Shopify excludes both; including either makes every verification fail.
    const params = new URLSearchParams({ code: "abc", signature: "legacy" });
    params.set("hmac", signQuery(params, SECRET));
    expect(verifyQueryHmac(params, SECRET)).toBe(true);
  });

  it("handles a repeated key the way Shopify does", () => {
    // Object.fromEntries() would keep only the last value and silently fail.
    const params = new URLSearchParams();
    params.append("ids[]", "1");
    params.append("ids[]", "2");
    params.set("shop", "acme.myshopify.com");
    const message = "ids[]=1,2&shop=acme.myshopify.com";
    params.set("hmac", createHmac("sha256", SECRET).update(message).digest("hex"));
    expect(verifyQueryHmac(params, SECRET)).toBe(true);
  });

  it("verifies a webhook against the exact raw bytes", () => {
    const body = '{"id":123,"domain":"acme.myshopify.com"}';
    expect(verifyWebhookHmac(body, signWebhook(body, SECRET), SECRET)).toBe(true);
  });

  it("rejects a webhook body that was re-serialised", () => {
    // The trap: parsing and re-stringifying changes bytes, the signature stops
    // matching, and the tempting fix is to stop verifying.
    const body = '{"id":123,  "domain":"acme.myshopify.com"}';
    const signature = signWebhook(body, SECRET);
    const reserialised = JSON.stringify(JSON.parse(body));
    expect(verifyWebhookHmac(reserialised, signature, SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, signature, SECRET)).toBe(true);
  });

  it("rejects a webhook with no signature header", () => {
    expect(verifyWebhookHmac("{}", null, SECRET)).toBe(false);
  });

  it("compares unequal lengths without throwing", () => {
    // timingSafeEqual throws on length mismatch; safeEqual must not.
    expect(safeEqual("short", "much longer value")).toBe(false);
    expect(safeEqual("same", "same")).toBe(true);
  });
});

describe("token encryption", () => {
  beforeEach(() => {
    process.env["SHOPIFY_TOKEN_KEY"] = "a-test-key-that-is-long-enough-to-pass";
  });

  it("round-trips a token", () => {
    const token = "shpat_abcdef1234567890";
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it("never produces the same ciphertext twice", () => {
    // A deterministic ciphertext would let anyone with read access tell which
    // two stores share a token, and confirm a guess by comparison.
    const a = encryptToken("shpat_same");
    const b = encryptToken("shpat_same");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(decryptToken(b));
  });

  it("does not leave the token recoverable from the stored value", () => {
    const stored = encryptToken("shpat_secret_value");
    expect(stored).not.toContain("shpat");
    expect(stored).not.toContain("secret");
  });

  it("refuses a tampered ciphertext rather than returning garbage", () => {
    // This is why GCM and not CBC: a flipped byte must fail, not decrypt to
    // something that then gets sent to Shopify as a bearer token.
    const stored = encryptToken("shpat_abcdef");
    const parts = stored.split(".");
    const body = Buffer.from(parts[3]!, "base64url");
    body[0] = (body[0] ?? 0) ^ 0xff;
    parts[3] = body.toString("base64url");
    expect(() => decryptToken(parts.join("."))).toThrow(TokenCryptoError);
  });

  it("refuses a value encrypted under a different key", () => {
    const stored = encryptToken("shpat_abcdef");
    process.env["SHOPIFY_TOKEN_KEY"] = "a-completely-different-key-32-chars-x";
    expect(() => decryptToken(stored)).toThrow(TokenCryptoError);
  });

  it("refuses to run without a real key", () => {
    process.env["SHOPIFY_TOKEN_KEY"] = "too-short";
    process.env["BETTER_AUTH_SECRET"] = "also-short";
    expect(() => encryptToken("shpat_x")).toThrow(/32 characters/);
    delete process.env["BETTER_AUTH_SECRET"];
  });

  it("shows only the last four characters", () => {
    expect(tokenFingerprint("shpat_abcdef7890")).toBe("••••7890");
    expect(tokenFingerprint("abc")).toBe("••••");
  });
});

describe("the OAuth flow", () => {
  it("builds an authorize URL on the store's own domain", () => {
    const shop = parseShopDomain("acme.myshopify.com")!;
    const url = new URL(authorizeUrl({ config: CONFIG, shop, state: "nonce" }));

    expect(url.origin).toBe("https://acme.myshopify.com");
    expect(url.pathname).toBe("/admin/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-api-key");
    expect(url.searchParams.get("state")).toBe("nonce");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://unbolt.example.com/api/shopify/callback",
    );
  });

  it("asks only for read scopes", () => {
    // Every scope has to be justified at review and widens the blast radius of
    // a leaked token. A write scope appearing here should be a deliberate act.
    expect(SCOPE_STRING.split(",").every((s) => s.startsWith("read_"))).toBe(true);
  });

  it("generates unguessable, unique state values", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateState()));
    expect(seen.size).toBe(200);
    expect(generateState().length).toBeGreaterThanOrEqual(43);
  });

  it("puts the callback on the configured app origin", () => {
    expect(callbackUrl(CONFIG)).toBe("https://unbolt.example.com/api/shopify/callback");
  });

  describe("parsing a callback", () => {
    function signed(overrides: Record<string, string> = {}): URLSearchParams {
      const params = new URLSearchParams({
        code: "auth-code",
        shop: "acme.myshopify.com",
        state: "the-nonce",
        timestamp: "1700000000",
        ...overrides,
      });
      params.set("hmac", signQuery(params, SECRET));
      return params;
    }

    it("accepts a well-formed signed callback", () => {
      const result = parseCallback(signed(), CONFIG);
      expect(result.shop).toBe("acme.myshopify.com");
      expect(result.code).toBe("auth-code");
      expect(result.state).toBe("the-nonce");
    });

    it("rejects a hostile shop before checking anything else", () => {
      const params = signed({ shop: "evil.com" });
      expect(() => parseCallback(params, CONFIG)).toThrow(ShopifyOAuthError);
    });

    it("rejects an unsigned callback", () => {
      const params = signed();
      params.delete("hmac");
      expect(() => parseCallback(params, CONFIG)).toThrow(/HMAC/);
    });

    it("rejects a callback signed with the wrong secret", () => {
      const params = new URLSearchParams({ code: "c", shop: "acme.myshopify.com", state: "s" });
      params.set("hmac", signQuery(params, "attacker-secret"));
      expect(() => parseCallback(params, CONFIG)).toThrow(/HMAC/);
    });

    it("rejects a signed callback with no state", () => {
      const params = new URLSearchParams({ code: "c", shop: "acme.myshopify.com" });
      params.set("hmac", signQuery(params, SECRET));
      expect(() => parseCallback(params, CONFIG)).toThrow(/state/);
    });

    it("carries a message safe to show a merchant", () => {
      try {
        parseCallback(signed({ shop: "evil.com" }), CONFIG);
        expect.unreachable();
      } catch (error) {
        const e = error as ShopifyOAuthError;
        expect(e.publicMessage).not.toContain("HMAC");
        expect(e.publicMessage.length).toBeGreaterThan(10);
      }
    });
  });

  describe("exchanging the code", () => {
    const shop = parseShopDomain("acme.myshopify.com")!;

    it("posts to the store's token endpoint and returns the token", async () => {
      let seenUrl = "";
      let seenBody: Record<string, unknown> = {};

      const result = await exchangeCode({
        config: CONFIG,
        shop,
        code: "the-code",
        fetchImpl: (async (url: string, init: RequestInit) => {
          seenUrl = url;
          seenBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return new Response(
            JSON.stringify({ access_token: "shpat_granted", scope: SCOPE_STRING }),
            { status: 200 },
          );
        }) as unknown as typeof fetch,
      });

      expect(seenUrl).toBe("https://acme.myshopify.com/admin/oauth/access_token");
      expect(seenBody["client_secret"]).toBe(SECRET);
      expect(seenBody["code"]).toBe("the-code");
      expect(result.accessToken).toBe("shpat_granted");
    });

    it("throws without echoing the response body", async () => {
      await expect(
        exchangeCode({
          config: CONFIG,
          shop,
          code: "bad",
          fetchImpl: (async () =>
            new Response(`{"error":"invalid_request","secret_echo":"${SECRET}"}`, {
              status: 400,
            })) as unknown as typeof fetch,
        }),
      ).rejects.toThrow(/returned 400/);

      // And specifically not the secret.
      await exchangeCode({
        config: CONFIG,
        shop,
        code: "bad",
        fetchImpl: (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch,
      }).catch((error: Error) => {
        expect(error.message).not.toContain(SECRET);
      });
    });

    it("rejects a 200 that carries no token", async () => {
      await expect(
        exchangeCode({
          config: CONFIG,
          shop,
          code: "x",
          fetchImpl: (async () =>
            new Response(JSON.stringify({ scope: "read_products" }), {
              status: 200,
            })) as unknown as typeof fetch,
        }),
      ).rejects.toThrow(/no access_token/);
    });
  });

  it("notices when a merchant granted less than we asked for", () => {
    expect(missingScopes(SCOPE_STRING)).toEqual([]);
    expect(missingScopes("read_products")).toContain("read_themes");
    expect(missingScopes("")).toHaveLength(SCOPE_STRING.split(",").length);
  });
});
