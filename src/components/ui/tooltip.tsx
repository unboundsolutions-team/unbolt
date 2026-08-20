"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * A tooltip may only ever repeat or expand on something already visible. It is
 * not reachable by touch and it is not reachable by every assistive technology,
 * so nothing that a user must know to complete a task lives here.
 */
export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            "u-pop z-50 max-w-[16rem] rounded-(--radius-sm) px-2.5 py-1.5",
            "bg-card text-ink font-sans text-xs leading-[1.45]",
            "shadow-panel",
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-raised" width={10} height={5} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
