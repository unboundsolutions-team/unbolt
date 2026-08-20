"use client";

import { m } from "motion/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Scroll-triggered reveal. `once` by default: content that re-animates every
 * time it re-enters the viewport is a distraction on a page someone is trying
 * to read.
 *
 * Only opacity and transform animate — nothing here can trigger layout.
 *
 * ── Why the failsafe attribute ──────────────────────────────────────
 * The server renders this with `opacity: 0` inline, because that is the initial
 * state of the animation. If the JavaScript that animates it back to 1 never
 * runs, the content stays at zero forever. Measured on a real build with
 * scripts off, /how-it-works painted 190 characters out of 2,637: the page is
 * there, correct, indexable, and completely invisible.
 *
 * That is the same shape of failure as the preloader — a decorative effect able
 * to take the page down on its own — and it is worse here, because it is every
 * block of copy on every marketing page rather than one overlay.
 *
 * `data-anim-pending` is present in the server HTML and removed on mount. A CSS
 * animation hangs off it (see globals.css) that forces the final state after a
 * few seconds. Because mounting removes the attribute, the failsafe is
 * cancelled before it can fire on any page where scripts work — so it never
 * competes with the real animation, and it cannot spoil a reveal below the
 * fold.
 *
 * ── Why reduced motion is decided in CSS ────────────────────────────
 * `useReducedMotion()` returns nothing useful on the server, so branching on it
 * during render made the server and client produce different trees — a
 * hydration mismatch on every page. The media query says the same thing to both
 * of them, and matches how SplitText already does it.
 */
export function Reveal({
  children,
  delay = 0,
  distance = 22,
  className,
}: {
  children: ReactNode;
  delay?: number;
  distance?: number;
  className?: string;
}) {
  const [pending, setPending] = useState(true);

  // Runs on mount, long before the failsafe's delay. Starting at `true` on both
  // sides keeps the server and client markup identical.
  useEffect(() => setPending(false), []);

  return (
    <m.div
      data-reveal
      {...(pending ? { "data-anim-pending": "" } : {})}
      className={cn(className)}
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-8% 0px -12% 0px" }}
      transition={{ duration: 0.75, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </m.div>
  );
}
