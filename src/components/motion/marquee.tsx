import { cn } from "@/lib/cn";

/**
 * Infinite ticker. The list is rendered twice so the translate loop is seamless;
 * the duplicate is aria-hidden so a screen reader hears each item once.
 * Stops entirely under prefers-reduced-motion (globals.css).
 */
export function Marquee({
  items,
  className,
  duration = "30s",
  glyph = "✺",
}: {
  items: readonly string[];
  className?: string;
  duration?: string;
  glyph?: string;
}) {
  const row = (hidden: boolean) => (
    <div aria-hidden={hidden || undefined}>
      {items.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="flex items-center gap-(--mq-gap) font-mono text-xs uppercase tracking-[0.2em] text-ink-3"
        >
          {item}
          <span aria-hidden="true" className="text-accent">
            {glyph}
          </span>
        </span>
      ))}
    </div>
  );

  return (
    <div
      className={cn("u-marquee border-y border-line bg-raised py-4", className)}
      style={{ ["--mq-duration" as string]: duration, ["--mq-gap" as string]: "2.4rem" }}
    >
      {row(false)}
      {row(true)}
    </div>
  );
}
