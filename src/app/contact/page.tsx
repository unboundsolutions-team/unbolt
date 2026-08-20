import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { SiteShell } from "@/components/layout/site-shell";
import { LeadForm } from "@/components/marketing/lead-form";
import { PageHero } from "@/components/marketing/page-hero";
import { Reveal } from "@/components/motion/reveal";
import { Text } from "@/components/ui/text";
import { publicPlans, sizeLabel } from "@/server/billing/plans";

/** Reads live plan rows for the selector, so it cannot be prerendered. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Talk to us",
  description:
    "Tell us what needs doing. We'll book a short call, size the work, and recommend the plan that actually fits.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [plans, params] = await Promise.all([publicPlans(), searchParams]);

  // Carried from the plan card they clicked, so the conversation starts where
  // they left off. Validated against real codes rather than trusted — a bad
  // value just means no preselection.
  const requested = typeof params["plan"] === "string" ? params["plan"] : undefined;
  const preselected = plans.some((p) => p.code === requested) ? requested : undefined;

  return (
    <SiteShell>
      <PageHero
        eyebrow="Talk to us"
        title="Tell us what needs doing."
        lede="Every plan starts with a short call. We'll show you the portal, size the work you have in mind, and tell you which pack fits — including when that's a smaller one than you were looking at."
      />

      <section className="py-20 sm:py-24">
        <Container className="max-w-[46rem]">
          <Reveal>
            <LeadForm
              plans={plans.map((p) => ({
                code: p.code,
                name: p.name,
                summary: sizeLabel(p.maxTaskHours).toLowerCase(),
              }))}
              {...(preselected ? { preselectedPlan: preselected } : {})}
            />
          </Reveal>

          <Reveal delay={0.1}>
            <Text variant="small" tone="faint" className="mt-8 font-mono">
              We reply inside one business day. Built by Unbound Solutions, Ahmedabad.
            </Text>
          </Reveal>
        </Container>
      </section>
    </SiteShell>
  );
}
