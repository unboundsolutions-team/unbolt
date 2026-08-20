"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { savePlanAction } from "@/server/actions/admin";
import type { ActionResult } from "@/server/actions/tasks";
import type { PublicPlan } from "@/server/billing/plans";

/**
 * Edit a plan.
 *
 * Every limit the product enforces is a field here — that was the explicit
 * requirement, and it is why the plan is a database row rather than a constant.
 *
 * ── What editing a plan does NOT do ─────────────────────────────────
 * It does not change any existing customer. Their allowance, concurrency, SLA
 * and hours ceiling were copied onto their organisation when they paid, and
 * their purchase snapshotted the terms. Retitrating live accounts from here
 * would mean a price correction silently changed what somebody already bought.
 * The form says so, because the alternative is an admin finding out by
 * accident.
 */
export function PlanEditor({ plan }: { plan?: PublicPlan }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    savePlanAction,
    null,
  );
  const [open, setOpen] = useState(plan === undefined);

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>
    );
  }

  return (
    <form action={formAction} className="mt-4 grid gap-4 sm:grid-cols-2">
      {plan ? <input type="hidden" name="id" value={plan.id} /> : null}

      <Input
        label="Code"
        name="code"
        required
        defaultValue={plan?.code ?? ""}
        readOnly={plan !== undefined}
        hint={
          plan
            ? "Fixed once created — the marketing copy is matched to it."
            : "Lowercase, no spaces. Matches the slug in src/content/site.ts."
        }
        {...(state?.ok === false && state.field === "code" ? { error: state.error } : {})}
      />
      <Input label="Display name" name="name" required defaultValue={plan?.name ?? ""} />

      <Textarea
        label="Description"
        name="description"
        rows={2}
        defaultValue={plan?.description ?? ""}
        containerClassName="sm:col-span-2"
      />

      <Input
        label="Price (cents)"
        name="priceCents"
        type="number"
        min="0"
        required
        defaultValue={plan?.priceCents ?? 0}
        hint="49900 = $499. Whole cents, so no rounding surprises."
      />
      <Input
        label="Tasks in the pack"
        name="taskAllowance"
        type="number"
        min="1"
        required
        defaultValue={plan?.taskAllowance ?? 5}
        hint="How many tasks one purchase grants."
        {...(state?.ok === false && state.field === "taskAllowance"
          ? { error: state.error }
          : {})}
      />

      <Input
        label="Worked at once"
        name="concurrencyLimit"
        type="number"
        min="1"
        required
        defaultValue={plan?.concurrencyLimit ?? 1}
        hint="Concurrency. Separate from the pack size."
      />
      <Input
        label="Max hours per task"
        name="maxTaskHours"
        type="number"
        step="0.25"
        min="0.25"
        defaultValue={plan?.maxTaskHours ?? ""}
        // Blank and zero are very different answers here, and getting them
        // confused would block every task on the plan.
        hint="Leave blank for no ceiling. A task estimated above this is held."
      />

      <Input
        label="Response SLA (business hours)"
        name="slaHours"
        type="number"
        min="1"
        required
        defaultValue={plan?.slaHours ?? 48}
      />
      <Input
        label="Sort order"
        name="sortOrder"
        type="number"
        min="0"
        defaultValue={plan?.sortOrder ?? 0}
        hint="Lowest first on the pricing page."
      />

      <div className="flex flex-col gap-2 sm:col-span-2">
        <label className="flex items-center gap-2 font-sans text-sm text-ink-2">
          <input
            type="checkbox"
            name="isPublic"
            defaultChecked={plan?.isPublic ?? true}
            className="accent-[var(--color-accent)]"
          />
          Show on the public pricing page
        </label>
        <label className="flex items-center gap-2 font-sans text-sm text-ink-2">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={plan?.isActive ?? true}
            className="accent-[var(--color-accent)]"
          />
          Active — can be sold. Retiring a plan leaves existing customers alone.
        </label>
      </div>

      <p className="sm:col-span-2 font-mono text-xs leading-[1.7] text-ink-3">
        Saving changes what NEW customers get. Existing accounts keep the terms they
        bought — their limits were copied to their workspace at purchase, and their
        receipt snapshotted the price.
      </p>

      {state?.ok === false && !state.field ? (
        <p role="alert" className="sm:col-span-2 font-sans text-sm text-urgent">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="sm:col-span-2 font-mono text-xs text-shipped">
          Saved. The pricing page updates on next load.
        </p>
      ) : null}

      <div className="flex gap-3 sm:col-span-2">
        <Button type="submit" variant="primary" loading={pending}>
          {plan ? "Save plan" : "Create plan"}
        </Button>
        {plan ? (
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
