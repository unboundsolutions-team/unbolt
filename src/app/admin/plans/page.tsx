import { PlanEditor } from "@/components/admin/plan-editor";
import { Text } from "@/components/ui/text";
import { allPlans, formatPrice, sizeLabel, slaLabel } from "@/server/billing/plans";

export const dynamic = "force-dynamic";

export const metadata = { title: "Plans" };

export default async function AdminPlansPage() {
  const plans = await allPlans();

  return (
    <>
      <Text variant="eyebrow">Plans</Text>
      <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] text-ink">
        What each pack buys
      </h1>
      <p className="mt-3 max-w-prose text-pretty font-sans text-sm leading-[1.6] text-ink-2">
        These rows are what the pricing page renders and what the product enforces. There is
        no second copy in the code — change a number here and both follow.
      </p>

      <div className="mt-10 flex flex-col gap-4">
        {plans.map((plan) => (
          <section
            key={plan.id}
            className="min-w-0 rounded-(--radius-lg) border border-line bg-raised p-5"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h2 className="font-display text-xl font-bold tracking-[-0.02em] text-ink">
                  {plan.name}{" "}
                  <span className="font-mono text-xs font-normal text-ink-3">{plan.code}</span>
                </h2>
                <p className="mt-1.5 font-mono text-xs text-ink-3">
                  <span data-numeric>{formatPrice(plan.priceCents, plan.currency)}</span> &middot;{" "}
                  <span data-numeric>{plan.taskAllowance}</span> tasks &middot;{" "}
                  <span data-numeric>{plan.concurrencyLimit}</span> at once &middot;{" "}
                  {sizeLabel(plan.maxTaskHours).toLowerCase()} &middot; {slaLabel(plan.slaHours)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {!plan.isActive ? (
                  <span className="rounded-full border border-line-strong px-2 py-0.5 font-mono text-xs text-ink-3">
                    Retired
                  </span>
                ) : null}
                {!plan.isPublic ? (
                  <span className="rounded-full border border-line-strong px-2 py-0.5 font-mono text-xs text-ink-3">
                    Hidden
                  </span>
                ) : null}
                <PlanEditor plan={plan} />
              </div>
            </header>
          </section>
        ))}
      </div>

      <section className="mt-12 max-w-3xl rounded-(--radius-lg) border border-line bg-raised p-6">
        <Text variant="eyebrow">Add a plan</Text>
        <PlanEditor />
      </section>
    </>
  );
}
