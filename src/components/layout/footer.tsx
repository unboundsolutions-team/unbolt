import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Mesh } from "@/components/motion/mesh";
import { SplitText } from "@/components/motion/split-text";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { FOOTER_NAV, SITE } from "@/content/site";

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-line">
      <Mesh speed={0.6} count={3} radius={0.55} className="opacity-40" />

      <Container className="relative z-10 py-20">
        <SplitText
          text="Let's ship something."
          as="h2"
          className="font-display text-3xl font-extrabold tracking-[-0.04em] text-ink sm:text-4xl lg:text-5xl"
        />
        <div className="mt-8">
          <Button asChild variant="primary" size="lg">
            <Link href="/pricing">Start a plan</Link>
          </Button>
        </div>

        <div className="mt-20 grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_repeat(2,1fr)]">
          <div className="flex flex-col gap-3">
            <span className="font-display text-xl font-extrabold uppercase tracking-[-0.06em] text-ink">
              {SITE.name}
            </span>
            <Text variant="small" tone="faint" className="max-w-[24rem]">
              {SITE.tagline} Built by {SITE.parent}, {SITE.locality}.
            </Text>
          </div>

          {FOOTER_NAV.map((group) => (
            <nav key={group.heading} aria-label={group.heading} className="flex flex-col gap-3">
              <Text variant="eyebrow" as="h2">
                {group.heading}
              </Text>
              <ul className="flex flex-col gap-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="font-sans text-sm text-ink-2 transition-colors duration-(--duration-fast) hover:text-accent"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 font-mono text-xs text-ink-3">
          <span>© {new Date().getFullYear()} {SITE.parent}</span>
          <span>unbolt.unboundsolutions.in</span>
        </div>
      </Container>
    </footer>
  );
}
