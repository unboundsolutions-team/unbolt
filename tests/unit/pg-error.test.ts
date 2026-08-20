import { describe, expect, it } from "vitest";

import { isUniqueViolation, pgError } from "@/server/pg-error";

/**
 * These are the tests that would have caught the drizzle upgrade.
 *
 * Three code paths depend on recognising a unique-violation, and all three
 * degrade quietly when recognition fails — a confusing error message in two
 * cases, and in the third a concurrency slot collision that stops being
 * retried. Nothing throws that would point at the cause.
 *
 * The integration suite exercises the real errors, which is what found the
 * regression. These pin the shape itself, so a future driver that wraps errors
 * one level deeper fails here, next to the explanation, rather than in three
 * unrelated feature tests.
 */

/** What node-postgres throws directly. */
function driverError(constraint: string) {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: "23505",
    constraint,
    table: "organizations",
  });
}

/** What drizzle-orm wraps it in from 0.44 onward. */
function wrapped(inner: Error, depth = 1): Error {
  let out = inner;
  for (let i = 0; i < depth; i += 1) {
    out = Object.assign(new Error("Failed query: INSERT INTO ..."), { cause: out });
  }
  return out;
}

describe("recognising a Postgres error", () => {
  it("reads a driver error thrown directly", () => {
    expect(isUniqueViolation(driverError("organizations_slug_key"), "organizations_slug_key")).toBe(
      true,
    );
  });

  it("reads one wrapped by the query builder", () => {
    // The exact case that broke: drizzle 0.44 moved the driver error to .cause.
    expect(
      isUniqueViolation(wrapped(driverError("tasks_org_slot_key")), "tasks_org_slot_key"),
    ).toBe(true);
  });

  it("reads one wrapped more than once", () => {
    expect(
      isUniqueViolation(wrapped(driverError("stores_active_domain_key"), 3), "stores_active_domain_key"),
    ).toBe(true);
  });

  it("does not match a different constraint", () => {
    // Matters: a slug collision must not be mistaken for a slot collision and
    // retried five times against a constraint that will never clear.
    expect(isUniqueViolation(wrapped(driverError("organizations_slug_key")), "tasks_org_slot_key")).toBe(
      false,
    );
  });

  it("does not match a different error code", () => {
    const notNull = Object.assign(new Error("null value"), {
      code: "23502",
      constraint: "tasks_org_slot_key",
    });
    expect(isUniqueViolation(wrapped(notNull), "tasks_org_slot_key")).toBe(false);
  });

  it("returns null for something that is not a database error at all", () => {
    expect(pgError(new Error("network down"))).toBeNull();
    expect(pgError(null)).toBeNull();
    expect(pgError(undefined)).toBeNull();
    expect(pgError("a string")).toBeNull();
  });

  it("terminates on a circular cause chain", () => {
    // A hang here would be a genuinely awful bug to track down, and cause
    // chains are built by libraries rather than by us.
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(pgError(a)).toBeNull();
  });
});
