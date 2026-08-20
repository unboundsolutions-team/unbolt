"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { signIn, signUp } from "@/lib/auth-client";

/**
 * Sign-in and sign-up, sharing one submit path.
 *
 * Two things this gets right that a naive version does not:
 *
 *  - **`?next=` is validated before use.** Middleware puts the intended path
 *    there, but it arrives via the URL, so it is attacker-controlled. Only
 *    same-origin absolute paths are honoured — otherwise `?next=https://evil`
 *    turns our sign-in page into an open redirect.
 *  - **The error is shown, not swallowed.** Better Auth returns a structured
 *    error; a form that silently does nothing on a wrong password is the most
 *    common auth bug there is.
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/app";
  // Must be a path on this origin. Rejects "//evil.com" and "https://evil.com".
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/app";
  return raw;
}

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = safeNext(params.get("next"));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    const name = String(data.get("name") ?? "");

    const result =
      mode === "sign-in"
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name });

    if (result.error) {
      setError(result.error.message ?? "That didn't work. Check your details and try again.");
      setBusy(false);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    /*
     * method="post" is not there because anything handles a POST. It is there
     * because of what happens if this form is submitted before React has
     * attached onSubmit — someone typing fast on a slow connection, or a build
     * where the chunk never arrives.
     *
     * A <form> with no method defaults to GET, and a native GET submit puts
     * every field in the query string. The password then lands in the address
     * bar, in browser history, in the Referer header of the next request, and
     * in the access log of anything in front of us. It is a credential leak
     * caused entirely by a race, and it leaves no trace that would make anybody
     * look for it.
     *
     * With method="post" the same race produces a failed POST and the password
     * stays in a request body that nothing logs.
     */
    <form onSubmit={onSubmit} method="post" className="flex flex-col gap-5" noValidate>
      {/*
        The fallback in auth-fallback.tsx covers the usual production case,
        where this component is not in the server HTML at all. This covers the
        other one: whenever the form IS server-rendered, it looks completely
        usable and does nothing, because submitting is handled in JavaScript.
        Telling somebody that costs one element.
      */}
      <noscript>
        <p className="text-sm text-ink-2">
          Signing in needs JavaScript. Turn it on for this site, or email us and we will get
          you in.
        </p>
      </noscript>

      {mode === "sign-up" ? (
        <Input label="Your name" name="name" autoComplete="name" required />
      ) : null}

      <Input label="Work email" name="email" type="email" autoComplete="email" required />

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        {...(mode === "sign-up" ? { hint: "At least 12 characters." } : {})}
        required
      />

      {error ? (
        // role="alert" so a screen reader is told immediately, rather than the
        // message appearing silently below a form the user has left.
        <p role="alert" className="font-sans text-sm leading-[1.5] text-urgent">
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" block loading={busy}>
        {mode === "sign-in" ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}
