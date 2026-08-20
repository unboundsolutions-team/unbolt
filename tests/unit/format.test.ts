import { describe, expect, it } from "vitest";

import { formatClock, formatDuration, formatPrice, formatRef, formatRemaining } from "@/lib/format";
import { STATE_LABEL, TASK_STATES } from "@/components/product/status";

describe("formatClock", () => {
  it("zero-pads every field so the SLA clock never changes width", () => {
    expect(formatClock(0)).toBe("00:00:00");
    expect(formatClock(61_000)).toBe("00:01:01");
    expect(formatClock(3_600_000)).toBe("01:00:00");
  });

  // A breached SLA is something we own out loud, not a negative number.
  it("clamps at zero rather than counting into the negative", () => {
    expect(formatClock(-5_000)).toBe("00:00:00");
  });
});

describe("formatDuration", () => {
  it("drops to the largest meaningful unit", () => {
    expect(formatDuration(5_400_000)).toBe("1h 30m");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(9_000)).toBe("9s");
  });

  it("never renders a negative duration", () => {
    expect(formatDuration(-1)).toBe("0s");
  });
});

describe("formatRef / formatPrice", () => {
  it("uppercases ticket refs", () => {
    expect(formatRef("unb-312")).toBe("UNB-312");
  });

  it("renders plan prices without stray decimals", () => {
    expect(formatPrice(49_900)).toBe("$499");
    expect(formatPrice(149_900)).toBe("$1,499");
  });
});

describe("task state vocabulary", () => {
  // The same action must keep the same name through the whole flow — marketing
  // site, portal and admin queue all read from this one map.
  it("labels every state exactly once", () => {
    for (const state of TASK_STATES) {
      expect(STATE_LABEL[state]).toBeTruthy();
    }
    expect(new Set(Object.values(STATE_LABEL)).size).toBe(TASK_STATES.length);
  });
});

describe("formatRemaining", () => {
  it("uses a live clock inside the last day", () => {
    expect(formatRemaining(3 * 3600_000 + 90_000)).toBe("03:01:30");
    expect(formatRemaining(23 * 3600_000)).toBe("23:00:00");
  });

  it("switches to days once a raw hour count would mislead", () => {
    // The bug: a 48-BUSINESS-hour SLA lands ~7.5 wall-clock days out and used
    // to render as "181:30:07", which looks nothing like the promise made on
    // the pricing page.
    expect(formatRemaining(181.5 * 3600_000)).toBe("7d 13h");
    expect(formatRemaining(24 * 3600_000)).toBe("1d");
    expect(formatRemaining(49 * 3600_000)).toBe("2d 1h");
  });

  it("never renders negative time", () => {
    expect(formatRemaining(-5000)).toBe("00:00:00");
  });
});
