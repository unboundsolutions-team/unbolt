"use client";

import { useEffect, useRef } from "react";

/**
 * Accent hairline across the top of the viewport showing scroll depth.
 *
 * Written to the DOM via a ref inside rAF rather than React state — this fires
 * on every scroll frame, and re-rendering a component 60 times a second to move
 * one line is exactly the kind of thing that eats the blocking-time budget.
 *
 * Purely decorative: it duplicates information the scrollbar already carries,
 * so it is aria-hidden and disappears under prefers-reduced-motion.
 */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let queued = false;

    const write = () => {
      queued = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.transform = `scaleX(${ratio})`;
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      raf = requestAnimationFrame(write);
    };

    write();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-scroll-progress=""
      className="pointer-events-none fixed inset-x-0 top-0 z-[120] h-0.5 origin-left scale-x-0 bg-accent"
    />
  );
}
