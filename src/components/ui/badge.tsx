import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

const badge = cva(
  [
    "inline-flex items-center gap-1.5 whitespace-nowrap",
    "font-mono text-xs font-medium uppercase tracking-[0.08em]",
    "rounded-(--radius-sm) border px-2 py-1 leading-none",
  ],
  {
    variants: {
      tone: {
        neutral: "bg-inset text-ink-2 border-line-strong",
        accent: "bg-accent-soft text-accent border-accent/20",
        shipped: "bg-shipped-soft text-shipped border-shipped/20",
        urgent: "bg-urgent-soft text-urgent border-urgent/20",
        outline: "bg-transparent text-ink-2 border-line-strong",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badge> {
  children?: ReactNode;
}

export function Badge({ tone, className, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badge({ tone }), className)} {...props}>
      {children}
    </span>
  );
}
