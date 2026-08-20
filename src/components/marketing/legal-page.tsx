import type { ReactNode } from "react";

import { Container } from "@/components/layout/container";
import { SiteShell } from "@/components/layout/site-shell";
import { PageHero } from "@/components/marketing/page-hero";

/**
 * Shell for the legal and trust pages.
 *
 * ── The review gate ─────────────────────────────────────────────────
 * These documents were drafted from what the product actually does — what data
 * it holds, who processes it, what a customer is buying. They have not been
 * reviewed by a lawyer, and they carry the company's name and describe its
 * obligations to people who are paying it money.
 *
 * So `lastReviewed` is null until somebody qualified has read them, and while
 * it is null the page says so, in production, where it cannot be missed. The
 * notice disappears the moment a real review date is set. That is deliberately
 * the opposite of a comment nobody reads: shipping unreviewed terms should
 * require noticing.
 */
export function LegalPage({
  eyebrow,
  title,
  lede,
  lastReviewed,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  /** ISO date of the last legal review, or null if it has not had one. */
  lastReviewed: string | null;
  children: ReactNode;
}) {
  return (
    <SiteShell>
      <PageHero eyebrow={eyebrow} title={title} lede={lede} />

      <section className="py-16 sm:py-20">
        <Container>
          {lastReviewed === null ? (
            <div
              role="note"
              className="mb-12 rounded-(--radius-lg) border border-urgent/40 bg-urgent/5 p-6"
            >
              <h2 className="font-display text-lg font-bold tracking-[-0.02em] text-ink">
                Draft — not yet reviewed by a lawyer
              </h2>
              <p className="mt-2 max-w-prose text-pretty font-sans text-sm leading-[1.6] text-ink-2">
                This document describes how we actually operate, but it has not
                had legal review and is not a substitute for advice. If anything
                here matters to a decision you are making, please{" "}
                <a href="/contact" className="text-accent underline">
                  ask us
                </a>{" "}
                and we will answer directly.
              </p>
            </div>
          ) : (
            <p className="mb-12 font-mono text-xs uppercase tracking-[0.12em] text-ink-3">
              Last reviewed <time dateTime={lastReviewed}>{lastReviewed}</time>
            </p>
          )}

          {/*
            Constrained measure and generous leading: these are the only pages
            on the site somebody reads top to bottom, usually because something
            has gone wrong or they are about to spend money.
          */}
          <div className="max-w-[68ch] font-sans text-sm leading-[1.75] text-ink-2 [&_a]:text-accent [&_a]:underline [&_h2]:mb-3 [&_h2]:mt-12 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:tracking-[-0.03em] [&_h2]:text-ink [&_h2:first-child]:mt-0 [&_h3]:mb-2 [&_h3]:mt-8 [&_h3]:font-sans [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-ink [&_li]:mt-1.5 [&_p]:mt-4 [&_strong]:font-medium [&_strong]:text-ink [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-5">
            {children}
          </div>
        </Container>
      </section>
    </SiteShell>
  );
}
