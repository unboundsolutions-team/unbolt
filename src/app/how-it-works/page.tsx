import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { SiteShell } from "@/components/layout/site-shell";
import { Commitments } from "@/components/marketing/commitments";
import { PageHero } from "@/components/marketing/page-hero";
import { Steps } from "@/components/marketing/steps";
import { Marquee } from "@/components/motion/marquee";
import { Reveal } from "@/components/motion/reveal";
import { SplitText } from "@/components/motion/split-text";
import { QueueBoard } from "@/components/product/queue-board";
import { Text } from "@/components/ui/text";
import { MARQUEE } from "@/content/site";
import { demoTasks } from "@/lib/demo";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Queue a task in a sentence. Watch it move with the SLA clock visible. Get a preview link before anything touches your live store.",
  alternates: { canonical: "/how-it-works" },
};

/** Every way a task can reach us. The queue object is the same either way. */
const CHANNELS = [
  { name: "Portal", body: "Type a sentence, hit add. The default for most tasks." },
  { name: "Slack", body: "Professional and up. Post it in the shared channel." },
  { name: "REST API", body: "For teams already automating their own ops." },
  { name: "CLI", body: "unbolt task add \"…\" — for the people who prefer a terminal." },
] as const;

export default function HowItWorksPage() {
  return (
    <SiteShell>
      <PageHero
        eyebrow="How it works"
        title="Buy the work you need. Nothing you don't."
        lede="You add as many tasks as you like. Your plan decides how many run at once — that is what keeps delivery predictable instead of merely generous."
      />

      <section className="py-20 sm:py-24">
        <Container>
          <Steps headingLevel={2} />
        </Container>
      </section>

      <Marquee items={MARQUEE} />

      {/* ── THE BOARD ────────────────────────────────────────── */}
      <section className="py-24 sm:py-32">
        <Container>
          <Text variant="eyebrow">Transparency</Text>
          <SplitText
            text="The clock is visible to you, not just to us."
            className="mt-5 max-w-[18ch] font-display text-3xl font-extrabold leading-[1] tracking-[-0.04em] text-ink sm:text-4xl lg:text-5xl"
          />
          <Reveal delay={0.1}>
            <Text variant="bodyLarge" className="mt-6 max-w-[38rem]">
              Every task carries its queue position, the engineer who picked it up and
              a live SLA countdown. If we are going to miss it, you see that before we
              tell you — which is the point.
            </Text>
          </Reveal>
          <Reveal delay={0.16}>
            <div className="mt-14">
              <QueueBoard tasks={demoTasks()} concurrencyLimit={2} />
            </div>
          </Reveal>
        </Container>
      </section>

      {/* ── CHANNELS ─────────────────────────────────────────── */}
      <section className="border-t border-line bg-raised py-24 sm:py-32">
        <Container>
          <Text variant="eyebrow">Portal · Slack · API · CLI</Text>
          <SplitText
            text="Queue it from wherever you already are."
            className="mt-5 max-w-[18ch] font-display text-3xl font-extrabold leading-[1] tracking-[-0.04em] text-ink sm:text-4xl lg:text-5xl"
          />

          <div className="mt-14 grid gap-8 [&>*]:min-w-0 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <Reveal>
              <ul className="grid gap-px border border-line bg-line">
                {CHANNELS.map((c) => (
                  <li key={c.name} className="bg-base p-5">
                    <span className="font-mono text-xs uppercase tracking-[0.14em] text-accent">
                      {c.name}
                    </span>
                    <p className="mt-2 text-sm text-ink-2">{c.body}</p>
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal delay={0.12}>
              <div className="min-w-0 max-w-full overflow-hidden rounded-(--radius-lg) border border-line bg-base shadow-(--shadow-panel)">
                <div className="flex items-center gap-1.5 border-b border-line px-4 py-3">
                  <span aria-hidden="true" className="size-2.5 rounded-full bg-ink-3/50" />
                  <span aria-hidden="true" className="size-2.5 rounded-full bg-ink-3/50" />
                  <span aria-hidden="true" className="size-2.5 rounded-full bg-ink-3/50" />
                  <span className="ml-2.5 font-mono text-xs text-ink-3">unbolt — queue</span>
                </div>
                <pre className="max-w-full overflow-x-auto p-5 [contain:paint]">
                  <code className="block font-mono text-xs leading-[1.95] text-ink-2 sm:text-sm">
                    <span className="text-accent">$</span> unbolt task add{" "}
                    <span className="text-ink">
                      &quot;variant swatches drop on mobile safari&quot;
                    </span>
                    {"\n"}
                    <span className="text-ink-3">→</span> UNB-312 queued · position 1 · SLA 24h
                    {"\n"}
                    <span className="text-accent">$</span> unbolt queue --watch
                    {"\n"}
                    <span className="text-ink-3">→</span> UNB-312{" "}
                    <span className="text-progress">in progress</span> · riya · 03:23:27 left
                    {"\n"}
                    <span className="text-ink-3">→</span> UNB-309{" "}
                    <span className="text-shipped">shipped</span> · preview: havenwear.dev
                    {"\n"}
                    <span className="text-accent">$</span>{" "}
                    <span
                      aria-hidden="true"
                      className="inline-block h-[1em] w-2 translate-y-[0.15em] bg-accent motion-safe:animate-[blink_1.1s_steps(2)_infinite]"
                    />
                  </code>
                </pre>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      <Commitments />
    </SiteShell>
  );
}
