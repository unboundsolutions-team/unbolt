"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { Finding, Severity } from "@/server/scan/findings";

/**
 * The scan, live.
 *
 * The architecture is forced by §2.1 of the addendum — a synchronous function
 * times out at ~10s and a scan takes ~30 — so the form creates a job and this
 * polls. That constraint produces the better experience anyway: a visitor sees
 * progress instead of a spinner, and can leave the tab and come back.
 *
 * Three things it refuses to do:
 *  - fake progress with an animation that isn't tied to real state
 *  - poll forever, which silently costs a visitor battery on a dead scan
 *  - require an email before showing results, which is the dark pattern the
 *    brief exists to avoid
 */

interface ScanView {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  targetUrl: string;
  performanceScore: number | null;
  accessibilityScore: number | null;
  seoScore: number | null;
  bestPracticesScore: number | null;
  findings: Finding[];
  errorMessage: string | null;
}

const POLL_MS = 2000;
/** Give up after this long. The worker's own budget is shorter than this. */
const MAX_POLL_MS = 3 * 60 * 1000;

export function ScanRunner() {
  const [scan, setScan] = useState<ScanView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timer = useRef<number | null>(null);
  const startedAt = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // Clean up on unmount, or a navigation away leaves a timer polling a scan
  // nobody is looking at.
  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback(
    async (id: string) => {
      if (Date.now() - startedAt.current > MAX_POLL_MS) {
        setError("This is taking longer than it should. We'll keep going — refresh in a minute.");
        return;
      }

      try {
        const response = await fetch(`/api/scans/${id}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));

        const next = (await response.json()) as ScanView;
        setScan(next);

        if (next.status === "queued" || next.status === "running") {
          timer.current = window.setTimeout(() => void poll(id), POLL_MS);
        }
      } catch {
        // A single failed poll is usually a blip, so retry rather than giving
        // up on a scan that is probably fine.
        timer.current = window.setTimeout(() => void poll(id), POLL_MS * 2);
      }
    },
    [],
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    stopPolling();
    setError(null);
    setScan(null);
    setSubmitting(true);

    const url = String(new FormData(event.currentTarget).get("url") ?? "");

    try {
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const body = (await response.json()) as { id?: string; error?: string };

      if (!response.ok || !body.id) {
        // The API's message is written for a person — a bad address, a rate
        // limit — so show it rather than replacing it with something generic.
        setError(body.error ?? "We couldn't start that scan.");
        return;
      }

      startedAt.current = Date.now();
      setScan({
        id: body.id,
        status: "queued",
        targetUrl: url,
        performanceScore: null,
        accessibilityScore: null,
        seoScore: null,
        bestPracticesScore: null,
        findings: [],
        errorMessage: null,
      });
      void poll(body.id);
    } catch {
      setError("We couldn't reach our own scanner. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  // Narrowed to the union Progress accepts, rather than re-deriving it there.
  const pending =
    scan?.status === "queued" || scan?.status === "running" ? scan.status : null;
  const running = pending !== null;

  return (
    <div className="mt-9 max-w-[46rem]">
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
        <Input
          label="Store URL"
          name="url"
          type="text"
          required
          placeholder="northline.co"
          containerClassName="flex-1"
          {...(error ? { error } : {})}
        />
        <Button type="submit" variant="primary" size="lg" disabled={submitting || running}>
          {submitting ? "Starting…" : running ? "Scanning…" : "Run the scan"}
        </Button>
      </form>

      {/* aria-live so a screen reader hears the result arrive, not just sighted
          users watching the panel change. */}
      <div aria-live="polite" className="mt-8">
        {pending && scan ? <Progress status={pending} target={scan.targetUrl} /> : null}
        {scan?.status === "failed" ? <Failed message={scan.errorMessage} /> : null}
        {scan?.status === "complete" ? <Report scan={scan} /> : null}
      </div>
    </div>
  );
}

/**
 * Honest progress.
 *
 * Two real states, named. No percentage bar — we do not know what fraction of
 * the audit is done, and inventing one to look responsive is the same class of
 * dishonesty as inventing a statistic.
 */
function Progress({ status, target }: { status: "queued" | "running"; target: string }) {
  return (
    <div className="rounded-(--radius-lg) border border-line bg-raised px-5 py-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-accent motion-safe:animate-[pulse-soft_1.6s_ease-in-out_infinite]"
        />
        <p className="min-w-0 font-mono text-xs uppercase tracking-[0.14em] text-ink-3">
          {status === "queued" ? "Queued" : "Measuring"}
        </p>
      </div>
      <p className="mt-3 truncate font-sans text-sm text-ink-2">{target}</p>
      <p className="mt-2 font-sans text-sm text-ink-3">
        We load your store the way a phone on mobile data would. This takes about thirty seconds.
      </p>
    </div>
  );
}

function Failed({ message }: { message: string | null }) {
  return (
    <div
      role="alert"
      className="rounded-(--radius-lg) border border-urgent/40 bg-urgent/5 px-5 py-6"
    >
      <p className="font-sans text-sm font-medium text-ink">We couldn&rsquo;t finish that scan.</p>
      <p className="mt-2 font-sans text-sm leading-[1.6] text-ink-2">
        {message ?? "Try again in a few minutes."}
      </p>
    </div>
  );
}

function Report({ scan }: { scan: ScanView }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-(--radius-lg) border border-line bg-line sm:grid-cols-4">
        <Score label="Performance" value={scan.performanceScore} />
        <Score label="Accessibility" value={scan.accessibilityScore} />
        <Score label="SEO" value={scan.seoScore} />
        <Score label="Best practices" value={scan.bestPracticesScore} />
      </div>

      {scan.findings.length === 0 ? (
        <p className="rounded-(--radius-lg) border border-line bg-raised px-5 py-6 font-sans text-sm leading-[1.6] text-ink-2">
          Nothing on this page crossed the thresholds we check. That covers loading, layout
          stability and script weight on this one URL — not checkout, and not your other templates.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {scan.findings.map((finding, index) => (
            <li
              key={finding.id}
              className="min-w-0 rounded-(--radius-lg) border border-line bg-raised px-5 py-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="min-w-0 text-pretty font-sans text-sm font-medium text-ink">
                  <span data-numeric className="mr-2 font-mono text-xs text-ink-3">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {finding.title}
                </h3>
                <SeverityTag severity={finding.severity} />
              </div>
              <p className="mt-2 text-pretty font-sans text-sm leading-[1.6] text-ink-2">
                {finding.body}
              </p>
              <p data-numeric className="mt-2 font-mono text-xs text-ink-3">
                {finding.evidence}
              </p>
            </li>
          ))}
        </ol>
      )}

      {/* §10.4: nothing here asserts a statistic we cannot defend. The measured
          numbers are shown; no revenue impact is projected from them. */}
      <p className="font-mono text-xs leading-[1.7] text-ink-3">
        Measured on one URL, on a simulated mobile connection. Field data is used where your store
        has enough traffic for Chrome to report it, lab data otherwise.
      </p>
    </div>
  );
}

function Score({ label, value }: { label: string; value: number | null }) {
  const tone =
    value === null ? "text-ink-3" : value >= 90 ? "text-shipped" : value >= 50 ? "text-ink" : "text-urgent";

  return (
    <div className="bg-raised px-4 py-5">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-ink-3">{label}</p>
      <p data-numeric className={cn("mt-2 font-display text-3xl font-extrabold tabular-nums", tone)}>
        {value ?? "—"}
      </p>
    </div>
  );
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function SeverityTag({ severity }: { severity: Severity }) {
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5",
        "font-mono text-xs uppercase tracking-[0.1em]",
        severity === "critical" || severity === "high"
          ? "border-urgent/40 text-urgent"
          : "border-line-strong text-ink-3",
      )}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}
