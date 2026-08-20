import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/marketing/auth-shell";
import { CreateWorkspaceForm } from "@/components/portal/create-workspace-form";
import { getSessionUser } from "@/server/onboarding";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create your workspace",
  robots: { index: false, follow: false },
};

export default async function WelcomePage() {
  const user = await getSessionUser();

  // Not signed in at all — this page is only reachable mid-registration.
  if (!user) redirect("/login");
  // Already set up. Coming back here later should not offer a second workspace.
  if (user.hasOrganization) redirect("/app");

  const suggestion = suggestFrom(user.email);

  return (
    <AuthShell
      title="One last thing"
      lede="Your account is live. Name the workspace your queue will live in."
      footer={<>Signed in as {user.email}</>}
    >
      <CreateWorkspaceForm {...(suggestion ? { suggestion } : {})} />
    </AuthShell>
  );
}

/**
 * Pre-fill from a work email domain — "ana@acmesupply.com" → "Acmesupply".
 *
 * Skipped for consumer mail hosts, where the domain says nothing about the
 * business and a prefilled "Gmail" would be worse than an empty field.
 */
function suggestFrom(email: string): string | undefined {
  const CONSUMER = new Set([
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "live.com",
    "icloud.com",
    "me.com",
    "proton.me",
    "protonmail.com",
    "aol.com",
    "rediffmail.com",
  ]);

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || CONSUMER.has(domain)) return undefined;

  const stem = domain.split(".")[0];
  if (!stem || stem.length < 2) return undefined;

  return stem.charAt(0).toUpperCase() + stem.slice(1);
}
