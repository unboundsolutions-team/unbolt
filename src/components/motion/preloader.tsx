"use client";

import { useEffect, useState } from "react";

/**
 * Entry counter.
 *
 * This is the single biggest cost in the motion budget, so it earns its place
 * carefully:
 *  - it never blocks content; the page is fully rendered underneath and the
 *    overlay is removed from the DOM once done
 *  - it runs ONCE per session (sessionStorage), so internal navigation and a
 *    returning visitor never wait again
 *  - it does not run at all under prefers-reduced-motion
 *  - it is aria-hidden and does not trap focus
 *  - **it clears itself in CSS as well as in JS.** It is server-rendered as an
 *    opaque full-screen cover, so without a failsafe any JavaScript failure —
 *    a blocked chunk, a hydration error, an extension — leaves a black screen
 *    with nothing clickable behind it. A decorative animation must not be able
 *    to take the site down. See @keyframes preloader-failsafe in globals.css.
 *
 * See §7 of the brief: this is why the Lighthouse budget is desktop-scoped.
 */
const SEEN_KEY = "unbolt:intro";

export function Preloader() {
  const [value, setValue] = useState(0);
  const [state, setState] = useState<"running" | "leaving" | "gone">("running");

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seen = sessionStorage.getItem(SEEN_KEY) === "1";
    if (reduced || seen) {
      setState("gone");
      return;
    }
    document.documentElement.style.overflow = "hidden";
    let v = 0;
    const id = window.setInterval(() => {
      v = Math.min(100, v + Math.random() * 13 + 5);
      setValue(Math.floor(v));
      if (v >= 100) {
        window.clearInterval(id);
        sessionStorage.setItem(SEEN_KEY, "1");
        window.setTimeout(() => setState("leaving"), 220);
        window.setTimeout(() => {
          document.documentElement.style.overflow = "";
          setState("gone");
        }, 1000);
      }
    }, 85);
    return () => {
      window.clearInterval(id);
      document.documentElement.style.overflow = "";
    };
  }, []);

  if (state === "gone") return null;

  return (
    <div
      aria-hidden="true"
      // Named so the failsafe can be tested for what it actually promises —
      // that this element stops covering the page even when no JavaScript runs.
      data-preloader
      className={[
        "fixed inset-0 z-[200] grid place-items-center bg-base",
        "transition-[opacity,visibility] duration-(--duration-slow) ease-(--ease-out-expo)",
        state === "leaving" ? "invisible opacity-0" : "visible opacity-100",
        // The CSS half of the failsafe. Fires at 6s and stays; JS normally
        // finishes in under two, so this only lands when JS did not.
        "motion-safe:animate-[preloader-failsafe_1ms_linear_6s_forwards]",
        "motion-reduce:animate-[preloader-failsafe_1ms_linear_0s_forwards]",
      ].join(" ")}
    >
      <div className="flex flex-col items-center">
        <span
          data-numeric
          className="font-display text-6xl font-extrabold tracking-[-0.05em] text-ink sm:text-[11rem]"
        >
          {String(value).padStart(3, "0")}
        </span>
        <span className="mt-5 h-px w-[min(38vw,320px)] overflow-hidden bg-line">
          <span
            className="block h-full origin-left bg-accent transition-transform duration-200 ease-linear"
            style={{ transform: `scaleX(${value / 100})` }}
          />
        </span>
      </div>
    </div>
  );
}
