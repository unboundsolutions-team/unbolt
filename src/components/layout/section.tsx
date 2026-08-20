import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";
import { Container } from "./container";

/**
 * A vertical band. `ruled` draws the full-bleed hairline at the top — the rule
 * spans the viewport while the content stays on the measure, which is what
 * makes the page read as a sheet rather than a stack of cards.
 */
export interface SectionProps extends HTMLAttributes<HTMLElement> {
  ruled?: boolean;
  density?: "tight" | "normal" | "loose";
  surface?: "canvas" | "raised" | "sunk" | "panel";
  bleed?: boolean;
  children?: ReactNode;
}

export function Section({
  ruled = false,
  density = "normal",
  surface = "canvas",
  bleed = false,
  className,
  children,
  ...props
}: SectionProps) {
  return (
    <section
      className={cn(
        ruled && "border-t border-line",
        density === "tight" && "py-12 sm:py-16",
        density === "normal" && "py-20 sm:py-28",
        density === "loose" && "py-28 sm:py-40",
        surface === "raised" && "bg-card",
        surface === "sunk" && "bg-inset",
        surface === "panel" && "u-panel",
        className,
      )}
      {...props}
    >
      {bleed ? children : <Container>{children}</Container>}
    </section>
  );
}
