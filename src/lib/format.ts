/**
 * Formatting helpers shared by the product components.
 * Deterministic and timezone-explicit — a value rendered on the server must
 * match the value rendered on the client or React will complain, and an SLA
 * clock that disagrees with itself destroys the transparency pillar.
 */

/** `1000 * 60 * 90` → `1h 30m`. Clamped at zero; never renders "-0m". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Zero-padded countdown for the SLA clock: `04:12:07`. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Time left, in units a person can act on.
 *
 * A raw HH:MM:SS is right for the last stretch and actively misleading before
 * it. A 48-BUSINESS-hour SLA filed on a Tuesday lands about seven wall-clock
 * days out, so formatClock renders "181:30:07" — a number that looks nothing
 * like the 48 hours the site promised, and reads as though we are quietly
 * moving the goalposts.
 *
 * So: days and hours while it is far off, a live clock once it is close enough
 * that the seconds mean something.
 */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 24 * 3600) return formatClock(ms);

  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

/** Ticket references are mono and uppercase everywhere they appear. */
export function formatRef(ref: string): string {
  return ref.toUpperCase();
}

export function formatPrice(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
