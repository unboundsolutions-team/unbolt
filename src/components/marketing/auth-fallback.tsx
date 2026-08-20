import Link from "next/link";

/**
 * What the sign-in and sign-up pages show before their form arrives.
 *
 * ── Why this is not `fallback={null}` ───────────────────────────────
 * AuthForm reads `?next=`, so it is a client component behind Suspense and is
 * excluded from the prerender. With a null fallback the built HTML for /login is
 * a heading, a line of copy, and then nothing — 108 characters of readable text
 * on the page whose entire purpose is a form.
 *
 * When everything works that gap lasts a few hundred milliseconds and nobody
 * notices. When it does not — scripts blocked by a policy mistake, a chunk that
 * 404s after a bad deploy, an extension, JavaScript switched off — the visitor
 * gets a page that looks finished and simply has no way to sign in on it. They
 * have no reason to think anything is broken, so they try again, and then they
 * email us.
 *
 * So the fallback does two things: it holds the space (no layout jump on a good
 * connection) and, after a delay only a broken page survives, it says what is
 * wrong and gives a way to reach us that does not need scripts.
 */
export function AuthFormFallback() {
  return (
    <div className="grid gap-5">
      {/* Decorative. Announcing three grey bars to a screen reader is noise. */}
      <div aria-hidden="true" className="grid gap-5">
        {[0, 1].map((i) => (
          <div key={i} className="grid gap-2">
            <span className="h-3 w-24 rounded bg-inset" />
            <span className="h-11 w-full rounded-md bg-inset" />
          </div>
        ))}
        <span className="h-11 w-full rounded-md bg-inset" />
      </div>

      {/*
       * Hidden until the delay elapses. A page that hydrates normally replaces
       * this entire subtree long before then, so this is only ever seen when
       * the form genuinely is not coming.
       *
       * It is left in the accessibility tree rather than aria-hidden: a screen
       * reader user on a broken page needs this more than anyone.
       */}
      <p
        className={[
          "invisible opacity-0 text-sm text-ink-2",
          "animate-[reveal-late_1ms_linear_3s_forwards]",
        ].join(" ")}
      >
        This form needs JavaScript, and it has not loaded. Try reloading the page, or{" "}
        <Link href="/contact" className="text-accent underline">
          get in touch
        </Link>{" "}
        and we will sort it out.
      </p>
    </div>
  );
}
