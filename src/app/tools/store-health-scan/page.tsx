import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { SiteShell } from "@/components/layout/site-shell";
import { Commitments } from "@/components/marketing/commitments";
import { PageHero } from "@/components/marketing/page-hero";
import { ScanRunner } from "@/components/marketing/scan-runner";
import { Reveal } from "@/components/motion/reveal";
import { SplitText } from "@/components/motion/split-text";
import { Text } from "@/components/ui/text";

export const metadata: Metadata = {
  title: "Free Store Health Scan",
  description:
    "Run a free automated scan on any Shopify storefront. Real Core Web Vitals, theme issues and a ranked list of what to fix. No account needed.",
  alternates: { canonical: "/tools/store-health-scan" },
};

/**
 * What the scan actually reports.
 *
 * ── Why this list shrank ────────────────────────────────────────────
 * It used to promise "Theme health" and "Checkout path". The scanner does not
 * do either — it audits one URL and cannot see a checkout it has no session
 * for, or read Liquid it is never served. Listing them was the same
 * unfalsifiable-claim problem §1 of the brief exists to avoid, aimed at
 * ourselves.
 *
 * Every line below corresponds to something buildFindings() can actually
 * produce from a real measurement. Adding a check here means adding it there
 * first.
 */
const CHECKS = [
  { name: "Core Web Vitals", body: "LCP, INP and CLS from real Chrome field data where your store has enough traffic for it, lab data where it does not." },
  { name: "Render blocking", body: "Stylesheets and scripts in the page head that hold up the first paint, counted." },
  { name: "Image weight", body: "How many bytes of imagery one page asks a phone to download before it is usable." },
  { name: "Script weight", body: "Total JavaScript, and how many separate third-party origins are running on the page." },
  { name: "Layout stability", body: "Whether the page moves under a shopper's thumb while it loads, measured not guessed." },
  { name: "Ranked fixes", body: "Not a list of problems — ordered by what we judge would move revenue first, with the measurement behind each one." },
];

export default function ScanPage() {
  return (
    <SiteShell>
      <PageHero
        eyebrow="Free tool"
        title="Find out what's slowing your store down."
        lede="One high-intent tool instead of forty filler calculators. Point it at any Shopify storefront and get a ranked list of what to fix — no account, no call."
      >
        <ScanRunner />
      </PageHero>

      <section className="py-20 sm:py-24">
        <Container>
          <Text variant="eyebrow">What it checks</Text>
          <SplitText
            text="Six things, measured not guessed."
            className="mt-5 font-display text-3xl font-extrabold leading-[1] tracking-[-0.04em] text-ink sm:text-4xl"
          />
          <div className="mt-14 grid gap-px border border-line bg-line [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
            {CHECKS.map((c, i) => (
              <Reveal key={c.name} delay={(i % 3) * 0.07}>
                <div className="h-full bg-base p-7">
                  <span className="font-mono text-xs tracking-[0.16em] text-accent">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h2 className="mt-4 font-display text-lg font-extrabold leading-[1.15] tracking-[-0.03em] text-ink">
                    {c.name}
                  </h2>
                  <p className="mt-3 text-sm leading-[1.6] text-ink-2">{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <Commitments />
    </SiteShell>
  );
}
