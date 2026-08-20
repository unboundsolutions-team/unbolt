"use client";

import { useActionState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { beginConnectAction, disconnectStoreAction } from "@/server/actions/stores";
import type { ActionResult } from "@/server/actions/tasks";

/**
 * Start a Shopify install.
 *
 * The action validates and returns a URL rather than redirecting itself,
 * because the merchant has to leave our origin entirely and a server action
 * cannot cleanly hand off a cross-origin navigation. The client does the
 * `location.assign`, and the URL it navigates to is one we constructed from a
 * parsed domain — never the raw string the merchant typed.
 */
export function ConnectStoreForm() {
  const [state, formAction, pending] = useActionState<
    ActionResult<{ url: string }> | null,
    FormData
  >(beginConnectAction, null);

  useEffect(() => {
    if (state?.ok) window.location.assign(state.data.url);
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Input
        name="shop"
        label="Your Shopify store address"
        required
        placeholder="your-store.myshopify.com"
        hint="Find it in Shopify admin under Settings → Domains. Not your custom domain."
        containerClassName="flex-1"
        {...(state?.ok === false ? { error: state.error } : {})}
      />
      <Button type="submit" variant="primary" disabled={pending || state?.ok === true}>
        {pending || state?.ok ? "Redirecting…" : "Connect store"}
      </Button>
    </form>
  );
}

/**
 * Disconnect.
 *
 * Not a one-click action: this destroys a credential and stops any automation
 * that depends on it. The confirmation is a native `confirm` rather than a
 * modal because it must be impossible to miss and impossible to style away —
 * and because a modal here would be the only blocking dialog in the portal.
 */
export function DisconnectStoreButton({ storeId, domain }: { storeId: string; domain: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    disconnectStoreAction,
    null,
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Disconnect ${domain}?\n\nWe'll delete our copy of the access token immediately. ` +
            `Any work that depends on store access will pause until you reconnect.`,
        );
        if (!confirmed) event.preventDefault();
      }}
    >
      <input type="hidden" name="storeId" value={storeId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Disconnecting…" : "Disconnect"}
      </Button>
      {state?.ok === false ? (
        <p role="alert" className="mt-2 font-sans text-xs text-urgent">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
