import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How Unbolt is built: how merchant tokens are stored, how access is scoped, and how to report a vulnerability.",
  alternates: { canonical: "/security" },
};

/**
 * Specifics, not adjectives.
 *
 * Every claim here is something implemented and testable, because a security
 * page full of "bank-grade" and "enterprise-ready" tells a technical buyer
 * exactly one thing: that nobody technical wrote it. A merchant handing over a
 * Shopify access token is entitled to know what happens to it.
 */
export default function SecurityPage() {
  return (
    <LegalPage
      eyebrow="Trust"
      title="How this is built"
      lede="You are giving us access to a store that takes money. Here is what we do with it, in specifics."
      lastReviewed={null}
    >
      <h2>Merchant access tokens</h2>
      <p>
        A Shopify access token is encrypted with <strong>AES-256-GCM</strong> before it is written,
        using a key held in the environment and never in the database. Someone holding a copy of the
        database has ciphertext and nothing to decrypt it with.
      </p>
      <p>
        Disconnecting a store <strong>destroys the token</strong>. There is no soft delete and no
        archived copy — the row is rewritten without it, so &ldquo;disconnected&rdquo; means the
        credential is gone rather than merely hidden.
      </p>
      <p>
        A store can only be connected to one workspace at a time. If another account already has it,
        the connection is refused with an explanation rather than silently moving it.
      </p>

      <h2>Access control</h2>
      <p>
        Every request that touches your data re-derives who you are and what you may do from the
        database, on the server. Nothing trusts a cookie&rsquo;s presence as proof of identity — a
        forged one gets past the redirect at the edge and then fails the real check.
      </p>
      <p>
        Our own staff have no membership in your workspace. Internal tools resolve a context that
        deliberately has no organisation attached, so an admin page cannot accidentally scope itself
        to &ldquo;the current customer&rdquo; and show one of yours to another.
      </p>
      <p>
        Comments have two audiences and the boundary is enforced at the write, not the read: the
        action a customer&rsquo;s browser can reach cannot produce an internal note, because it does
        not take that flag from the form.
      </p>

      <h2>The browser</h2>
      <ul>
        <li>
          A <strong>Content-Security-Policy</strong> that permits scripts from this origin only, with
          no <code>unsafe-eval</code>, plus <code>frame-ancestors: none</code>,{" "}
          <code>object-src: none</code>, <code>base-uri: self</code> and{" "}
          <code>form-action: self</code>.
        </li>
        <li>HSTS with a two-year max-age, preloaded.</li>
        <li>Authenticated pages are marked no-store, so no intermediary caches them.</li>
        <li>Self-hosted fonts and no third-party scripts — nothing external executes on this site.</li>
      </ul>

      <h2>The free store scan</h2>
      <p>
        The scanner fetches a URL a stranger chose, which is a request-forgery vector if built
        carelessly. It resolves the host first and refuses private, loopback and link-local
        addresses, follows a bounded number of redirects and re-checks each hop, and runs with a
        timeout. It reports what it found and never invents a score when a provider is unavailable.
      </p>

      <h2>Rate limiting</h2>
      <p>
        The public write paths — the scan and the contact form — are rate limited per caller, counted
        atomically so a burst cannot slip past a check-then-act race. The caller is identified from a
        header our platform sets itself rather than one the client can choose.
      </p>

      <h2>Data integrity</h2>
      <p>
        Money and capacity are enforced by the database, not by application checks: your remaining
        task credits are a counter decremented under a condition, and the number of tasks running at
        once is a unique index. Both hold under concurrent requests, which is exactly when a
        counting-based check fails.
      </p>
      <p>
        The audit trail and the credit ledger are append-only at the schema level. Nothing in the
        application can rewrite history, including us.
      </p>

      <h2>Reporting a vulnerability</h2>
      <p>
        Tell us at <a href="/contact">our contact form</a> with &ldquo;security&rdquo; in the
        message, and we will acknowledge within two working days. We will not pursue anyone who
        reports a genuine issue in good faith, gives us reasonable time to fix it, and does not
        access other people&rsquo;s data in the process.
      </p>
      <p>
        We do not currently run a paid bounty. We will credit you if you would like us to.
      </p>
    </LegalPage>
  );
}
