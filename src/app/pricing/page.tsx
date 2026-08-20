import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { SiteShell } from "@/components/layout/site-shell";
import { Commitments } from "@/components/marketing/commitments";
import { Faq } from "@/components/marketing/faq";
import { PageHero } from "@/components/marketing/page-hero";
import { PlanCards } from "@/components/marketing/plan-cards";
import { Reveal } from "@/components/motion/reveal";
import { SplitText } from "@/components/motion/split-text";
import { Text } from "@/components/ui/text";
import { FAQS, SITE } from "@/content/site";
import { formatPrice, publicPlans, sizeLabel, slaLabel } from "@/server/billing/plans";

/**
 * Reads live plan rows, so it cannot be prerendered at build time — there is no
 * database during the build, and a stale price is worse than a dynamic render.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Fixed-price engineering task packs. Buy the tasks you need, with an agreed size limit and response SLA. Standard, Professional and Enterprise.",
  alternates: { canonical: "/pricing" },
};

/**
 * The comparison the competitor's pricing page refuses to make.
 *
 * Rows whose values are administered — task count, concurrency, the hours
 * ceiling — are filled from the database at render, not written here. Anything
 * typed as a literal in this file is a claim that can drift away from what a
 * customer actually bought the moment someone edits a plan in /admin.
 */
const COMPARE_STATIC = [
  ["Shared Slack channel", false, true, true],
  ["Weekly written report", false, true, true],
  ["Named engineering lead", false, false, true],
  ["Shopify Plus / B2B", false, false, true],
  ["Invoice billing", false, false, true],
] as const;

/**
 * One cell of the comparison table.
 *
 * The tick and dash are decorative glyphs, so the meaning has to be carried by
 * real text. It was carried by `aria-label` on a plain <span>, which does
 * nothing at all: a span has no role, so it is not in the accessibility tree
 * and the label is discarded. Every row of the comparison then announced as
 * empty, which makes the table — the whole point of the pricing page — useless
 * to anyone using a screen reader, while looking completely correct in source.
 *
 * Visually-hidden text is announced by every assistive technology and needs no
 * role to be invented for it.
 */
function Cell({ v }: { v: string | boolean }) {
  if (v === true)
    return (
      <span className="text-accent">
        <span aria-hidden="true">✓</span>
        <span className="sr-only">Included</span>
      </span>
    );
  if (v === false)
    return (
      <span className="text-ink-3">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not included</span>
      </span>
    );
  return <span data-numeric>{v}</span>;
}

/** One comparison row, filled from the live plan rows. */
function ComparisonRow({
  label,
  plans,
  value,
}: {
  label: string;
  plans: readonly Awaited<ReturnType<typeof publicPlans>>[number][];
  value: (plan: Awaited<ReturnType<typeof publicPlans>>[number]) => string;
}) {
  return (
    <tr className="transition-colors duration-(--duration-micro) hover:bg-raised">
      <th
        scope="row"
        className="border-b border-line px-4 py-3.5 text-left text-sm font-normal text-ink-2"
      >
        {label}
      </th>
      {plans.map((plan) => (
        <td key={plan.id} className="border-b border-line px-4 py-3.5 font-mono text-sm text-ink">
          <span data-numeric>{value(plan)}</span>
        </td>
      ))}
    </tr>
  );
}

