import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";
import { SITE } from "@/content/site";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "What you are buying when you buy an Unbolt task pack, what we commit to, and what happens when either side wants to stop.",
  alternates: { canonical: "/legal/terms" },
};

/**
 * Written from what the product actually does.
 *
 * Every clause here corresponds to something implemented: the allowance is a
 * finite counter, the concurrency cap is a unique index, the estimate ceiling
 * blocks a task, packs do not expire because nothing expires them. Terms that
 * describe a different product than the one running are worse than no terms,
 * because they are a promise nobody in the company knows they made.
 */
export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of service"
      lede="What you get, what we owe you, and what happens if either of us wants to stop."
      lastReviewed={null}
    >
      <h2>Who you are contracting with</h2>
      <p>
        {SITE.name} is a service operated by {SITE.parent}, {SITE.locality}. In these terms
        &ldquo;we&rdquo; and &ldquo;us&rdquo; mean {SITE.parent}; &ldquo;you&rdquo; means the
        business that buys a pack.
      </p>

      <h2>What you are buying</h2>
      <p>
        A <strong>task pack</strong>: a fixed number of engineering tasks at a fixed price, bought
        once. It is not a subscription. There is no recurring charge, and nothing renews.
      </p>
      <ul>
        <li>
          <strong>Tasks are a count, not a time allowance.</strong> A pack of five means five tasks.
          When they are used, you buy another pack or upgrade.
        </li>
        <li>
          <strong>Unused tasks do not expire.</strong> There is no deadline by which you must use
          them and no mechanism that removes them.
        </li>
        <li>
          <strong>Your plan sets how many run at once.</strong> You may queue as many tasks as your
          allowance permits; the number worked simultaneously is capped by your plan. This is what
          makes delivery predictable rather than merely generous.
        </li>
        <li>
          <strong>Each plan has a size ceiling per task.</strong> Before work begins we estimate the
          task in hours. If our estimate exceeds your plan&rsquo;s ceiling, the task is held and we
          tell you both numbers. You can split it, upgrade, or withdraw it. We do not start work on
          a held task and we do not spend a credit on one.
        </li>
      </ul>

      <h2>How a task is counted</h2>
      <p>
        A credit is spent when a task is <strong>queued</strong>, not when it is finished. If we
        cancel a task before starting it, or if it turns out we cannot do it, we return the credit.
        If you withdraw a task after we have begun work, the credit is spent.
      </p>

      <h2>Response times</h2>
      <p>
        Each plan states a response SLA. That is the time within which we respond to a queued
        task — acknowledge it, estimate it, or ask you a question — not the time within which it
        ships. Delivery time depends on the work, and we tell you our estimate before starting.
      </p>
      <p>
        The clock runs from when you queue the task. It pauses while we are waiting on an answer
        from you, because we cannot be held to a deadline we are blocked on.
      </p>

      <h2>What we need from you</h2>
      <ul>
        <li>Access sufficient to do the work — usually a Shopify connection or staff account.</li>
        <li>Answers to questions we raise on a task. Work stops until we have them.</li>
        <li>That you have the right to grant us access to the systems you connect.</li>
      </ul>

      <h2>Your code and your data</h2>
      <p>
        <strong>You own the work we produce for you</strong>, on payment. We keep no rights over
        code written for your store beyond the general techniques and know-how any engineer carries
        between jobs.
      </p>
      <p>
        We do not use your store data, your code or the contents of your tasks to train models, and
        we do not share them with anyone outside the people working on your account. See the{" "}
        <a href="/legal/privacy">privacy policy</a> for what we store and who processes it.
      </p>

      <h2>Payment</h2>
      <p>
        Packs are quoted and invoiced after a call. Your account is provisioned once payment
        clears; credits are granted at that point and not before. Prices shown on the site are the
        current prices for new purchases — what you bought is fixed at the terms in force when you
        bought it, and a later price change does not alter your account.
      </p>

      <h2>Refunds</h2>
      <p>
        If we have not started work on any task in a pack, we refund it in full. Once work has
        begun, we refund the unused credits and keep the value of the work delivered. If we deliver
        something that does not do what we agreed, we fix it — that is not a refund question.
      </p>

      <h2>Stopping</h2>
      <p>
        There is nothing to cancel, because there is nothing recurring. You can stop buying packs at
        any time. We will export your task history on request.
      </p>
      <p>
        We may decline further work if an account is used for anything unlawful, or to work on a
        system you are not authorised to change. We will say why.
      </p>

      <h2>Liability</h2>
      <p>
        We carry the ordinary responsibility of a supplier for the work we do. We are not liable for
        losses that were not reasonably foreseeable, and our total liability for any claim is capped
        at what you paid us in the twelve months before it arose. Nothing here limits liability that
        cannot lawfully be limited.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        We will publish changes here and email account owners before they take effect. Changes do
        not apply retroactively to a pack you have already bought.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of India, and the courts of Ahmedabad, Gujarat have
        exclusive jurisdiction.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about any of this: <a href="/contact">get in touch</a>. A real person answers.
      </p>
    </LegalPage>
  );
}
