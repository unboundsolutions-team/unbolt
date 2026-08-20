import Link from "next/link";

import { cn } from "@/lib/cn";
import { formatRef } from "@/lib/format";

import { SlaClock } from "./sla-clock";
import { StatusPill, type TaskState } from "./status";

export interface Task {
  id: string;
  /** Human-facing ticket reference, e.g. `UNB-241`. */
  ref: string;
  /**
   * Written from the buyer's side. "Variant swatches drop selection on mobile
   * Safari" — not "Bug fix #1". This is the rule from the brief and it is the
   * single most visible difference between our board and the competitor's.
   */
  title: string;
  state: TaskState;
  store?: string;
  /** Absolute ISO timestamp. Only meaningful while the task is open. */
  slaDeadline?: string;
  shippedAt?: string;
}

/**
 * A task on the board.
 *
 * `href` is optional because this renders in two places with different rules:
 * the marketing hero shows a scripted board that must not link anywhere, and
 * the portal board links to the real task. Making the link opt-in means the
 * public page cannot accidentally offer a route into the product.
 */
export function TaskCard({
  task,
  href,
  className,
}: {
  task: Task;
  href?: string | undefined;
  className?: string;
}) {
  const card = (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-(--radius-md) border border-line bg-card p-3.5",
        "transition-[transform,border-color] duration-(--duration-base) ease-(--ease-out-expo)",
        "hover:border-accent motion-safe:hover:-translate-y-0.5",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <span
          data-numeric
          className="shrink-0 whitespace-nowrap font-mono text-xs font-medium tracking-[0.06em] text-ink-3"
        >
          {formatRef(task.ref)}
        </span>
        <StatusPill state={task.state} />
      </header>

      <h3 className="text-pretty font-sans text-sm font-medium leading-[1.45] text-ink">
        {task.title}
      </h3>

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2.5">
        {task.store ? (
          <span className="font-mono text-xs text-ink-3">{task.store}</span>
        ) : null}

        {task.state === "shipped" ? (
          <span className="ml-auto font-mono text-xs font-medium uppercase tracking-[0.08em] text-shipped">
            {task.shippedAt ?? "Shipped"}
          </span>
        ) : task.slaDeadline ? (
          <SlaClock deadline={task.slaDeadline} className="ml-auto" />
        ) : null}
      </footer>
    </article>
  );

  if (!href) return card;

  return (
    // The whole card is the target rather than the reference alone — a 12px
    // link is a poor tap target on the surface people use most on a phone.
    //
    // ── No aria-label here, deliberately ──────────────────────────
    // There was one: `UNB-001 — <title>`. An aria-label REPLACES the accessible
    // name rather than adding to it, so it deleted the status and the SLA
    // countdown from what a screen reader announced — the two things the card
    // exists to communicate. Sighted users saw "overdue"; nobody else did.
    //
    // It also failed WCAG 2.5.3 (Label in Name), because voice-control users
    // speak the text they can see and the name did not contain all of it.
    //
    // With no label the name is computed from the contents, which is exactly
    // the visible text: reference, status, title, store, clock. Slightly longer
    // to hear, and complete.
    <Link
      href={href}
      className="block rounded-(--radius-md) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {card}
    </Link>
  );
}
