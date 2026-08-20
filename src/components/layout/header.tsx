"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Magnetic } from "@/components/motion/magnetic";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { NAV, SITE } from "@/content/site";
import { cn } from "@/lib/cn";

/**
 * One flat row of links. The brief excludes mega-menus deliberately — the whole
 * IA is small enough to say out loud.
 *
 * The bar is transparent over the hero and gains a surface once you scroll past
 * it, so the hero reads full-bleed without the nav ever losing contrast.
 */
export function Header() {
  const pathname = usePathname();
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 py-4",
        "transition-[background-color,border-color,backdrop-filter] duration-(--duration-base) ease-(--ease-out-expo)",
        stuck
          ? "border-b border-line bg-base/85 backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <Container className="flex items-center justify-between gap-6">
        <Link
          href="/"
          className="font-display text-xl font-extrabold uppercase tracking-[-0.06em] text-ink"
        >
          {SITE.name}
        </Link>

        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-7">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative font-mono text-xs uppercase tracking-[0.14em]",
                      "transition-colors duration-(--duration-fast)",
                      "after:absolute after:inset-x-0 after:-bottom-1.5 after:h-px after:origin-right after:scale-x-0 after:bg-accent",
                      "after:transition-transform after:duration-(--duration-base) after:ease-(--ease-out-expo)",
                      "hover:after:origin-left hover:after:scale-x-100",
                      active ? "text-accent after:origin-left after:scale-x-100" : "text-ink-2 hover:text-ink",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/login">Sign in</Link>
          </Button>
          <Magnetic>
            <Button asChild variant="primary" size="sm">
              <Link href="/pricing">Start a plan</Link>
            </Button>
          </Magnetic>
        </div>
      </Container>
    </header>
  );
}
