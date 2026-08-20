import type { Task } from "@/components/product/task-card";
import type { TaskState } from "@/components/product/status";
import { DEMO_TASKS } from "@/content/site";

/**
 * Turns the static demo content into live Task objects with real deadlines.
 *
 * Called per render on the server so the SLA clocks always start from "now" —
 * a hardcoded ISO timestamp would drift and eventually render every task as
 * overdue on a statically-generated page.
 */
export function demoTasks(): Task[] {
  return DEMO_TASKS.map((t) => ({
    id: t.id,
    ref: t.ref,
    title: t.title,
    state: t.state as TaskState,
    ...(t.store ? { store: t.store } : {}),
    ..."slaHours" in t && typeof t.slaHours === "number"
      ? { slaDeadline: new Date(Date.now() + t.slaHours * 3_600_000).toISOString() }
      : {},
    ..."shippedAt" in t && typeof t.shippedAt === "string" ? { shippedAt: t.shippedAt } : {},
  }));
}
