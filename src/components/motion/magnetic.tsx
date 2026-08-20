"use client";

import { useRef } from "react";
import type { ReactElement, RefObject } from "react";
import { cloneElement } from "react";

/**
 * Pulls its child toward the cursor. Pointer events only, so it is inert on
 * touch and disabled entirely under prefers-reduced-motion — the control still
 * works exactly the same either way, because this only ever moves the box.
 */
export function Magnetic({
  children,
  strength = 0.28,
}: {
  children: ReactElement<{
    ref?: RefObject<HTMLElement | null>;
    onPointerMove?: (e: React.PointerEvent) => void;
    onPointerLeave?: () => void;
  }>;
  strength?: number;
}) {
  const ref = useRef<HTMLElement>(null);

  const onPointerMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left - r.width / 2) * strength;
    const y = (e.clientY - r.top - r.height / 2) * strength * 1.35;
    el.style.transform = `translate(${x}px, ${y}px)`;
  };

  const onPointerLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = "";
  };

  return cloneElement(children, { ref, onPointerMove, onPointerLeave });
}
