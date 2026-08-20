import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { SiteShell } from "@/components/layout/site-shell";
import { Button } from "@/components/ui/button";
import { NAV } from "@/content/site";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

/**
 * The 404.
 *
 * ── Why it is not a joke and not a dead end ─────────────────────────
 * Next's default 404 is an unstyled line of text on a white page, which on a
 * dark site reads as "this is broken" rather than "this address is wrong". The
 * people who see it are mostly arriving from a stale link or a typo in a URL
 * someone read out, so the useful thing is the shortest route to what they were
 * probably looking for — not an apology and not a witticism.
 *
 * `robots: noindex` because a soft 404 in the index is worse than none.
 */
export default function NotFound() {
  return (
    <SiteShell>
      <section className="flex min-h-[70vh] items-center py-32">
        <Container>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-3">Error 404</p>

          <h1 className="mt-5 max-w-[16ch] font-display text-4xl font-extrabold leading-[1] tracking-[-0.04em] text-ink sm:text-6xl">
            That page isn&rsquo;t here.
          </h1>

          <p className="mt-6 max-w-[46ch] text-pretty font-sans text-base leading-[1.6] text-ink-2">
            The link may be out of date, or the address may have a typo in it. Nothing is broken on
            our side.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href="/">Back to the start</Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link href="/contact">Tell us what you were after</Link>
            </Button>
          </div>

          <nav aria-label="Main pages" className="mt-14 border-t border-line pt-8">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-3">
              Or try one of these
            </p>
            <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="font-sans text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Container>
      </section>
    </SiteShell>
  );
}
