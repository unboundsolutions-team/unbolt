import { Text } from "@/components/ui/text";
import { requirePermission } from "@/server/auth-context";
import { permissionsFor } from "@/server/rbac";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requirePermission("org:read", "/app/settings");

  return (
    <>
      <Text variant="eyebrow">Settings</Text>
      <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] text-ink">
        {ctx.organizationName}
      </h1>

      <dl className="mt-10 grid gap-px border border-line bg-line sm:grid-cols-2">
        {[
          ["Organization", ctx.organizationName],
          ["Slug", ctx.organizationSlug],
          ["Signed in as", ctx.email],
          ["Your role", ctx.role],
        ].map(([k, v]) => (
          <div key={k} className="bg-base p-5">
            <dt className="font-mono text-xs uppercase tracking-[0.14em] text-ink-3">{k}</dt>
            <dd className="mt-2 text-sm text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      {/* Making the capability set visible is a support decision: "why can't I
          do X" is answerable by looking, instead of by a ticket. */}
      <h2 className="mt-12 font-display text-xl font-extrabold tracking-[-0.03em] text-ink">
        What your role allows
      </h2>
      <ul className="mt-5 flex flex-wrap gap-2">
        {permissionsFor(ctx.role).map((p) => (
          <li
            key={p}
            className="rounded-(--radius-sm) border border-line bg-inset px-2 py-1 font-mono text-xs text-ink-2"
          >
            {p}
          </li>
        ))}
      </ul>
    </>
  );
}
