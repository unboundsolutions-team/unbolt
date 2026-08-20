import Link from "next/link";
import type { ReactNode } from "react";

import { Container } from "@/components/layout/container";
import { AdminNav } from "@/components/admin/admin-nav";
import { SignOutButton } from "@/components/portal/sign-out-button";
import { SITE } from "@/content/site";
import { requireInternal } from "@/server/auth-context";

/** Every admin route resolves the session from the database. */
export const dynamic = "force-dynamic";

export const metadata = {
  title: { default: "Admin", template: `%s · Admin · ${SITE.name}` },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await requireInternal();

  return (
    <div className="min-h-svh">
      {/* Visually distinct from the customer portal on purpose. Someone with
          both open needs to know at a glance which one they are typing into —
          an admin action taken in the belief it was a customer view is how a
          plan gets edited for the wrong account. */}
      <header className="border-b border-line-strong bg-inset">
        <Container className="flex h-16 items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-5">
            <Link
              href="/admin"
              className="font-display text-lg font-extrabold uppercase tracking-[-0.06em] text-ink"
            >
              {SITE.name}
            </Link>
            <span className="rounded-full border border-urgent/50 px-2.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-urgent">
              Staff
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden truncate font-mono text-xs text-ink-3 sm:block">
              {staff.email}
            </span>
            <SignOutButton />
          </div>
        </Container>
      </header>

      <Container>
        <AdminNav />
        <main id="main" className="py-10">
          {children}
        </main>
      </Container>
    </div>
  );
}
