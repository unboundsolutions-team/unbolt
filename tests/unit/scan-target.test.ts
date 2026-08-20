import { describe, expect, it } from "vitest";

import { assertPublicAddress, parseScanTarget, UnsafeTargetError } from "@/server/scan/target";

/**
 * The scan form is public and unauthenticated, and whatever it accepts becomes
 * an HTTP request made from inside our infrastructure. Every case below is a
 * real SSRF payload, not a hypothetical.
 */
describe("scan target validation", () => {
  describe("what it should accept", () => {
    it("takes a bare hostname and assumes https", () => {
      expect(parseScanTarget("northline.co").toString()).toBe("https://northline.co/");
    });

    it("takes what a merchant actually pastes", () => {
      expect(parseScanTarget("https://www.northline.co/collections/all").toString()).toBe(
        "https://www.northline.co/collections/all",
      );
      expect(parseScanTarget("  HTTP://Northline.co  ").toString()).toBe("http://northline.co/");
      expect(parseScanTarget("acme.myshopify.com").hostname).toBe("acme.myshopify.com");
    });

    it("strips query and fragment", () => {
      // A tracking parameter is not part of the identity of the page, and
      // keeping it would fragment the abuse-rate check per visitor.
      const url = parseScanTarget("https://northline.co/?utm_source=x#top");
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
    });

    it("allows explicit standard ports", () => {
      expect(() => parseScanTarget("https://northline.co:443")).not.toThrow();
      expect(() => parseScanTarget("http://northline.co:80")).not.toThrow();
    });
  });

  describe("cloud metadata — the one that leaks credentials", () => {
    it("blocks the link-local metadata address in every form", () => {
      for (const target of [
        "http://169.254.169.254/latest/meta-data/",
        "http://169.254.169.254",
        "https://[fe80::1]/",
        "http://metadata.google.internal/computeMetadata/v1/",
      ]) {
        expect(() => parseScanTarget(target)).toThrow(UnsafeTargetError);
      }
    });
  });

  describe("loopback, in all the forms that mean the same thing", () => {
    it("blocks the obvious ones", () => {
      for (const target of ["http://localhost", "http://127.0.0.1", "http://[::1]", "https://localhost/admin"]) {
        expect(() => parseScanTarget(target)).toThrow(UnsafeTargetError);
      }
    });

    it("blocks the integer and octal spellings", () => {
      // All of these resolve to 127.0.0.1 and none of them look like an IP.
      for (const target of ["http://2130706433", "http://0177.0.0.1", "http://0x7f000001", "http://127.1"]) {
        expect(() => parseScanTarget(target)).toThrow(UnsafeTargetError);
      }
    });

    it("blocks IPv4-mapped IPv6 loopback", () => {
      expect(() => parseScanTarget("http://[::ffff:127.0.0.1]")).toThrow(UnsafeTargetError);
    });
  });

  describe("private networks", () => {
    it("blocks every RFC1918 range", () => {
      for (const ip of ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.1.1"]) {
        expect(() => parseScanTarget(`http://${ip}`)).toThrow(UnsafeTargetError);
      }
    });

    it("does NOT block public addresses that merely look adjacent", () => {
      // 172.15 and 172.32 are outside the private range; over-blocking would
      // silently refuse real customers.
      for (const ip of ["172.15.0.1", "172.32.0.1", "11.0.0.1", "193.168.1.1"]) {
        expect(() => parseScanTarget(`http://${ip}`)).not.toThrow();
      }
    });

    it("blocks carrier-grade NAT, benchmarking and multicast", () => {
      for (const ip of ["100.64.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "0.0.0.0"]) {
        expect(() => parseScanTarget(`http://${ip}`)).toThrow(UnsafeTargetError);
      }
    });

    it("blocks IPv6 unique-local and link-local", () => {
      for (const ip of ["[fd00::1]", "[fc00::1]", "[fe80::1]", "[::]"]) {
        expect(() => parseScanTarget(`http://${ip}`)).toThrow(UnsafeTargetError);
      }
    });
  });

  describe("schemes and shapes that are never a storefront", () => {
    it("blocks non-HTTP schemes", () => {
      for (const target of [
        "file:///etc/passwd",
        "gopher://evil.com:70/x",
        "ftp://evil.com",
        "data:text/html,hi",
        "javascript:alert(1)",
      ]) {
        expect(() => parseScanTarget(target)).toThrow(UnsafeTargetError);
      }
    });

    it("blocks non-standard ports", () => {
      // 6379 is Redis, 5432 Postgres, 8080 an internal admin panel.
      for (const target of ["http://example.com:6379", "http://example.com:5432", "http://example.com:8080"]) {
        expect(() => parseScanTarget(target)).toThrow(UnsafeTargetError);
      }
    });

    it("blocks embedded credentials", () => {
      expect(() => parseScanTarget("http://user:pass@example.com")).toThrow(UnsafeTargetError);
    });

    it("blocks internal-only name suffixes", () => {
      for (const target of ["http://db.internal", "http://printer.local", "http://wiki.corp"]) {
        expect(() => parseScanTarget(target)).toThrow(UnsafeTargetError);
      }
    });

    it("blocks single-label hostnames", () => {
      expect(() => parseScanTarget("http://intranet")).toThrow(UnsafeTargetError);
    });

    it("rejects empty and absurd input", () => {
      expect(() => parseScanTarget("")).toThrow(UnsafeTargetError);
      expect(() => parseScanTarget(null)).toThrow(UnsafeTargetError);
      expect(() => parseScanTarget(`https://${"a".repeat(3000)}.com`)).toThrow(UnsafeTargetError);
    });
  });

  describe("post-DNS re-check", () => {
    it("is exported so it can run again on the resolved address", () => {
      // Hostname validation alone leaves DNS rebinding open: a name that
      // resolves public at validation time and to 127.0.0.1 at fetch time.
      expect(() => assertPublicAddress("127.0.0.1")).toThrow(UnsafeTargetError);
      expect(() => assertPublicAddress("169.254.169.254")).toThrow(UnsafeTargetError);
      expect(() => assertPublicAddress("10.1.2.3")).toThrow(UnsafeTargetError);
      expect(() => assertPublicAddress("93.184.216.34")).not.toThrow();
    });
  });

  it("carries a message safe to show a visitor", () => {
    try {
      parseScanTarget("http://169.254.169.254/latest/meta-data/");
      expect.unreachable();
    } catch (error) {
      const e = error as UnsafeTargetError;
      // No hint about what our infrastructure looks like.
      expect(e.publicMessage).not.toContain("169.254");
      expect(e.publicMessage).not.toMatch(/metadata|internal|loopback/i);
    }
  });
});
