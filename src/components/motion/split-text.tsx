"use client";

import { useEffect, useRef, useState } from "react";
import type { ElementType } from "react";

import { cn } from "@/lib/cn";

/**
 * Headline that rises out of a mask, word by word.
 *
 * Each word gets its own clipping box so characters appear from behind an edge
 * rather than fading in place — the difference between "animated" and "made".
 *
 * The text is split in the DOM, so the accessible name would become a pile of
 * spans. `aria-label` restores the original string and the split spans are
 * hidden from the a11y tree, which means a screen reader hears one heading.
 */
export function SplitText({
  text,
  as: Comp = "h2",
  className,
  delay = 0,
  stagger = 0.045,
  /** Play immediately (hero) instead of waiting for the viewport. */
  immediate = false,
}: {
  text: string;
  as?: ElementType;
  className?: string;
  delay?: number;
  stagger?: number;
  immediate?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const [lit, setLit] = useState(false);
  // Present in the server HTML, removed on mount. See the failsafe note in
  // reveal.tsx: without it, every heading on the site is translated out of an
  // overflow-hidden box and stays there if the script never runs.
  const [pending, setPending] = useState(true);

  useEffect(() => setPending(false), []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLit(true);
      return;
    }
    if (immediate) {
      const t = window.setTimeout(() => setLit(true), 60);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setLit(true);
          io.disconnect();
        }
      },
      { rootMargin: "-8% 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [immediate]);

  const words = text.split(" ");

  return (
    <Comp
      ref={ref}
      aria-label={text}
      {...(pending ? { "data-anim-pending": "" } : {})}
      className={cn(lit && "u-split-lit", className)}
    >
      {words.map((word, i) => (
        <span key={`${word}-${i}`} aria-hidden="true">
          <span className="u-split-word">
            <span
              className="u-split-inner"
              style={{ transitionDelay: `${delay + i * stagger}s` }}
            >
              {word}
            </span>
          </span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </Comp>
  );
}
