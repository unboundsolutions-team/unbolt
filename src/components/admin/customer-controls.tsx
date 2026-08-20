"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  addPurchaseAction,
  adjustCreditsAction,
  markPurchasePaidAction,
  provisionCustomerAction,
  updateCustomerLimitsAction,
} from "@/server/actions/admin";
import type { ActionResult } from "@/server/actions/tasks";

export interface PlanOption {
  code: string;
  name: string;
  taskAllowance: number;
}

/**
 * Create a customer account.
 *
 * The whole of the sales-led path: workspace, owner, plan, and a pending
 * purchase. Credits are NOT granted here — a paid pack is a separate,
 * deliberate act, so an account can exist before the money lands but tasks
 * cannot.
 */
export function ProvisionCustomerForm({
  plans,
  leadId,
  defaults,
}: {
  plans: readonly PlanOption[];
  leadId?: string | undefined;
  defaults?: { organizationName?: string; ownerName?: string; ownerEmail?: string } | undefined;
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult<{ email: string; password: string; organization: string }> | null,
    FormData
  >(provisionCustomerAction, null);

  if (state?.ok) {
    return (
      <div className="rounded-(--radius-lg) border border-accent/40 bg-accent/5 p-5">
        <p className="font-sans text-sm font-medium text-ink">
          {state.data.organization} is set up.
        </p>
        <p className="mt-2 font-sans text-sm leading-[1.6] text-ink-2">
          Send these credentials to the customer. This password is shown once and is not
          stored anywhere readable — if it is lost they use the reset flow.
        </p>
        <dl className="mt-4 grid gap-2 font-mono text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-3">Email</dt>
            <dd className="min-w-0 break-all text-ink">{state.data.email}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-3">Password</dt>
            <dd className="min-w-0 break-all font-medium text-accent">{state.data.password}</dd>
          </div>
        </dl>
        <p className="mt-4 font-mono text-xs text-ink-3">
          They have no task credits yet. Mark the payment received below to release the pack.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}

      <Input
        label="Workspace name"
        name="organizationName"
        required
        defaultValue={defaults?.organizationName ?? ""}
        placeholder="Northline Supply"
      />
      <Input
        label="Owner name"
        name="ownerName"
        required
        defaultValue={defaults?.ownerName ?? ""}
      />
      <Input
        label="Owner email"
        name="ownerEmail"
        type="email"
        required
        defaultValue={defaults?.ownerEmail ?? ""}
        {...(state?.ok === false && state.field === "ownerEmail" ? { error: state.error } : {})}
      />

      <label className="flex flex-col gap-1.5">
        <span className="font-sans text-sm font-medium text-ink">Plan</span>
        <select
          name="planCode"
          required
          className="h-10 w-full rounded-(--radius-md) border border-line-strong bg-card px-3 font-sans text-sm text-ink"
        >
          {plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name} — {p.taskAllowance} tasks
            </option>
          ))}
        </select>
      </label>

      {state?.ok === false && !state.field ? (
        <p role="alert" className="sm:col-span-2 font-sans text-sm text-urgent">
          {state.error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" loading={pending}>
          Create account
        </Button>
      </div>
    </form>
  );
}

/** Mark a pending purchase received — the step that releases the credits. */
export function MarkPaidForm({ purchaseId }: { purchaseId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    markPurchasePaidAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="purchaseId" value={purchaseId} />
      <Input
        label="Invoice / reference"
        name="reference"
        placeholder="INV-0042"
        containerClassName="w-44"
      />
      <Button type="submit" variant="primary" size="sm" loading={pending}>
        Payment received
      </Button>
      {state?.ok === false ? (
        <p role="alert" className="w-full font-mono text-xs text-urgent">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** Sell another pack, and the per-customer overrides. */
export function CustomerAdminPanel({
  organizationId,
  plans,
  limits,
}: {
  organizationId: string;
  plans: readonly PlanOption[];
  limits: { concurrencyLimit: number; slaHours: number; maxTaskHours: number | null };
}) {
  const [open, setOpen] = useState(false);

  const [pack, packAction, packing] = useActionState<ActionResult | null, FormData>(
    addPurchaseAction,
    null,
  );
  const [override, overrideAction, saving] = useActionState<ActionResult | null, FormData>(
    updateCustomerLimitsAction,
    null,
  );
  const [adjust, adjustAction, adjusting] = useActionState<ActionResult | null, FormData>(
    adjustCreditsAction,
    null,
  );

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Manage
      </Button>
    );
  }

  return (
    <div className="mt-5 flex w-full flex-col gap-6 border-t border-line pt-5">
      {/* Sell another pack */}
      <form action={packAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        <label className="flex flex-col gap-1.5">
          <span className="font-sans text-sm font-medium text-ink">Add a pack</span>
          <select
            name="planCode"
            className="h-10 rounded-(--radius-md) border border-line-strong bg-card px-3 font-sans text-sm text-ink"
          >
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} — {p.taskAllowance} tasks
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2.5 font-mono text-xs text-ink-3">
          <input type="checkbox" name="markPaid" className="accent-[var(--color-accent)]" />
          Already paid — release the credits now
        </label>
        <Button type="submit" variant="secondary" size="md" loading={packing}>
          Add pack
        </Button>
        {pack?.ok === false ? (
          <p role="alert" className="w-full font-mono text-xs text-urgent">
            {pack.error}
          </p>
        ) : null}
      </form>

      {/* Per-customer overrides */}
      <form action={overrideAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        <Input
          label="Worked at once"
          name="concurrencyLimit"
          type="number"
          min="1"
          defaultValue={limits.concurrencyLimit}
          containerClassName="w-32"
        />
        <Input
          label="SLA hours"
          name="slaHours"
          type="number"
          min="1"
          defaultValue={limits.slaHours}
          containerClassName="w-32"
        />
        <Input
          label="Max hours / task"
          name="maxTaskHours"
          type="number"
          step="0.25"
          min="0.25"
          defaultValue={limits.maxTaskHours ?? ""}
          containerClassName="w-40"
          hint="Blank = no ceiling"
        />
        <Button type="submit" variant="secondary" size="md" loading={saving}>
          Save limits
        </Button>
        {override?.ok ? (
          <p role="status" className="w-full font-mono text-xs text-shipped">
            Limits updated. A future pack purchase resets them to that plan&rsquo;s terms.
          </p>
        ) : null}
      </form>

      {/* Manual credit adjustment */}
      <form action={adjustAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        <Input
          label="Adjust credits"
          name="delta"
          type="number"
          required
          placeholder="1 or -1"
          containerClassName="w-32"
        />
        <Input
          label="Reason"
          name="reason"
          required
          placeholder="Goodwill after the outage"
          containerClassName="flex-1 min-w-[14rem]"
        />
        <Button type="submit" variant="secondary" size="md" loading={adjusting}>
          Apply
        </Button>
        {adjust?.ok === false ? (
          <p role="alert" className="w-full font-mono text-xs text-urgent">
            {adjust.error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
