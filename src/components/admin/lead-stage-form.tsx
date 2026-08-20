"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { updateLeadStageAction } from "@/server/actions/admin";
import type { ActionResult } from "@/server/actions/tasks";

const STAGES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "demo_booked", label: "Demo booked" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
] as const;

/**
 * Move a lead along.
 *
 * A native select and a submit button rather than an auto-saving dropdown: an
 * accidental change to a pipeline stage is silent and hard to notice, and
 * "Won" in particular is a claim someone will later report on.
 */
export function LeadStageForm({ leadId, stage }: { leadId: string; stage: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    updateLeadStageAction,
    null,
  );

  return (
    <form action={formAction} className="flex shrink-0 items-center gap-2">
      <input type="hidden" name="leadId" value={leadId} />
      <label className="sr-only" htmlFor={`stage-${leadId}`}>
        Stage
      </label>
      <select
        id={`stage-${leadId}`}
        name="stage"
        defaultValue={stage}
        className="h-9 rounded-(--radius-md) border border-line-strong bg-card px-2.5 font-mono text-xs text-ink"
      >
        {STAGES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        Update
      </Button>
      {state?.ok === false ? (
        <span role="alert" className="font-mono text-xs text-urgent">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
