"use client";

import { LazyMotion, domAnimation } from "motion/react";
import type { ReactNode } from "react";

/**
 * Ships the reduced `domAnimation` feature set (~18kb smaller than the full
 * bundle) and loads it lazily. Components use `m.*` rather than `motion.*` so
 * the tree-shaken build is what actually reaches the browser — the performance
 * budget in lighthouserc.json is blocking, so this is not optional.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}
