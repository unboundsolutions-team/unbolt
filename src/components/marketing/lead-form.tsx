"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { submitLeadAction } from "@/server/actions/leads";
import type { ActionResult } from "@/server/actions/tasks";

export interface LeadFormPlan {
  code: string;
  name: string;
  summary: string;
}

/**
 * The enquiry form.
 *
 * This is now the only route into the product, so it has to be the most
 * reliable form on the site: a plain `<form action={…}>` that works before
 * hydration, one round trip, and a confirmation that says what happens next
 * rather than "thanks".
 *
 * `preselectedPlan` comes from the plan card the visitor clicked. Carrying it
 * through means the sales call starts from what they were already looking at
 * instead of asking them to say it again.
 */
export function LeadForm({
  plans,
  preselectedPlan,
}: {
  plans: readonly LeadFormPlan[];
  preselectedPlan?: string | undefined;
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult<{ name: string }> | null,
    FormData
  >(submitLeadAction, null);

  if (state?.ok) {
    return (
      <div
        // Focusable so a keyboard user lands on the outcome rather than being
        // dropped at the top of a page whose form has vanished.
        tabIndex={-1}
        className="rounded-(--radius-lg) border border-accent/40 bg-accent/5 px-6 py-8"
      >
        <p className="font-display text-xl font-bold tracking-[-0.02em] text-ink">
          Thanks, {state.data.name} — that&rsquo;s with us.
        </p>
        <p className="mt-3 max-w-prose text-pretty font-sans text-sm leading-[1.6] text-ink-2">
          We&rsquo;ll reply inside one business day to book a short call. On it we&rsquo;ll walk
          you through the portal, size the work you described, and tell you which plan
          actually fits — including if that&rsquo;s a cheaper one than you picked.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-6 sm:grid-cols-2">
      <Input
        label="Your name"
        name="name"
        autoComplete="name"
        required
        {...(state?.ok === false && state.field === "name" ? { error: state.error } : {})}
      />
      <Input
        label="Work email"
        name="email"
        type="email"
        autoComplete="email"
        required
        {...(state?.ok === false && state.field === "email" ? { error: state.error } : {})}
      />
      <Input label="Company" name="company" autoComplete="organization" />
      <Input
        label="Store domain"
        name="store"
        placeholder="northline.co"
        hint="Your myshopify or custom domain."
      />

      <Select
        label="Plan you're considering"
        name="plan"
        placeholder="Not sure yet"
        className="sm:col-span-2"
        {...(preselectedPlan ? { defaultValue: preselectedPlan } : {})}
        options={plans.map((p) => ({ value: p.code, label: `${p.name} — ${p.summary}` }))}
      />

      <Textarea
        label="What needs doing?"
        name="message"
        rows={5}
        placeholder="Describe it the way you'd describe it to a colleague."
        hint="Symptoms beat specifications. The more we know, the more accurate the plan we recommend."
        containerClassName="sm:col-span-2"
      />

      <div className="sm:col-span-2">
        <Checkbox
          name="demo"
          label="I'd like a walkthrough of the portal on the call"
        />
      </div>

      {state?.ok === false && !state.field ? (
        <p role="alert" className="sm:col-span-2 font-sans text-sm text-urgent">
          {state.error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Send it
        </Button>
      </div>
    </form>
  );
}
