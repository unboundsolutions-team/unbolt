"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * Radix handles focus trapping, scroll locking, escape and the aria wiring.
 * A description is required rather than optional — a dialog with a title alone
 * gives a screen-reader user no idea what it is asking for.
 */
export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-ink/25 backdrop-blur-[2px]",
          "data-[state=open]:u-fade",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))]",
          "-translate-x-1/2 -translate-y-1/2",
          "rounded-(--radius-lg) border border-line bg-card shadow-lg",
          "motion-safe:animate-[dialog-in_var(--duration-base)_var(--ease-out-expo)]",
          "motion-safe:data-[state=closed]:animate-[dialog-out_var(--duration-fast)_var(--ease-out-soft)]",
          className,
        )}
      >
        <div className="flex flex-col gap-1.5 p-5 pb-3">
          <DialogPrimitive.Title className="font-display text-xl leading-tight tracking-[-0.012em] text-ink">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="font-sans text-sm leading-[1.55] text-ink-2">
            {description}
          </DialogPrimitive.Description>
        </div>

        {children ? <div className="px-5 pb-4">{children}</div> : null}

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
            {footer}
          </div>
        ) : null}

        <DialogPrimitive.Close
          aria-label="Close"
          className={cn(
            "absolute right-3.5 top-3.5 grid size-7 place-items-center",
            "rounded-(--radius-sm) text-ink-3",
            "transition-colors duration-(--duration-micro) ease-(--ease-out-expo)",
            "hover:bg-inset hover:text-ink",
          )}
        >
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
            <path
              d="m3 3 6 6M9 3l-6 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
