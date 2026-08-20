import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/**
 * A caption is required. A data table without one is an unlabelled region, and
 * these tables carry the billing and task history a customer has to be able to
 * audit.
 */
export function Table({
  caption,
  captionVisible = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableElement> & { caption: string; captionVisible?: boolean }) {
  return (
    /* `contain: paint` stops this scroller's content from contributing to the
       document's scrollable region. Without it the table's intrinsic width
       propagates up and the whole page pans sideways on a phone, even though
       the table itself is correctly clipped here. */
    <div className="w-full max-w-full overflow-x-auto [contain:paint]">
      <table className={cn("w-full border-collapse text-left", className)} {...props}>
        <caption
          className={cn(
            captionVisible
              ? "mb-3 text-left font-sans text-sm text-ink-2"
              : "sr-only",
          )}
        >
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-line-strong px-3 py-2.5",
        "font-mono text-xs font-medium uppercase tracking-[0.1em] text-ink-3",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("border-b border-line px-3 py-3 font-sans text-sm text-ink-2", className)}
      {...props}
    />
  );
}

export function Tr({ className, children, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("transition-colors duration-(--duration-micro) hover:bg-card", className)}
      {...props}
    >
      {children as ReactNode}
    </tr>
  );
}
