import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/marketing/auth-shell";
import { Suspense } from "react";

import { AuthFormFallback } from "@/components/marketing/auth-fallback";
import { AuthForm } from "@/components/marketing/auth-form";

export const metadata: Metadata = {
  title: "Start a plan",
  description: "Create your Unbolt account and start queueing engineering tasks.",
  robots: { index: false, follow: true },
};

export default function RegisterPage() {
  return (
    <AuthShell
      title="Start a plan"
      lede="Create your account, pick a plan, queue your first task. Cancel any month."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <Suspense fallback={<AuthFormFallback />}>
        <AuthForm mode="sign-up" />
      </Suspense>
    </AuthShell>
  );
}
