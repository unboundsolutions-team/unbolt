"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { startRepurchaseAction } from "@/server/actions/repurchase";

/**
 * What a customer sees when the allowance is gone.
 *
 * ── Why this is a panel and not a disabled button ───────────────────
 * Running out of tasks is the single most important moment in this business
 * model: it is the one where the customer either buys again or drifts away. The
 * old behaviour was that the "new task" form simply refused, with an error
 * message, which tells somebody what they cannot do and not what they can.
 *
 * ── Why the button is not always here ───────────────────────────────
 * With Stripe unconfigured this offers the conversation instead, because that
 * is the real path today. An enabled-looking Buy button that fails on click is
 * worse than an honest link to Contact.
 */
export function OutOfTasks({
  planCode,
  planName,
  grantedTotal,
  canBuy,
  stripeEnabled,
}: {
  planCode: string | null;
  planName: string | null;
  /** Total ever granted. Zero means they have never had a pack at all. */
  grantedTotal: number;
  /** Whether this person's role can spend money. */
  canBuy: boolean;
  stripeEnabled: boolean;
}) {
  const [state, action, pending] = useActionState(startRepurchaseAction, null);

  const selfServeRaw = stripeEnabled && canBuy && planCode !== null;

  /*
   * "Never had a pack" is a different situation from "used the pack".
   *
   * Both have a zero balance, and treating them the same produced "You've used
   * all 0 tasks in your plan" on the first screen a self-registered account
   * ever sees — an error message about something they had not done. Under a
   * sales-led model this state is normal and expected: the account exists,
   * payment has not landed yet.
   */
  const neverPurchased = grantedTotal === 0;

  // Nothing to buy *again* if there was never a first purchase.
  const selfServe = selfServeRaw && !neverPurchased;

  return (
    <section
      aria-labelledby="out-of-tasks"
      className="mt-10 rounded-(--radius-lg) border border-urgent/40 bg-urgent/5 p-6 sm:p-8"
    >
      <h2
        id="out-of-tasks"
        className="font-display text-xl font-bold tracking-[-0.02em] text-ink"
      >
        {neverPurchased
          ? "This workspace doesn't have a pack yet."
          : "You've used every task in your pack."}
      </h2>
      <p className="mt-2 max-w-prose text-pretty font-sans text-sm leading-[1.6] text-ink-2">
        {/* No countdown, no "act now". Somebody who has already bought once
            needs the shortest route to buying again; somebody who never has
            needs to know nothing is broken. */}
        {neverPurchased
          ? "Everything here is ready — there are just no tasks on the account yet. We size the work on a short call and set the pack up from there."
          : "Nothing expires and nothing has been lost — work already delivered stays in your queue. To file something new, buy another pack or move up a plan."}
      </p>

      {state && !state.ok ? (
        <p role="alert" className="mt-4 font-sans text-sm text-urgent">
          {state.error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {selfServe ? (
          <form action={action}>
            <input type="hidden" name="plan" value={planCode} />
            <Button type="submit" variant="primary" loading={pending}>
              {planName ? `Buy another ${planName} pack` : "Buy another pack"}
            </Button>
          </form>
        ) : null}

        <Button asChild variant={selfServe ? "ghost" : "primary"}>
          <a href={neverPurchased ? "/contact?intent=start" : "/contact?intent=upgrade"}>
            {neverPurchased
              ? "Talk to us about getting started"
              : selfServe
                ? "Or talk about moving up a plan"
                : "Talk to us about another pack"}
          </a>
        </Button>
      </div>

      {!canBuy ? (
        <p className="mt-4 font-mono text-xs text-ink-3">
          Your role can&rsquo;t make purchases — ask an owner in your workspace.
        </p>
      ) : null}
    </section>
  );
}
