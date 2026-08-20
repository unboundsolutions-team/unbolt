import { ConnectStoreForm, DisconnectStoreButton } from "@/components/portal/connect-store-form";
import { Text } from "@/components/ui/text";
import { requirePermission } from "@/server/auth-context";
import { can } from "@/server/rbac";
import { SCOPES } from "@/server/shopify/oauth";
import { storesFor } from "@/server/shopify/store-service";

export const dynamic = "force-dynamic";

export const metadata = { title: "Stores" };

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("store:read", "/app/stores");
  const params = await searchParams;
  const connected = await storesFor(ctx.organizationId);

  const mayConnect = can(ctx.role, "store:connect");
  const mayDisconnect = can(ctx.role, "store:disconnect");

  // The install and callback routes redirect back here with a plain-language
  // sentence rather than a code, so this renders it directly.
  const error = typeof params["error"] === "string" ? params["error"] : null;
  const justConnected = typeof params["connected"] === "string" ? params["connected"] : null;
  const partial = typeof params["partial"] === "string" ? params["partial"] : null;

  return (
    <>
      <Text variant="eyebrow">Stores</Text>
      <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] text-ink">
        Connected storefronts
      </h1>
      <p className="mt-3 max-w-prose text-pretty font-sans text-sm leading-[1.6] text-ink-2">
        Connecting a store lets us read your theme and catalogue so a task can start without
        you sending credentials over email. We ask for read access only.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-(--radius-md) border border-urgent/40 bg-urgent/5 px-4 py-3 font-sans text-sm text-ink"
        >
          {friendlyError(error)}
        </p>
      ) : null}

      {justConnected ? (
        <p className="mt-6 rounded-(--radius-md) border border-accent/40 bg-accent/5 px-4 py-3 font-sans text-sm text-ink">
          <span className="font-medium">{justConnected}</span> is connected.
          {partial ? (
            <>
              {" "}
              It granted less access than we asked for ({partial}), so some checks will be
              skipped. Reconnect to grant the rest.
            </>
          ) : null}
        </p>
      ) : null}

      {connected.length === 0 ? (
        <div className="mt-10 rounded-(--radius-lg) border border-dashed border-line bg-raised px-6 py-12 text-center">
          <p className="font-display text-xl font-bold tracking-[-0.02em] text-ink">
            No store connected yet.
          </p>
          <p className="mx-auto mt-2 max-w-md text-pretty font-sans text-sm leading-[1.6] text-ink-2">
            {mayConnect
              ? "You can still queue work without one — connecting just saves a round of back-and-forth at the start of each task."
              : "Ask an admin in your workspace to connect one."}
          </p>
        </div>
      ) : (
        <ul className="mt-10 flex flex-col gap-3">
          {connected.map((store) => (
            <li
              key={store.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-(--radius-lg) border border-line bg-raised px-5 py-4"
            >
              <div className="min-w-0">
                <p className="truncate font-sans text-sm font-medium text-ink">
                  {store.shopName ?? store.domain}
                </p>
                <p className="mt-1 truncate font-mono text-xs text-ink-3">
                  {store.domain}
                  {store.planName ? ` · ${store.planName}` : ""}
                  {store.connectedAt
                    ? ` · connected ${store.connectedAt.toISOString().slice(0, 10)}`
                    : ""}
                </p>
                {store.missingScopes.length > 0 ? (
                  <p className="mt-2 font-mono text-xs text-urgent">
                    Missing access: {store.missingScopes.join(", ")}
                  </p>
                ) : null}
              </div>

              {mayDisconnect ? (
                <DisconnectStoreButton storeId={store.id} domain={store.domain} />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {mayConnect ? (
        <section className="mt-12 max-w-2xl rounded-(--radius-lg) border border-line bg-raised p-6">
          <Text variant="eyebrow">Connect a store</Text>
          <div className="mt-5">
            <ConnectStoreForm />
          </div>

          {/* Stating the scopes before the merchant clicks, not only on
              Shopify's consent screen. Someone deciding whether to trust us
              should not have to leave our site to find out what we asked for. */}
          <p className="mt-5 border-t border-line pt-4 font-mono text-xs leading-[1.7] text-ink-3">
            We request: {SCOPES.join(", ")}. All read-only. We never request customer
            records, and we can&rsquo;t place orders, edit your theme or move money.
          </p>
        </section>
      ) : null}
    </>
  );
}

/**
 * The install route redirects with a short code; the callback redirects with a
 * whole sentence. Both land here, so a code is expanded and anything else is
 * shown as written.
 */
function friendlyError(error: string): string {
  switch (error) {
    case "bad-shop":
      return "That isn't a Shopify store address. It should look like your-store.myshopify.com.";
    case "forbidden":
      return "Your role doesn't allow connecting stores. Ask an admin in your workspace.";
    case "not-configured":
      return "Store connections aren't configured yet. We're on it.";
    case "try-again":
      return "That didn't go through. Try connecting again.";
    default:
      return error;
  }
}
