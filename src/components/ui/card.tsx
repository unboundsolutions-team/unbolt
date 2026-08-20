import type { ElementType, HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Cards lift toward light rather than away from it. On a warm paper canvas that
 * reads as a sheet laid on a sheet, which is the whole conceit — a dark-UI
 * shadow-and-darker-fill card would fight it.
 */
export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  variant?: "raised" | "outline" | "sunk" | "panel";
  interactive?: boolean;
  children?: ReactNode;
}

export function Card({
  as: Comp = "div",
  variant = "raised",
  interactive = false,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <Comp
      className={cn(
        "rounded-(--radius-lg) border",
        variant === "raised" && "bg-card border-line shadow-sm",
        variant === "outline" && "bg-transparent border-line",
        variant === "sunk" && "bg-inset border-line-strong",
        variant === "panel" && "bg-card border-line text-ink",
        interactive && [
          "transition-[transform,box-shadow,border-color]",
          "duration-(--duration-base) ease-(--ease-out-expo)",
          "motion-safe:hover:-translate-y-0.5",
          "hover:shadow-md hover:border-line-strong",
        ],
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-3 border-t border-line px-5 py-3.5", className)}
      {...props}
    />
  );
}
