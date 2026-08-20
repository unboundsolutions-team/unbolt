import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";
import { SITE } from "@/content/site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What Unbolt stores, why, who processes it, and how to get it back or have it deleted.",
  alternates: { canonical: "/legal/privacy" },
};

/**
 * An inventory, not a disclaimer.
 *
 * Each item below is a table or an integration that exists: users, leads,
 * tasks, task_comments, stores (with an encrypted access token), scans,
 * audit_logs. If a future migration adds a category of personal data, this page
 * is where it has to appear — a privacy policy that lists less than the schema
 * is a false statement, not an omission.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy policy"
      lede="What we store, why we store it, who else touches it, and how to get it back."
      lastReviewed={null}
    >
      <p>
        {SITE.name} is operated by {SITE.parent}, {SITE.locality}, who is the data controller for
        everything described here.
      </p>

      <h2>What we hold</h2>

      <h3>If you fill in the contact form</h3>
      <p>
        Your name, email, company, store URL if you give one, the plan you were looking at, and your
        message. We keep it so a person can reply and so we know what you asked for when we call.
        We keep enquiries that go nowhere for twelve months and then delete them.
      </p>

      <h3>If you have an account</h3>
      <ul>
        <li>Your name, email address and a hashed password.</li>
        <li>Which workspace you belong to and your role in it.</li>
        <li>
          <strong>The tasks you write.</strong> Task titles, descriptions and comments frequently
          contain details of your store, your customers&rsquo; problems and occasionally credentials
          people paste in by mistake. Treat the task field as you would an email to us.
        </li>
        <li>
          A record of significant actions on the account — who queued what, who changed a plan, who
          was granted access. This is an audit trail; it is deliberately append-only and we do not
          edit it.
        </li>
      </ul>

      <h3>If you connect a Shopify store</h3>
      <p>
        The store domain and an <strong>access token, encrypted at rest</strong> with a key held
        separately from the database. The token is what lets us do the work you are paying for.
        Disconnecting a store <strong>destroys the token</strong> rather than flagging it — there is
        no soft delete, and we cannot recover it afterwards.
      </p>
      <p>
        We honour Shopify&rsquo;s mandatory data requests: when a merchant or Shopify asks for a
        customer&rsquo;s data, for its deletion, or for a shop&rsquo;s data to be redacted, our
        webhook handlers act on it.
      </p>

      <h3>If you run the free store scan</h3>
      <p>
        The URL you submitted and the result. No account is required and we do not attach it to a
        person. We keep scans for ninety days so a repeat scan can show a change.
      </p>

      <h3>Analytics</h3>
      <p>
        We do not run third-party analytics, advertising or session-recording scripts on this site.
        There is no cookie banner because there are no tracking cookies to consent to — the only
        cookie we set is the one that keeps you signed in.
      </p>

      <h2>Who else processes it</h2>
      <ul>
        <li>
          <strong>Netlify</strong> — hosting and the database. Data is stored in their managed
          Postgres.
        </li>
        <li>
          <strong>Shopify</strong> — only if you connect a store, and only the calls needed to do
          your tasks.
        </li>
        <li>
          <strong>Google PageSpeed Insights</strong> — receives the URL you submit to the free scan.
          Nothing else, and no account data.
        </li>
        <li>
          <strong>Stripe</strong> — if you pay by card. Card details go to Stripe directly; we never
          see or store them.
        </li>
      </ul>
      <p>
        That is the complete list. We will update it here before adding to it.
      </p>

      <h2>Where it is stored</h2>
      <p>
        On infrastructure in the region our hosting provider assigns, which may be outside your
        country. Where data leaves its origin region, it does so under the provider&rsquo;s standard
        contractual protections.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Account and task data: while your account is open, and twelve months after you close it.</li>
        <li>Unconverted enquiries: twelve months.</li>
        <li>Scan results: ninety days.</li>
        <li>
          Invoices and payment records: as long as tax law requires, which is longer than the rest
          and which we cannot shorten on request.
        </li>
      </ul>

      <h2>What you can ask for</h2>
      <p>
        A copy of everything we hold about you, a correction, or deletion. Ask us and we will do it
        — we do not require a form. Deletion removes your account, your tasks and any connected
        store tokens; it cannot remove entries from the audit trail or records we are legally
        required to keep, and we will tell you what those are.
      </p>

      <h2>Security</h2>
      <p>
        See <a href="/security">our security page</a> for how the system is actually built. If you
        believe you have found a vulnerability, that page explains how to tell us.
      </p>

      <h2>Contact</h2>
      <p>
        Any privacy question, including a request above: <a href="/contact">get in touch</a>.
      </p>
    </LegalPage>
  );
}
