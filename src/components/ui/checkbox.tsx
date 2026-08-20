"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as LabelPrimitive from "@radix-ui/react-label";
import { useId } from "react";

import { cn } from "@/lib/cn";

export interface CheckboxProps
  extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  label: string;
  hint?: string;
}

export function Checkbox({ label, hint, className, ...props }: CheckboxProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex gap-2.5">
      <CheckboxPrimitive.Root
        id={id}
        aria-describedby={hint ? hintId : undefined}
        className={cn(
          "peer mt-0.5 grid size-[18px] shrink-0 place-items-center",
          "rounded-(--radius-sm) border border-line-strong bg-card",
          "transition-[background-color,border-color] duration-(--duration-micro) ease-(--ease-out-expo)",
          "hover:border-ink-3",
          "data-[state=checked]:bg-accent data-[state=checked]:border-accent",
          "data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator className="text-accent-ink">
          {props.checked === "indeterminate" ? (
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
              <path d="M2.5 6h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
              <path
                d="M2 6.2 4.7 9 10 3.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>

      <div className="flex flex-col gap-0.5">
        <LabelPrimitive.Root
          htmlFor={id}
          className="font-sans text-sm leading-[1.45] text-ink select-none peer-disabled:opacity-50"
        >
          {label}
        </LabelPrimitive.Root>
        {hint ? (
          <p id={hintId} className="font-sans text-xs leading-[1.5] text-ink-3">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
