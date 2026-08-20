"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { formatRemaining } from "@/lib/format";

/**
 * The perpetual SLA tick.
 *
 * Transparency is one of the three pillars, and this is the component that
 * makes it literal: a customer can see exactly how long we have left. Which
 * means it has to be honest about three things.
 *
 * 1. It counts against a real deadline passed in as an absolute timestamp, not
 *    a duration captured at mount. A tab left open overnight must not show a
 *    clock that is eight hours wrong.
 * 2. It renders nothing until after hydration. The server and the client cannot
 *    agree on `Date.now()`, and a mismatch here is a hydration error on the
 *    highest-traffic component on the site.
 * 3. It stops at zero and says so. A negative countdown reads as a bug; a
 *    breached SLA is something we own out loud.
 */
export function SlaClock({
  deadline,
  className,
  label = "SLA remaining",
}: {
  /** Absolute ISO timestamp or epoch ms. */
  deadline: string | number;
  className?: string;
  label?: string;
}) {
  const target = useRef(new Date(deadline).getTime()).current;
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(target - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [target]);

  // Pre-hydration: reserve the exact width so nothing shifts when it arrives.
  if (remaining === null) {
    return (
      <span
        data-numeric
        aria-hidden="true"
        className={cn("font-mono text-sm tabular-nums opacity-0", className)}
      >
        00:00:00
      </span>
    );
  }

  const breached = remaining <= 0;
  // Under an hour is the point where a countdown stops being ambient and starts
  // being information, so that is where it earns colour.
  const urgent = !breached && remaining < 60 * 60 * 1000;

  const tone = breached || urgent ? "text-urgent" : "text-ink-2";

  return (
    <span
      data-numeric
      className={cn("inline-flex items-baseline gap-1.5 font-mono text-sm tabular-nums", tone, className)}
    >
      <span className="sr-only">{breached ? "SLA breached" : label}: </span>
      {breached ? (
        <span className="font-medium uppercase tracking-[0.08em] text-xs">Overdue</span>
      ) : (
        <>
          <span className="font-medium">{formatRemaining(remaining)}</span>
          {/*
            No opacity here. Dimming text with opacity composites it against
            whatever is behind it, so a colour that passes contrast on its own
            quietly fails once it is set to 70% — this was 4.05:1 against the
            card, below the 4.5:1 that 12px text needs, and the palette check
            cannot see it because the palette is fine. It is the same mistake
            the disabled button state made.

            The hierarchy this was reaching for is already carried by size and
            weight: the countdown is font-medium at text-sm, this is text-xs.
          */}
          <span className="text-xs uppercase tracking-[0.1em]" aria-hidden="true">
            left
          </span>
        </>
      )}
    </span>
  );
}
