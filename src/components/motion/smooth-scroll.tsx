"use client";

import Lenis from "lenis";
import { useEffect } from "react";

/**
 * Lenis smooth scroll.
 *
 * Two things it must not break:
 *  - prefers-reduced-motion. Smoothing hijacks the scroll the OS promised the
 *    user, so when they've asked for less motion we do not initialise at all.
 *  - Touch. Native momentum scrolling on a phone is better than anything we can
 *    synthesise, and overriding it makes the page feel broken.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const lenis = new Lenis({
      duration: 1.05,
      easing: (t: number) => Math.min(1, 1.001 - 2 ** (-10 * t)),
      smoothWheel: true,
      syncTouch: false,
    });

    let frame = requestAnimationFrame(function raf(time: number) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    });

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return null;
}
