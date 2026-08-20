import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/marketing/auth-shell";
import { Suspense } from "react";

import { AuthFormFallback } from "@/components/marketing/auth-fallback";
import { AuthForm } from "@/components/marketing/auth-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Unbolt portal.",
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      lede="Your queue, your SLA clocks and your invoices."
      footer={
        <>
          No account yet?{" "}
          <Link href="/register" className="text-accent hover:underline">
            Start a plan
          </Link>
        </>
      }
    >
      <Suspense fallback={<AuthFormFallback />}>
        <AuthForm mode="sign-in" />
      </Suspense>
    </AuthShell>
  );
}
