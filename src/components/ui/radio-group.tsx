"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import * as RadioPrimitive from "@radix-ui/react-radio-group";
import { useId } from "react";

import { cn } from "@/lib/cn";

export interface RadioOption {
  value: string;
  label: string;
  hint?: string;
}

export function RadioGroup({
  legend,
  options,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadioPrimitive.Root> & {
  legend: string;
  options: readonly RadioOption[];
}) {
  const groupId = useId();
  return (
    <fieldset className={cn("flex flex-col gap-3", className)}>
      <legend className="font-sans text-sm font-medium text-ink mb-1">{legend}</legend>
      <RadioPrimitive.Root className="flex flex-col gap-2.5" {...props}>
        {options.map((opt) => {
          const id = `${groupId}-${opt.value}`;
          const hintId = `${id}-hint`;
          return (
            <div key={opt.value} className="flex gap-2.5">
              <RadioPrimitive.Item
                id={id}
                value={opt.value}
                aria-describedby={opt.hint ? hintId : undefined}
                className={cn(
                  "peer mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full",
                  "border border-line-strong bg-card",
                  "transition-colors duration-(--duration-micro) ease-(--ease-out-expo)",
                  "hover:border-ink-3",
                  "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                <RadioPrimitive.Indicator className="block size-1.5 rounded-full bg-card" />
              </RadioPrimitive.Item>
              <div className="flex flex-col gap-0.5">
                <LabelPrimitive.Root
                  htmlFor={id}
                  className="font-sans text-sm leading-[1.45] text-ink select-none peer-disabled:opacity-50"
                >
                  {opt.label}
                </LabelPrimitive.Root>
                {opt.hint ? (
                  <p id={hintId} className="font-sans text-xs leading-[1.5] text-ink-3">
                    {opt.hint}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </RadioPrimitive.Root>
    </fieldset>
  );
}
