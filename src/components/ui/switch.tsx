"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { useId } from "react";

import { cn } from "@/lib/cn";

/**
 * A switch takes effect immediately; a checkbox waits for a submit. Use this
 * only for settings that apply the moment they are flipped.
 */
export function Switch({
  label,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & { label: string }) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <SwitchPrimitive.Root
        id={id}
        className={cn(
          "peer relative h-[22px] w-[38px] shrink-0 rounded-full border",
          "border-line-strong bg-inset",
          "transition-colors duration-(--duration-fast) ease-(--ease-out-expo)",
          "data-[state=checked]:bg-accent data-[state=checked]:border-accent",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "block size-4 rounded-full bg-card shadow-sm",
            "translate-x-[2px] will-change-transform",
            "transition-transform duration-(--duration-fast) ease-(--ease-out-expo)",
            "data-[state=checked]:translate-x-[18px]",
          )}
        />
      </SwitchPrimitive.Root>
      <LabelPrimitive.Root
        htmlFor={id}
        className="font-sans text-sm text-ink select-none peer-disabled:opacity-50"
      >
        {label}
      </LabelPrimitive.Root>
    </div>
  );
}
