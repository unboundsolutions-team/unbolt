import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { SiteShell } from "@/components/layout/site-shell";
import { PageHero } from "@/components/marketing/page-hero";
import { Magnetic } from "@/components/motion/magnetic";
import { Reveal } from "@/components/motion/reveal";
import { SplitText } from "@/components/motion/split-text";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { SERVICES } from "@/content/site";

export const metadata: Metadata = {
  title: "Services",
  description:
    "Shopify development, performance, conversion work, integrations, headless builds and maintenance — all on one flat monthly subscription.",
  alternates: { canonical: "/services" },
};

export default function ServicesPage() {
  return (
    <SiteShell>
      <PageHero
        eyebrow="Services"
        title="Whatever the queue can hold."
        lede="There is no per-service pricing, because there are no projects. Anything on this list is just a task — you add it, we ship it, the next one starts."
      />

      <section className="py-20 sm:py-24">
        <Container>
          <div className="grid gap-px border border-line bg-line [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((s, i) => (
              <Reveal key={s.slug} delay={(i % 3) * 0.07}>
                <article className="group h-full bg-base p-7 transition-colors duration-(--duration-base) hover:bg-raised">
                  <span className="font-mono text-xs tracking-[0.16em] text-accent">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h2 className="mt-4 font-display text-xl font-extrabold leading-[1.1] tracking-[-0.03em] text-ink">
                    {s.name}
                  </h2>
                  <p className="mt-3 text-sm leading-[1.6] text-ink-2">{s.summary}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-line py-24 sm:py-32">
        <Container className="max-w-[44rem]">
          <Text variant="eyebrow">Not on the list?</Text>
          <SplitText
            text="Ask anyway."
            className="mt-5 font-display text-3xl font-extrabold leading-[1] tracking-[-0.04em] text-ink sm:text-4xl"
          />
          <Reveal delay={0.1}>
            <Text variant="bodyLarge" className="mt-6">
              If it is engineering work on an e-commerce storefront, it almost certainly
              fits. If it does not, we will say so quickly rather than scoping it for a
              week.
            </Text>
          </Reveal>
          <Reveal delay={0.16}>
            <div className="mt-9 flex flex-wrap gap-3">
              <Magnetic>
                <Button asChild variant="primary" size="lg">
                  <Link href="/contact">Ask us</Link>
                </Button>
              </Magnetic>
              <Magnetic>
                <Button asChild variant="secondary" size="lg">
                  <Link href="/pricing">See plans</Link>
                </Button>
              </Magnetic>
            </div>
          </Reveal>
        </Container>
      </section>
    </SiteShell>
  );
}
