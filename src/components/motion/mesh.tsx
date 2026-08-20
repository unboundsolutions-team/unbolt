"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

/**
 * The animated background field.
 *
 * A handful of drifting radial blobs composited additively under a CSS blur —
 * a cheap stand-in for a WebGL shader that costs one canvas and no library.
 *
 * Three things keep it honest against the performance budget:
 *  - colours are read from the theme tokens, so it follows a theme swap
 *  - it pauses entirely when scrolled out of view
 *  - it never starts under prefers-reduced-motion; a static frame is painted
 *    once so the composition still reads
 */
export function Mesh({
  className,
  count = 4,
  radius = 0.5,
  speed = 1,
}: {
  className?: string;
  count?: number;
  radius?: number;
  speed?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const styles = getComputedStyle(document.documentElement);
    const colors = [1, 2, 3, 4]
      .map((n) => styles.getPropertyValue(`--color-mesh-${n}`).trim())
      .filter(Boolean);
    if (colors.length === 0) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rate = reduced ? 0 : speed;

    let width = 0;
    let height = 0;
    let raf = 0;
    let visible = true;
    let t = 0;

    const blobs = Array.from({ length: count }, (_, i) => ({
      c: colors[i % colors.length] as string,
      x: 0.2 + ((i * 0.27) % 0.6),
      y: 0.25 + ((i * 0.41) % 0.5),
      r: radius * (0.75 + ((i * 0.19) % 0.5)),
      px: i * 1.7,
      py: i * 2.3,
      sx: 0.00022 + i * 0.00007,
      sy: 0.00019 + i * 0.00006,
    }));

    function resize() {
      if (!canvas || !ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      const max = Math.max(width, height);
      for (const b of blobs) {
        const x = (b.x + Math.sin(t * b.sx + b.px) * 0.26) * width;
        const y = (b.y + Math.cos(t * b.sy + b.py) * 0.24) * height;
        const rad = b.r * max;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, b.c);
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function loop(ts: number) {
      t = ts * rate;
      draw();
      if (visible) raf = requestAnimationFrame(loop);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? false;
        if (visible && rate > 0) raf = requestAnimationFrame(loop);
        else cancelAnimationFrame(raf);
      },
      { threshold: 0 },
    );
    io.observe(canvas);
    if (rate > 0) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [count, radius, speed]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 size-full blur-[80px]", className)}
    />
  );
}
