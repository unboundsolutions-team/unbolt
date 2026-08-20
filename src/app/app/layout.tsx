import Link from "next/link";
import type { ReactNode } from "react";

import { Container } from "@/components/layout/container";
import { PortalNav } from "@/components/portal/portal-nav";
import { SignOutButton } from "@/components/portal/sign-out-button";
import { Avatar } from "@/components/ui/avatar";
import { SITE } from "@/content/site";
import { requireAuth } from "@/server/auth-context";

/**
 * Every portal route resolves the session from the database, so nothing here
 * can be prerendered. Without this the build would try to statically generate
 * these pages and fail on a query it cannot run.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: { default: "Portal", template: `%s · Portal · ${SITE.name}` },
  robots: { index: false, follow: false },
};

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAuth("/app");

  return (
    <div className="min-h-svh">
      <header className="border-b border-line bg-raised">
        <Container className="flex h-16 items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <Link
              href="/app"
              className="font-display text-lg font-extrabold uppercase tracking-[-0.06em] text-ink"
            >
              {SITE.name}
            </Link>
            {/* Which organization you are acting in, always visible. Someone in
                two orgs must never have to guess which queue they are filling. */}
            <span className="hidden items-center gap-2 border-l border-line pl-5 sm:flex">
              <span className="font-sans text-sm text-ink">{ctx.organizationName}</span>
              <span className="rounded-(--radius-sm) border border-line bg-inset px-1.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-3">
                {ctx.role}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/*
              The way into the admin area.

              It existed — queue, customers, plans, leads, team — and nothing
              anywhere linked to it. Somebody promoted to staff signed in, landed
              here, saw the ordinary customer portal and reasonably concluded the
              admin side had not been built. A feature nobody can navigate to is
              a feature that does not exist.

              Marked in the urgent colour deliberately: crossing from your own
              workspace into a view of everybody's is a context change worth
              noticing, and it matches the Staff badge on the other side.
            */}
            {ctx.isInternal ? (
              <Link
                href="/admin"
                className="rounded-(--radius-sm) border border-urgent/50 px-2.5 py-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-urgent transition-colors duration-(--duration-micro) hover:bg-urgent/10"
              >
                Admin
              </Link>
            ) : null}
            <Avatar name={ctx.name ?? ctx.email} size="sm" />
            <SignOutButton />
          </div>
        </Container>
      </header>

      <Container>
        <PortalNav permissions={ctx.permissions} />
      </Container>

      <main id="main">
        <Container className="py-10">{children}</Container>
      </main>
    </div>
  );
}
