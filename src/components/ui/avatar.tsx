import { cn } from "@/lib/cn";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * Initials only. Avatar images are a per-user asset we do not control the
 * dimensions of, and a broken one on a paper canvas is very visible; the
 * initial fallback is the default rather than the error state.
 */
export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        "bg-accent-soft text-accent border border-accent/15",
        "font-mono font-medium leading-none select-none",
        size === "sm" && "size-6 text-[10px]",
        size === "md" && "size-8 text-xs",
        size === "lg" && "size-11 text-sm",
        className,
      )}
    >
      <span aria-hidden="true">{initialsOf(name)}</span>
      <span className="sr-only">{name}</span>
    </span>
  );
}
