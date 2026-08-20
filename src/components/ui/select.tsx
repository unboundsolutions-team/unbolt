"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import * as SelectPrimitive from "@radix-ui/react-select";
import { useId } from "react";

import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

const contentMotion =
  "u-pop z-50 overflow-hidden rounded-(--radius-md) border border-line bg-card shadow-lg";

export function Select({
  label,
  options,
  placeholder = "Select…",
  hint,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root> & {
  label: string;
  options: readonly SelectOption[];
  placeholder?: string;
  hint?: string;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <LabelPrimitive.Root htmlFor={id} className="font-sans text-sm font-medium text-ink">
        {label}
      </LabelPrimitive.Root>
      <SelectPrimitive.Root {...props}>
        <SelectPrimitive.Trigger
          id={id}
          aria-describedby={hint ? hintId : undefined}
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 px-3",
            "bg-card text-ink font-sans text-sm text-left",
            "border border-line-strong rounded-(--radius-md)",
            "transition-[border-color,background-color] duration-(--duration-fast) ease-(--ease-out-expo)",
            "hover:border-ink-3 data-[state=open]:border-accent data-[state=open]:bg-card",
            "data-[placeholder]:text-ink-3",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon className="text-ink-3">
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
              <path
                d="m3 4.5 3 3 3-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content position="popper" sideOffset={6} className={contentMotion}>
            <SelectPrimitive.Viewport className="p-1 min-w-(--radix-select-trigger-width)">
              {options.map((opt) => (
                <SelectPrimitive.Item
                  key={opt.value}
                  value={opt.value}
                  className={cn(
                    "relative flex cursor-default select-none items-center",
                    "rounded-(--radius-sm) py-2 pl-3 pr-8 font-sans text-sm text-ink outline-none",
                    "data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent",
                    "data-[state=checked]:font-medium",
                    "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
                  )}
                >
                  <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="absolute right-2.5 text-accent">
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
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {hint ? (
        <p id={hintId} className="font-sans text-xs leading-[1.5] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
