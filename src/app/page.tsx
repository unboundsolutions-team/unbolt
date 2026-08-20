import Link from "next/link";

import { Container } from "@/components/layout/container";
import { SiteShell } from "@/components/layout/site-shell";
import { Magnetic } from "@/components/motion/magnetic";
import { Marquee } from "@/components/motion/marquee";
import { Mesh } from "@/components/motion/mesh";
import { Reveal } from "@/components/motion/reveal";
import { SplitText } from "@/components/motion/split-text";
import { Commitments } from "@/components/marketing/commitments";
import { Faq } from "@/components/marketing/faq";
import { PlanCards } from "@/components/marketing/plan-cards";
import { publicPlans } from "@/server/billing/plans";
import { Steps } from "@/components/marketing/steps";
import { QueueBoard } from "@/components/product/queue-board";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { MARQUEE, SITE } from "@/content/site";
import { demoTasks } from "@/lib/demo";

/** Renders live plan rows, so it cannot be prerendered at build time. */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const plans = await publicPlans();

  const tasks = demoTasks();

  return (
    <SiteShell>
      {/* ── HERO ──────────────────────────────────────────────
          The board is the backdrop, not a screenshot beside the copy.
          The thesis: show the product working in two seconds on a public
          page — exactly the asset the competitor hides behind a login. */}
      <section className="relative flex min-h-svh items-center overflow-hidden pb-20 pt-36">
        <Mesh count={5} radius={0.5} className="opacity-50" />

        <div className="absolute inset-0 z-0 grid justify-items-end pr-[2vw]">
          <div className="w-[min(1240px,124%)] self-center opacity-90 [transform:perspective(1800px)_rotateX(16deg)_rotateZ(-8deg)_scale(1.02)]">
            <QueueBoard
              tasks={tasks}
              columns={["queued", "in_progress", "shipped"]}
              concurrencyLimit={2}
            />
          </div>
        </div>

        {/* Reads the board *through* the type: opaque under the headline so it
            holds contrast, clearing to nothing on the right so the board stays
            legible. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 z-10 bg-[linear-gradient(100deg,var(--color-base)_0%,color-mix(in_srgb,var(--color-base)_97%,transparent)_34%,color-mix(in_srgb,var(--color-base)_72%,transparent)_52%,color-mix(in_srgb,var(--color-base)_30%,transparent)_74%,color-mix(in_srgb,var(--color-base)_12%,transparent)_100%)]"
        />

        <Container className="relative z-20">
          <Reveal>
            <p className="flex items-center gap-2.5 font-mono text-xs uppercase tracking-[0.2em] text-accent">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-accent motion-safe:animate-[pulse-soft_2s_ease-in-out_infinite]"
              />
              2 engineers shipping right now
            </p>
          </Reveal>

          <SplitText
            text="Ship it this week."
            as="h1"
            immediate
            delay={0.15}
            className="mt-7 max-w-[12ch] font-display text-5xl font-extrabold leading-[0.92] tracking-[-0.045em] text-ink sm:text-6xl lg:text-[6.4rem]"
          />

          <Reveal delay={0.3}>
            <Text variant="bodyLarge" className="mt-7 max-w-[32rem]">
              Buy a pack of engineering tasks. Senior engineers ship them, usually
              inside a week. No project fees, no change orders, no minimum term.
            </Text>
          </Reveal>

          <Reveal delay={0.38}>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Magnetic>
                <Button asChild variant="primary" size="lg">
                  <Link href="/pricing">See plans</Link>
                </Button>
              </Magnetic>
              <Magnetic>
                <Button asChild variant="secondary" size="lg">
                  <Link href="/how-it-works">How it works</Link>
                </Button>
              </Magnetic>
            </div>
          </Reveal>
        </Container>
      </section>

      <Marquee items={MARQUEE} />
      <Commitments />

      {/* ── HOW IT WORKS ─────────────────────────────────────── */}
      <section className="py-24 sm:py-32">
        <Container>
          <Text variant="eyebrow">How it works</Text>
          <SplitText
            text="Buy the work you need. Nothing you don't."
            className="mt-5 max-w-[18ch] font-display text-3xl font-extrabold leading-[1] tracking-[-0.04em] text-ink sm:text-4xl lg:text-5xl"
          />
          <Reveal delay={0.1}>
            <Text variant="bodyLarge" className="mt-6 max-w-[38rem]">
              A plan is a pack of tasks, not a subscription. Submit them when you
              want, at a price agreed before anyone starts — and your plan decides
              how many we work on at once, which is what keeps delivery
              predictable rather than merely promised.
            </Text>
          </Reveal>
          <Steps />
        </Container>
      </section>

      {/* ── THE BOARD, UP CLOSE ──────────────────────────────── */}
      <section className="border-t border-line bg-raised py-24 sm:py-32">
        <Container>
          <Text variant="eyebrow">Live queue</Text>
          <SplitText
            text="You can see the work. Before you pay for it."
            className="mt-5 max-w-[18ch] font-display text-3xl font-extrabold leading-[1] tracking-[-0.04em] text-ink sm:text-4xl lg:text-5xl"
          />
          <Reveal delay={0.1}>
            <Text variant="bodyLarge" className="mt-6 max-w-[38rem]">
              Queue position, who picked it up, an SLA countdown and a preview link.
              The same board you get in the portal — not a screenshot of one.
            </Text>
          </Reveal>
          <Reveal delay={0.16}>
            <div className="mt-14">
              <QueueBoard tasks={tasks} concurrencyLimit={2} />
            </div>
          </Reveal>
        </Container>
      </section>

      {/* ── PRICING ──────────────────────────────────────────── */}
      <section id="pricing" className="border-t border-line py-24 sm:py-32">
        <Container>
          <Text variant="eyebrow">Pricing</Text>
          <SplitText
            text="One flat fee. Cancel any month."
            className="mt-5 max-w-[18ch] font-display text-3xl font-extrabold leading-[1] tracking-[-0.04em] text-ink sm:text-4xl lg:text-5xl"
          />
          <PlanCards plans={plans} />
        </Container>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section className="border-t border-line py-24 sm:py-32">
        <Container className="max-w-[56rem]">
          <Text variant="eyebrow">Questions</Text>
          <SplitText
            text="The things people ask first."
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
        // Organization + Service, so the plan structure is machine-readable.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: SITE.name,
            url: SITE.url,
            parentOrganization: { "@type": "Organization", name: SITE.parent },
            description: SITE.description,
          }),
        }}
      />
    </SiteShell>
  );
}
