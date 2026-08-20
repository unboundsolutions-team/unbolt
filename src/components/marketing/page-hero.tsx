import type { ReactNode } from "react";

import { Container } from "@/components/layout/container";
import { Mesh } from "@/components/motion/mesh";
import { Reveal } from "@/components/motion/reveal";
import { SplitText } from "@/components/motion/split-text";
import { Text } from "@/components/ui/text";

/**
 * Interior page hero. Deliberately smaller than the home hero — an inside page
 * should get to the content, not re-pitch the product.
 */
export function PageHero({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-line pb-16 pt-36 sm:pb-20 sm:pt-44">
      <Mesh count={3} radius={0.45} speed={0.8} className="opacity-50" />
      <Container className="relative z-10">
        <Reveal>
          <Text variant="eyebrow">{eyebrow}</Text>
        </Reveal>
        <SplitText
          text={title}
          as="h1"
          delay={0.05}
          className="mt-6 max-w-[16ch] font-display text-4xl font-extrabold leading-[0.94] tracking-[-0.04em] text-ink sm:text-5xl lg:text-6xl"
        />
        {lede ? (
          <Reveal delay={0.12}>
            <Text variant="bodyLarge" className="mt-7 max-w-[38rem]">
              {lede}
            </Text>
          </Reveal>
        ) : null}
        {children ? <Reveal delay={0.18}>{children}</Reveal> : null}
      </Container>
    </section>
  );
}
