import { LeadStageForm } from "@/components/admin/lead-stage-form";
import { Text } from "@/components/ui/text";
import { leads } from "@/server/admin-queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Leads" };

/**
 * The funnel.
 *
 * Self-serve checkout is not wired, so every customer starts here. That makes
 * an unworked lead the most expensive object in the system — it is somebody who
 * has already decided to spend money and is waiting to be called back.
 */
export default async function AdminLeadsPage() {
  const list = await leads();
  const open = list.filter((l) => l.stage !== "won" && l.stage !== "lost");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Text variant="eyebrow">Leads</Text>
          <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] text-ink">
            People waiting to hear back
          </h1>
        </div>
        <p data-numeric className="font-mono text-xs text-ink-3">
          <span className="font-medium text-ink">{open.length}</span> open
        </p>
      </div>

      {list.length === 0 ? (
        <p className="mt-10 rounded-(--radius-lg) border border-dashed border-line bg-raised px-6 py-12 text-center font-sans text-sm text-ink-2">
          No enquiries yet.
        </p>
      ) : (
        <ul className="mt-10 flex flex-col gap-4">
          {list.map((lead) => (
            <li
              key={lead.id}
              className="min-w-0 rounded-(--radius-lg) border border-line bg-raised p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-sans text-sm font-medium text-ink">
                    {lead.name}
                    {lead.company ? (
                      <span className="font-normal text-ink-2"> · {lead.company}</span>
                    ) : null}
                  </p>
                  <p className="mt-1 truncate font-mono text-xs text-ink-3">
                    {lead.email}
                    {lead.storeUrl ? ` · ${lead.storeUrl}` : ""}
                  </p>
                  <p className="mt-2 font-mono text-xs text-ink-2">
                    {lead.planName ? `Interested in ${lead.planName}` : "No plan picked"}
                    {lead.wantsDemo ? " · wants a walkthrough" : ""}
                    {lead.convertedOrganizationId ? " · converted" : ""}
                  </p>
                </div>

                <LeadStageForm leadId={lead.id} stage={lead.stage} />
              </div>

              {lead.message ? (
                <p className="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-pretty font-sans text-sm leading-[1.6] text-ink-2">
                  {lead.message}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
