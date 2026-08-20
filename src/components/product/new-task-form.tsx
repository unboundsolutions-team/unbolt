"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { createTaskAction, type ActionResult } from "@/server/actions/tasks";

/**
 * Queue a task.
 *
 * ── Why this is a plain <form> with a server action ─────────────────
 * It posts and works with JavaScript disabled or still loading. The queue is
 * the product; a customer who cannot file a task because a bundle failed has
 * lost the thing they pay for. useActionState progressively enhances the same
 * form rather than replacing it.
 *
 * The optimism budget here is deliberately zero. Queueing is the one action
 * where a false confirmation is expensive: the customer walks away believing
 * work is filed. So the form waits for the server and shows the real reference
 * number it assigned.
 */
export function NewTaskForm({ slaHours }: { slaHours: number }) {
  const [state, formAction, pending] = useActionState<
    ActionResult<{ reference: string }> | null,
    FormData
  >(createTaskAction, null);

  const formRef = useRef<HTMLFormElement>(null);
  const [justFiled, setJustFiled] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setJustFiled(state.data.reference);
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <Input
        name="title"
        label="What needs doing?"
        required
        maxLength={120}
        placeholder="Variant swatches drop selection on mobile Safari"
        // The brief's rule, surfaced at the moment it applies rather than in a
        // help doc nobody opens.
        hint="Describe it the way you'd say it out loud. Symptoms beat instructions."
        {...(state?.ok === false && state.field === "title" ? { error: state.error } : {})}
      />

      <Textarea
        name="body"
        label="Anything else we should know?"
        rows={4}
        maxLength={4000}
        placeholder="Steps to reproduce, the page it happens on, what you'd expect instead."
        hint="Optional. Links to a screen recording or a specific product page help most."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-ink-3">
          First response within{" "}
          <span className="font-medium text-ink">{slaHours} business hours</span>.
        </p>

        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Queueing…" : "Queue this task"}
        </Button>
      </div>

      {/* aria-live so the outcome is announced, not just painted. */}
      <div aria-live="polite" className="min-h-5">
        {state?.ok === false && !state.field ? (
          <p className="font-sans text-sm text-urgent">{state.error}</p>
        ) : null}

        {justFiled ? (
          <p className="font-sans text-sm text-ink-2">
            Queued as{" "}
            <span data-numeric className="font-mono font-medium text-accent">
              {justFiled}
            </span>
            . It&rsquo;s on the board.
          </p>
        ) : null}
      </div>
    </form>
  );
}
