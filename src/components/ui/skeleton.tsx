import { cn } from "@/lib/cn";

/**
 * Loading placeholder. Animates opacity only, so it costs nothing in layout and
 * disappears entirely under prefers-reduced-motion.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "bg-inset rounded-(--radius-sm)",
        "motion-safe:animate-[pulse-soft_1.6s_var(--ease-in-out-soft)_infinite]",
        className,
      )}
    />
  );
}