export default async function PricingPage() {
  const plans = await publicPlans();

  return (
    <SiteShell>
      <PageHero
        eyebrow="Pricing"
        title="Buy a pack. Use it when you need it."
        lede="Each plan is a fixed number of tasks at a fixed price — no subscription, and nothing expiring at the end of the month. What differs is how big a single task can be, how many we run at once, and how fast you hear back."
      />

      <section className="py-20 sm:py-24">
        <Container>
          <PlanCards plans={plans} headingLevel={2} />
          <Reveal delay={0.1}>
            <p className="mt-8 max-w-[46rem] font-mono text-xs leading-[1.7] text-ink-3">
              Prices in USD, bought once. There is no subscription and nothing
              expires — unused tasks stay yours. Every plan starts with a short call so
              we can size the work and recommend the right one; Enterprise is invoiced
              and provisioned by our team.
            </p>
          </Reveal>
        </Container>
      </section>

      <Commitments />

      {/* ── COMPARISON ───────────────────────────────────────── */}
      <section className="py-24 sm:py-32">
        <Container>
          <Text variant="eyebrow">Compare</Text>
          <SplitText
            text="Everything, side by side."
            className="mt-5 font-display text-3xl font-extrabold leading-[1] tracking-[-0.04em] text-ink sm:text-4xl"
          />

          <Reveal delay={0.1}>
            <div className="mt-12 w-full max-w-full overflow-x-auto [contain:paint]">
              <table className="w-full min-w-[40rem] border-collapse text-left">
                <caption className="sr-only">Plan comparison</caption>
                <thead>
                  <tr>
                    <th className="border-b border-line-strong px-4 py-3 font-mono text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
                      Feature
                    </th>
                    {plans.map((p) => (
                      <th
                        key={p.id}
                        className="border-b border-line-strong px-4 py-3 font-display text-base font-extrabold tracking-[-0.02em] text-ink"
                      >
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Administered values first, straight from the rows. */}
                  <ComparisonRow label="Tasks in the pack" plans={plans} value={(p) => String(p.taskAllowance)} />
                  <ComparisonRow label="Worked at once" plans={plans} value={(p) => String(p.concurrencyLimit)} />
                  <ComparisonRow label="Size limit per task" plans={plans} value={(p) => sizeLabel(p.maxTaskHours)} />
                  <ComparisonRow label="Response SLA" plans={plans} value={(p) => slaLabel(p.slaHours)} />
                  <ComparisonRow label="Price" plans={plans} value={(p) => formatPrice(p.priceCents, p.currency)} />

                  {COMPARE_STATIC.map(([label, ...values]) => (
                    <tr
                      key={label as string}
                      className="transition-colors duration-(--duration-micro) hover:bg-raised"
                    >
                      <th
                        scope="row"
                        className="border-b border-line px-4 py-3.5 text-left text-sm font-normal text-ink-2"
                      >
                        {label as string}
                      </th>
                      {values.map((v, i) => (
                        <td
                          key={i}
                          className="border-b border-line px-4 py-3.5 font-mono text-sm text-ink"
                        >
                          <Cell v={v} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="border-t border-line py-24 sm:py-32">
        <Container className="max-w-[56rem]">
          <Text variant="eyebrow">Questions</Text>
          <SplitText
            text="Before you commit."
            className="mt-5 font-display text-3xl font-extrabold leading-[1] tracking-[-0.04em] text-ink sm:text-4xl"
          />
          <Faq />
        </Container>
      </section>

      {/*
        No nonce here, deliberately.
        
        A nonce looks like the right thing to add under a policy that says every
        script carries one, and it breaks the page in a quieter way: the browser
        blanks the nonce content attribute after parsing — an anti-exfiltration
        measure — so React compares nonce="…" from the server against nonce=""
        on the client and reports a hydration mismatch on the two highest-traffic
        pages in the product.
        
        It buys nothing in exchange. Checked against the enforcing policy with a
        securitypolicyviolation listener: this block produces no violation,
        because application/ld+json is a data block that is never evaluated and
        so is not subject to script-src.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQS.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          }),
        }}
      />
      {/*
        No nonce here, deliberately.
        
        A nonce looks like the right thing to add under a policy that says every
        script carries one, and it breaks the page in a quieter way: the browser
        blanks the nonce content attribute after parsing — an anti-exfiltration
        measure — so React compares nonce="…" from the server against nonce=""
        on the client and reports a hydration mismatch on the two highest-traffic
        pages in the product.
        
        It buys nothing in exchange. Checked against the enforcing policy with a
        securitypolicyviolation listener: this block produces no violation,
        because application/ld+json is a data block that is never evaluated and
        so is not subject to script-src.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Service",
            serviceType: "Engineering subscription",
            provider: { "@type": "Organization", name: SITE.name, url: SITE.url },
            // Structured data has to agree with the page. Reading it from the
            // same rows means a plan edit cannot leave Google quoting a price
            // we stopped charging.
            offers: plans.map((p) => ({
              "@type": "Offer",
              name: p.name,
              price: p.priceCents / 100,
              priceCurrency: p.currency,
              url: `${SITE.url}/pricing`,
            })),
          }),
        }}
      />
    </SiteShell>
  );
}
