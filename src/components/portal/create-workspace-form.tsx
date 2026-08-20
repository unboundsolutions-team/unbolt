"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { createWorkspaceAction } from "@/server/actions/onboarding";
import type { ActionResult } from "@/server/actions/tasks";

/**
 * The last step of signing up.
 *
 * One field on purpose. Everything else a workspace needs — plan, SLA,
 * concurrency — has a sensible default in the schema, and asking a new customer
 * to configure them before they have filed a single task is asking them to make
 * decisions they have no basis for yet.
 */
export function CreateWorkspaceForm({ suggestion }: { suggestion?: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createWorkspaceAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Input
        name="name"
        label="Workspace name"
        required
        autoFocus
        maxLength={80}
        defaultValue={suggestion ?? ""}
        placeholder="Acme Supply Co."
        hint="Usually your brand. You can change it later."
        {...(state?.ok === false ? { error: state.error } : {})}
      />

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Creating…" : "Create workspace"}
      </Button>
    </form>
  );
}
