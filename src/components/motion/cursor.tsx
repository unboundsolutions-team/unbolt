"use client";

import { useEffect, useRef } from "react";

/**
 * The trailing cursor dot.
 *
 * Follows the pointer on a lerp so it lags slightly behind, and swells when it
 * is over anything interactive. `mix-blend-mode: difference` means it inverts
 * whatever it crosses, so it stays visible over the near-black canvas, over the
 * accent-filled buttons and over the queue board without needing a second
 * colour.
 *
 * Three deliberate constraints:
 *
 *  1. **The native cursor stays visible.** Most award sites set `cursor: none`.
 *     We do not — hiding the system cursor breaks pointer-precision for anyone
 *     relying on OS cursor settings (size, colour, trails), and this element is
 *     decoration. It rides alongside the real one.
 *  2. **Off entirely for coarse pointers and reduced motion.** There is no
 *     cursor to follow on a touchscreen, and a lerping dot is exactly the sort
 *     of ambient movement `prefers-reduced-motion` is asking us to stop.
 *  3. **Hover detection is delegated**, not a static NodeList. The preview
 *     bound listeners to every element once at load; in the app, client-side
 *     navigation swaps the tree constantly, so we listen on the document and
 *     resolve with `closest()`. Nothing goes stale.
 */
const INTERACTIVE = 'a,button,[role="button"],summary,input,select,textarea,[data-cursor]';

export function Cursor() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dot = ref.current;
    if (!dot) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let cx = x;
    let cy = y;
    let raf = 0;
    let shown = false;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x = e.clientX;
      y = e.clientY;
      if (!shown) {
        shown = true;
        dot.dataset["visible"] = "true";
      }
    };

    const onOver = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.(INTERACTIVE)) dot.dataset["big"] = "true";
    };

    const onOut = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const next = e.relatedTarget as Element | null;
      if (target?.closest?.(INTERACTIVE) && !next?.closest?.(INTERACTIVE)) {
        delete dot.dataset["big"];
      }
    };

    // Leaving the window entirely should hide it, or it parks at the edge.
    const onLeave = () => {
      shown = false;
      delete dot.dataset["visible"];
    };

    const loop = () => {
      cx += (x - cx) * 0.18;
      cy += (y - cy) * 0.18;
      dot.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointerout", onOut, { passive: true });
    document.addEventListener("pointerleave", onLeave, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-cursor-dot=""
      className={[
        "pointer-events-none fixed left-0 top-0 z-[300] rounded-full bg-accent",
        "opacity-0 mix-blend-difference",
        "size-2.5 -ml-[5px] -mt-[5px]",
        "transition-[width,height,margin,opacity] duration-(--duration-base) ease-(--ease-out-expo)",
        "data-[visible]:opacity-100",
        "data-[big]:size-13 data-[big]:-ml-[26px] data-[big]:-mt-[26px]",
        // Never render on touch — the media query is the belt to the JS braces.
        "max-[1px]:hidden",
      ].join(" ")}
    />
  );
}
