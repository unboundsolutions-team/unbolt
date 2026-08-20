import Link from "next/link";

import { Magnetic } from "@/components/motion/magnetic";
import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { PLANS } from "@/content/site";
import { cn } from "@/lib/cn";
import { formatPrice, sizeLabel, type PublicPlan } from "@/server/billing/plans";

/**
 * The plan cards.
 *
 * Numbers come from the database rows passed in; copy comes from
 * `PLANS` in src/content/site.ts, matched by slug ↔ code. That split is the
 * point: an admin editing a price or a task count changes the site, and nobody
 * has to remember that the marketing copy also hardcoded it.
 *
 * A plan present in the database but with no copy still renders — with its real
 * numbers and no feature bullets. Hiding it would mean an admin creates a plan,
 * sees nothing on the pricing page, and has no idea why.
 *
 * ── Why the heading level is a prop ─────────────────────────────────
 * It depends on where this sits in the document, which only the page knows. On
 * the homepage these cards live under a section h2, so h3 is right. On
 * /pricing they follow the hero h1 directly, and a hardcoded h3 skipped a level
 * — which is how somebody navigating by heading loses their place, and is what
 * the Lighthouse accessibility budget caught the first time it was ever run.
 *
 * Visual size is unchanged either way: heading level is document structure, not
 * typography.
 */
export function PlanCards({
  plans,
  headingLevel = 3,
}: {
  plans: readonly PublicPlan[];
  headingLevel?: 2 | 3;
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3";
  return (
    // [&>*]:min-w-0 is load-bearing. Grid items default to min-width:auto, so
    // the price at display size ("$1,499" has a ~356px min-content width) would
    // otherwise force the column wider than a phone and pan the whole page.
    <div className="mt-14 grid gap-px border border-line bg-line [&>*]:min-w-0 lg:grid-cols-3">
      {plans.map((plan, i) => {
        const copy = PLANS.find((p) => p.slug === plan.code);
        const featured = copy?.featured ?? false;

        return (
          <Reveal key={plan.id} delay={i * 0.08}>
            <div
              className={cn(
                "flex h-full min-w-0 flex-col p-8",
                featured ? "relative bg-raised pt-12" : "bg-base",
              )}
            >
              {featured ? (
                <span className="absolute inset-x-0 top-0 bg-accent py-1.5 text-center font-mono text-[0.62rem] uppercase tracking-[0.18em] text-accent-ink">
                  Most picked
                </span>
              ) : null}

              <Heading className="font-display text-2xl font-extrabold tracking-[-0.035em] text-ink">
                {copy?.name ?? plan.name}
              </Heading>
              <p className="mt-1.5 font-mono text-xs uppercase tracking-[0.12em] text-ink-3">
                {sizeLabel(plan.maxTaskHours)}
              </p>

              {/*
                A div rather than a p, and not to quieten a checker.

                axe's p-as-heading flags a large bold <p> at the top of a block,
                because that is how pages fake headings and break heading
                navigation. The concern does not apply here — the plan name
                immediately above is a real heading — and promoting the price to
                one would put "$799 one-off" into the document outline, which is
                actively worse to navigate.

                <p> means a paragraph of prose. This is a value and its unit.
              */}
              <div className="mt-7 font-display text-4xl font-extrabold tracking-[-0.05em] text-ink sm:text-5xl">
                <span data-numeric>{formatPrice(plan.priceCents, plan.currency)}</span>
                {/* Not "/mo". A pack is bought once, and pricing it per month
                    would be the same false promise the old copy made. */}
                <span className="ml-1.5 font-mono text-sm font-normal tracking-normal text-ink-3">
                  one-off
                </span>
              </div>

              <p className="mt-3 font-sans text-sm text-ink-2">
                <span data-numeric className="font-medium text-ink">
                  {plan.taskAllowance}
                </span>{" "}
                {plan.taskAllowance === 1 ? "task" : "tasks"}, yours until you use them
              </p>

              <ul className="mt-7 flex flex-1 flex-col gap-2.5 text-sm text-ink-2">
                {(copy?.features ?? []).map((f) => (
                  <li key={f} className="relative pl-5">
                    <span aria-hidden="true" className="absolute left-0 text-accent">
                      →
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <Magnetic>
                  <Button asChild variant={featured ? "primary" : "secondary"} size="lg" block>
                    {/* Every plan routes to a conversation. Self-serve checkout
                        is deliberately not wired: the team qualifies the work
                        and recommends a plan before money changes hands. */}
                    <Link href={`/contact?plan=${plan.code}`}>
                      {copy?.cta ?? `Talk to us about ${plan.name}`}
                    </Link>
                  </Button>
                </Magnetic>
              </div>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}
