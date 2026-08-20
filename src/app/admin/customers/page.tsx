import {
  CustomerAdminPanel,
  MarkPaidForm,
  ProvisionCustomerForm,
} from "@/components/admin/customer-controls";
import { Text } from "@/components/ui/text";
import { customers, pendingPurchases } from "@/server/admin-queries";
import { allPlans, formatPrice } from "@/server/billing/plans";

export const dynamic = "force-dynamic";

export const metadata = { title: "Customers" };

export default async function AdminCustomersPage() {
  const [list, pending, plans] = await Promise.all([
    customers(),
    pendingPurchases(),
    allPlans(),
  ]);

  const sellable = plans
    .filter((p) => p.isActive)
    .map((p) => ({ code: p.code, name: p.name, taskAllowance: p.taskAllowance }));

  return (
    <>
      <Text variant="eyebrow">Customers</Text>
      <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] text-ink">
        Accounts and allowances
      </h1>

      {/* Money waiting to be confirmed sits at the top, because it is the one
          thing here that is actively blocking a customer from working. */}
      {pending.length > 0 ? (
        <section className="mt-8 rounded-(--radius-lg) border border-urgent/40 bg-urgent/5 p-5">
          <h2 className="font-sans text-sm font-medium text-ink">
            Awaiting payment ({pending.length})
          </h2>
          <p className="mt-1.5 font-sans text-sm text-ink-2">
            These accounts exist but have no task credits. Confirming the payment releases
            the pack.
          </p>
          <ul className="mt-4 flex flex-col gap-4">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-sans text-sm text-ink">{p.organizationName}</p>
                  <p className="mt-1 font-mono text-xs text-ink-3">
                    {p.planName} &middot; <span data-numeric>{p.tasksGranted}</span> tasks
                    &middot;{" "}
                    <span data-numeric>{formatPrice(p.priceCentsPaid, p.currency)}</span>
                  </p>
                </div>
                <MarkPaidForm purchaseId={p.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {list.length === 0 ? (
        <p className="mt-10 rounded-(--radius-lg) border border-dashed border-line bg-raised px-6 py-12 text-center font-sans text-sm text-ink-2">
          No customers yet. Create the first one below.
        </p>
      ) : (
        <ul className="mt-10 flex flex-col gap-4">
          {list.map((c) => (
            <li
              key={c.id}
              className="flex min-w-0 flex-wrap items-start justify-between gap-4 rounded-(--radius-lg) border border-line bg-raised p-5"
            >
              <div className="min-w-0">
                <p className="font-sans text-sm font-medium text-ink">{c.name}</p>
                <p className="mt-1 truncate font-mono text-xs text-ink-3">
                  {c.ownerEmail ?? "no owner"} &middot; {c.planName ?? "no plan"} &middot;{" "}
                  {c.status}
                </p>
                <p className="mt-2 font-mono text-xs text-ink-2">
                  <span
                    data-numeric
                    className={c.creditsRemaining === 0 ? "font-medium text-urgent" : "font-medium text-ink"}
                  >
                    {c.creditsRemaining}
                  </span>{" "}
                  credits left &middot; <span data-numeric>{c.creditsUsedTotal}</span> used of{" "}
                  <span data-numeric>{c.creditsGrantedTotal}</span> &middot;{" "}
                  <span data-numeric>{c.openTasks}</span> open
                </p>
              </div>

              <CustomerAdminPanel
                organizationId={c.id}
                plans={sellable}
                limits={{
                  concurrencyLimit: c.concurrencyLimit,
                  slaHours: c.slaHours,
                  maxTaskHours: c.maxTaskHours,
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <section className="mt-12 max-w-3xl rounded-(--radius-lg) border border-line bg-raised p-6">
        <Text variant="eyebrow">New customer</Text>
        <p className="mb-5 mt-2 max-w-prose font-sans text-sm text-ink-2">
          Creates the workspace, the owner login and a pending purchase. Credits are released
          separately, once the payment is confirmed.
        </p>
        <ProvisionCustomerForm plans={sellable} />
      </section>
    </>
  );
}
