import type { ElementType, HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * One measure for the whole site. Every page shares the same left and right
 * edges so the full-bleed hairlines line up across sections — that alignment is
 * the tight grid the design direction is built on.
 */
export interface ContainerProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  width?: "measure" | "prose" | "wide";
  children?: ReactNode;
}

export function Container({
  as: Comp = "div",
  width = "measure",
  className,
  children,
  ...props
}: ContainerProps) {
  return (
    <Comp
      className={cn(
        "mx-auto w-full px-(--spacing-gutter)",
        width === "measure" && "max-w-(--container-measure)",
        width === "prose" && "max-w-(--container-prose)",
        width === "wide" && "max-w-[86rem]",
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  );
}
