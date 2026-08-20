/**
 * When we owe the customer a first response.
 *
 * Pure: "now" is always passed in, never read from the clock. That makes it
 * testable and removes a whole class of flaky test.
 *
 * ── The commitment this encodes ─────────────────────────────────────
 * The site promises a *response* SLA, never a delivery estimate (§10 of the
 * brief — no measured claims). So this computes the response deadline only.
 *
 * It runs on business hours, not wall-clock. A 24-hour SLA on a task queued at
 * 6pm Friday must not be breached by Saturday evening while nobody was ever
 * going to be working — that would be a promise designed to fail.
 *
 * Authoritative TypeScript copy of app/Services/Queue/SlaCalculator.php.
 */

/** The delivery team's working day, in their timezone. */
export const SLA_TIMEZONE = "Asia/Kolkata";
export const DAY_START_HOUR = 10;
export const DAY_END_HOUR = 19;

/** Wall-clock parts of an instant, in the delivery team's timezone. */
function parts(at: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: SLA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) map[p.type] = p.value;

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(map["year"]),
    month: Number(map["month"]),
    day: Number(map["day"]),
    hour: Number(map["hour"]) % 24,
    minute: Number(map["minute"]),
    second: Number(map["second"]),
    weekday: weekdays.indexOf(map["weekday"] ?? "Sun"),
  };
}

/** The UTC instant for a given local wall-clock time in SLA_TIMEZONE. */
function instantFor(year: number, month: number, day: number, hour: number, minute = 0): Date {
  // Guess UTC, measure the zone's offset at that guess, then correct. Two
  // passes settle it even across a DST boundary — India has none today, but
  // hardcoding +05:30 would silently break if the team ever moves.
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 2; i += 1) {
    const p = parts(new Date(guess));
    const actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const target = Date.UTC(year, month - 1, day, hour, minute, 0);
    guess += target - actual;
  }
  return new Date(guess);
}

function isWeekend(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}

/** Roll forward to the next moment the team is actually working. */
function advanceToOpen(at: Date): Date {
  let cursor = at;

  for (let guard = 0; guard < 14; guard += 1) {
    const p = parts(cursor);
    const open = instantFor(p.year, p.month, p.day, DAY_START_HOUR);
    const close = instantFor(p.year, p.month, p.day, DAY_END_HOUR);

    if (!isWeekend(p.weekday)) {
      if (cursor >= open && cursor < close) return cursor;
      if (cursor < open) return open;
    }

    // After close, or a weekend: try tomorrow morning.
    const next = new Date(cursor.getTime() + 24 * 3600_000);
    const np = parts(next);
    cursor = instantFor(np.year, np.month, np.day, DAY_START_HOUR);
  }

  return cursor;
}

/** Deadline for a first response, counting only business hours. */
export function slaDeadline(queuedAt: Date, slaHours: number): Date {
  let cursor = advanceToOpen(queuedAt);
  let remaining = slaHours * 3600_000;

  for (let guard = 0; guard < 60 && remaining > 0; guard += 1) {
    const p = parts(cursor);
    const close = instantFor(p.year, p.month, p.day, DAY_END_HOUR);
    const availableToday = close.getTime() - cursor.getTime();

    if (availableToday >= remaining) {
      return new Date(cursor.getTime() + remaining);
    }

    remaining -= availableToday;
    cursor = advanceToOpen(new Date(close.getTime() + 1000));
  }

  return cursor;
}

/**
 * Milliseconds until the deadline. Negative once breached — deliberately not
 * clamped, because "how far past" is what an admin needs to triage.
 */
export function slaRemainingMs(now: Date, deadline: Date): number {
  return deadline.getTime() - now.getTime();
}

export function slaBreached(now: Date, deadline: Date): boolean {
  return slaRemainingMs(now, deadline) <= 0;
}
