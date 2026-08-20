import { describe, expect, it } from "vitest";

import { TASK_STATES, type TaskState } from "@/components/product/status";
import {
  allowedNext,
  available,
  canTransition,
  isTerminal,
  occupiesSlot,
  permits,
  refusalReason,
} from "@/server/queue/concurrency";
import { SLA_TIMEZONE, slaBreached, slaDeadline, slaRemainingMs } from "@/server/queue/sla";

/**
 * These are the highest-value assertions in the codebase: "unlimited queue,
 * limited concurrency" is what the customer pays for, so a bug here either
 * gives the product away or blocks work someone has already paid for.
 *
 * The same assertions run against the Laravel port
 * (tests/Unit/ConcurrencyPolicyTest.php), so the two stacks cannot drift.
 */
describe("concurrency — the pricing model", () => {
  it("does not count queued tasks against the cap", () => {
    expect(occupiesSlot("queued")).toBe(false);
  });

  it("counts both in_progress and in_review", () => {
    // If in_review were free, a plan could run unbounded work by parking
    // everything in review.
    expect(occupiesSlot("in_progress")).toBe(true);
    expect(occupiesSlot("in_review")).toBe(true);
  });

  it("refuses to start work at the cap", () => {
    expect(permits("queued", "in_progress", 2, 2)).toBe(false);
  });

  it("allows starting work below the cap", () => {
    expect(permits("queued", "in_progress", 1, 2)).toBe(true);
  });

  it("does not charge a second slot for in_progress → in_review", () => {
    expect(permits("in_progress", "in_review", 2, 2)).toBe(true);
  });

  it("always allows shipping or cancelling, even above the cap", () => {
    // A downgrade can leave an org over its new limit. They must still be able
    // to finish or drop the work already running.
    expect(permits("in_progress", "shipped", 5, 2)).toBe(true);
    expect(permits("queued", "cancelled", 9, 1)).toBe(true);
  });

  it("refuses illegal transitions regardless of capacity", () => {
    expect(permits("shipped", "in_progress", 0, 4)).toBe(false);
    expect(permits("cancelled", "queued", 0, 4)).toBe(false);
  });

  it("treats shipped and cancelled as terminal", () => {
    expect(allowedNext("shipped")).toHaveLength(0);
    expect(allowedNext("cancelled")).toHaveLength(0);
    expect(isTerminal("shipped")).toBe(true);
  });

  it("lets review send work back rather than forcing a re-queue", () => {
    // Without this a failed review would have to be cancelled and re-created,
    // losing the task's history and its original SLA.
    expect(canTransition("in_review", "in_progress")).toBe(true);
  });

  it("explains a refusal in terms the customer can act on", () => {
    const reason = refusalReason("queued", "in_progress", 2, 2);
    expect(reason).toContain("2 tasks at a time");
    expect(reason).toContain("Ship or cancel");
  });

  it("returns null when there is nothing to refuse", () => {
    expect(refusalReason("queued", "in_progress", 0, 2)).toBeNull();
  });

  it("never reports negative availability after a downgrade", () => {
    expect(available(5, 2)).toBe(0);
  });

  it("has a transition table covering every state", () => {
    for (const state of TASK_STATES) {
      expect(Array.isArray(allowedNext(state as TaskState))).toBe(true);
    }
  });
});

describe("SLA — business hours, not wall clock", () => {
  /** Build an instant from a wall-clock time in the delivery team's timezone. */
  const at = (iso: string) => new Date(`${iso}+05:30`);
  // Normalised rather than compared raw: ICU emits "Wed, 15:00" on some Node
  // builds and "Wed 15:00" on others, and that is not what these tests are about.
  const local = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: SLA_TIMEZONE,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(d)
      .replace(",", "");

  it("does not burn the SLA over a weekend", () => {
    // Fri 18:00 + 24 business hours. Day is 10:00–19:00 = 9h.
    // 1h Friday, 9h Monday, 9h Tuesday, 5h Wednesday → Wed 15:00.
    expect(local(slaDeadline(at("2026-08-14T18:00:00"), 24))).toBe("Wed 15:00");
  });

  it("starts the clock at opening for an overnight submission", () => {
    expect(local(slaDeadline(at("2026-08-11T03:00:00"), 4))).toBe("Tue 14:00");
  });

  it("keeps a short SLA inside the same working day", () => {
    expect(local(slaDeadline(at("2026-08-11T11:00:00"), 3))).toBe("Tue 14:00");
  });

  it("rolls a Saturday submission to Monday morning", () => {
    expect(local(slaDeadline(at("2026-08-15T11:00:00"), 2))).toBe("Mon 12:00");
  });

  it("reports how far past a breach is, rather than clamping", () => {
    // An admin triaging needs "an hour over", not just "late".
    const deadline = at("2026-08-11T11:00:00");
    const now = at("2026-08-11T12:00:00");
    expect(slaRemainingMs(now, deadline)).toBe(-3_600_000);
    expect(slaBreached(now, deadline)).toBe(true);
  });

  it("is not breached before the deadline", () => {
    expect(slaBreached(at("2026-08-11T10:30:00"), at("2026-08-11T11:00:00"))).toBe(false);
  });
});
