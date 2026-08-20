import { cn } from "@/lib/cn";

/**
 * A hairline. Decorative by default — a divider that only separates should not
 * announce itself to a screen reader.
 */
export function Rule({
  className,
  orientation = "horizontal",
  semantic = false,
}: {
  className?: string;
  orientation?: "horizontal" | "vertical";
  semantic?: boolean;
}) {
  return (
    <div
      role={semantic ? "separator" : "presentation"}
      aria-orientation={semantic ? orientation : undefined}
      aria-hidden={semantic ? undefined : true}
      className={cn(
        "bg-line shrink-0",
        orientation === "horizontal" ? "h-px w-full" : "w-px self-stretch",
        className,
      )}
    />
  );
}
