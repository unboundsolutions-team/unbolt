"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { setStaffAccessAction } from "@/server/actions/admin";
import type { ActionResult } from "@/server/actions/tasks";

const ROLES = [
  { value: "engineer", label: "Engineer" },
  { value: "pm", label: "PM" },
  { value: "superadmin", label: "Superadmin" },
] as const;

export function StaffAccessForm() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    setStaffAccessAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <Input
        label="Their email"
        name="email"
        type="email"
        required
        placeholder="engineer@unboundsolutions.in"
        containerClassName="flex-1 min-w-[16rem]"
        {...(state?.ok === false && state.field === "email" ? { error: state.error } : {})}
      />

      <label className="flex flex-col gap-1.5">
        <span className="font-sans text-sm font-medium text-ink">Role</span>
        <select
          name="role"
          className="h-10 rounded-(--radius-md) border border-line-strong bg-card px-3 font-sans text-sm text-ink"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <Button type="submit" variant="primary" loading={pending}>
        Grant access
      </Button>

      {state?.ok ? (
        <p role="status" className="w-full font-mono text-xs text-shipped">
          Done. They can reach /admin now.
        </p>
      ) : null}
      {state?.ok === false && !state.field ? (
        <p role="alert" className="w-full font-sans text-sm text-urgent">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Remove someone's access.
 *
 * Confirmed, because it is immediate and silent from their side — the next page
 * they open just stops working. The action separately refuses to remove the
 * last superadmin, which is the case with no recovery inside the product.
 */
export function RevokeStaffButton({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    setStaffAccessAction,
    null,
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Remove admin access for ${email}?`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="revoke" value="true" />
      <Button type="submit" variant="ghost" size="sm" loading={pending}>
        Remove
      </Button>
      {state?.ok === false ? (
        <p role="alert" className="mt-2 max-w-[22rem] font-mono text-xs text-urgent">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
