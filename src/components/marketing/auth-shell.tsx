import Link from "next/link";
import type { ReactNode } from "react";

import { Container } from "@/components/layout/container";
import { Mesh } from "@/components/motion/mesh";
import { Reveal } from "@/components/motion/reveal";
import { SITE } from "@/content/site";
import { Text } from "@/components/ui/text";

/**
 * Auth surfaces are deliberately quieter than the marketing pages: no
 * preloader theatre, no marquee, no split-text. Someone signing in has a job to
 * do. The frame still comes from the same tokens so it is unmistakably Unbolt.
 *
 * Better Auth wiring lands in M3; this is the markup those handlers attach to.
 */
export function AuthShell({
  title,
  lede,
  children,
  footer,
}: {
  title: string;
  lede: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main id="main" className="relative flex min-h-svh items-center overflow-hidden py-20">
      <Mesh count={3} radius={0.5} speed={0.7} className="opacity-40" />
      <Container className="relative z-10 max-w-[26rem]">
        <Reveal>
          <Link
            href="/"
            className="font-display text-xl font-extrabold uppercase tracking-[-0.06em] text-ink"
          >
            {SITE.name}
          </Link>
          <h1 className="mt-9 font-display text-3xl font-extrabold tracking-[-0.04em] text-ink">
            {title}
          </h1>
          <Text variant="small" className="mt-3">
            {lede}
          </Text>
          <div className="mt-9">{children}</div>
          <div className="mt-7 border-t border-line pt-5 font-mono text-xs text-ink-3">
            {footer}
          </div>
        </Reveal>
      </Container>
    </main>
  );
}
