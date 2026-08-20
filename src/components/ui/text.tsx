import { cva, type VariantProps } from "class-variance-authority";
import type { ElementType, HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The type scale. Components choose a role, never a font size — that is what
 * keeps the serif/sans/mono split meaningful instead of decorative.
 *
 *   display  Newsreader, editorial, page-level statements only
 *   heading  Newsreader at section scale
 *   title    Instrument Sans, component headers
 *   body     Instrument Sans, reading copy
 *   mono     IBM Plex Mono — ticket refs, timestamps, SLA clocks, labels
 *
 * Mono is what keeps an editorial page reading as an engineering product. It is
 * reserved for machine-generated values; never for prose.
 */
const text = cva("", {
  variants: {
    variant: {
      display:
        "font-display font-extrabold text-4xl sm:text-5xl lg:text-6xl leading-[0.94] tracking-[-0.04em] text-ink text-balance",
      heading:
        "font-display font-extrabold text-2xl sm:text-3xl lg:text-4xl leading-[1] tracking-[-0.035em] text-ink text-balance",
      subheading:
        "font-display font-bold text-xl sm:text-2xl leading-[1.1] tracking-[-0.028em] text-ink text-balance",
      title: "font-sans font-medium text-lg leading-[1.35] tracking-[-0.008em] text-ink",
      body: "font-sans font-normal text-base leading-[1.62] text-ink-2 text-pretty",
      bodyLarge: "font-sans font-normal text-lg leading-[1.58] text-ink-2 text-pretty",
      small: "font-sans font-normal text-sm leading-[1.55] text-ink-2 text-pretty",
      /** Section markers. Sparing — only where content is genuinely sequential. */
      eyebrow:
        "font-mono font-medium text-xs uppercase tracking-[0.14em] text-ink-3",
      mono: "font-mono font-normal text-sm tracking-[-0.01em] text-ink-2",
      monoSmall: "font-mono font-normal text-xs tracking-[0.01em] text-ink-3",
    },
    tone: {
      default: "",
      ink: "text-ink",
      muted: "text-ink-2",
      faint: "text-ink-3",
      accent: "text-accent",
      shipped: "text-shipped",
      urgent: "text-urgent",
    },
    measure: {
      none: "",
      prose: "max-w-(--container-prose)",
      tight: "max-w-[32rem]",
    },
  },
  defaultVariants: { variant: "body", tone: "default", measure: "none" },
});

const DEFAULT_TAG: Record<string, ElementType> = {
  display: "h1",
  heading: "h2",
  subheading: "h3",
  title: "h4",
  body: "p",
  bodyLarge: "p",
  small: "p",
  eyebrow: "p",
  mono: "span",
  monoSmall: "span",
};

export interface TextProps
  extends Omit<HTMLAttributes<HTMLElement>, "color">,
    VariantProps<typeof text> {
  as?: ElementType;
  children?: ReactNode;
}

export function Text({
  as,
  variant = "body",
  tone,
  measure,
  className,
  children,
  ...props
}: TextProps) {
  const Comp: ElementType = as ?? DEFAULT_TAG[variant ?? "body"] ?? "p";
  return (
    <Comp className={cn(text({ variant, tone, measure }), className)} {...props}>
      {children}
    </Comp>
  );
}

export { text as textVariants };
