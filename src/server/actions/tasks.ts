"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { TASK_STATES, type TaskState } from "@/components/product/status";
import { assertPermission, requireAuth } from "@/server/auth-context";
import { ForbiddenError } from "@/server/rbac";
import { QueueRuleError, queueTask, transitionTask } from "@/server/task-engine";

/**
 * The write boundary between the browser and the task engine.
 *
 * Three rules hold for every action in this file, and they are the reason it is
 * short:
 *
 * 1. **The organisation is never a parameter.** It comes from the session via
 *    getAuthContext. A form field naming an org is an assertion by whoever is
 *    posting, and honouring it would let any signed-in user queue work into any
 *    tenant. This is the single most important line in the file.
 * 2. **Permission is checked before the engine is touched**, so a viewer gets a
 *    refusal rather than a database round trip.
 * 3. **Nothing throws at the client.** A server action rejection reaches React
 *    as an opaque digest in production — useless to the person and useless in
 *    support. Every action returns a discriminated result instead.
 */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; field?: string };

const createSchema = z.object({
  // 120 is a hard cap in the UI too. The brief's rule is that titles are
  // written from the buyer's side — a paragraph pasted into this field is a
  // description, and it belongs in the body.
  title: z
    .string()
    .trim()
    .min(4, "Give the task a title of at least 4 characters.")
    .max(120, "Keep the title under 120 characters — put detail in the description."),
  body: z.string().trim().max(4000, "That description is too long.").optional(),
  storeId: z.string().uuid().optional(),
});

export async function createTaskAction(
  _prev: ActionResult<{ reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ reference: string }>> {
  try {
    const ctx = await requireAuth();
    await assertPermission(ctx, "task:create");

    const parsed = createSchema.safeParse({
      title: formData.get("title"),
      body: emptyToUndefined(formData.get("body")),
      storeId: emptyToUndefined(formData.get("storeId")),
    });

    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        ok: false,
        error: first?.message ?? "That task could not be queued.",
        ...(first?.path[0] ? { field: String(first.path[0]) } : {}),
      };
    }

    const created = await queueTask({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      title: parsed.data.title,
      body: parsed.data.body,
      storeId: parsed.data.storeId,
    });

    revalidatePortal();
    return { ok: true, data: { reference: created.reference } };
  } catch (error) {
    return { ok: false, error: messageFor(error) };
  }
}

const transitionSchema = z.object({
  taskId: z.string().uuid(),
  next: z.enum(TASK_STATES),
});

export async function transitionTaskAction(
  input: { taskId: string; next: TaskState },
): Promise<ActionResult> {
  try {
    const ctx = await requireAuth();

    const parsed = transitionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That is not a state a task can be in." };

    // Two different rules, because these are two different acts.
    //
    // Cancelling is the customer's own backlog and belongs to their org role.
    // Advancing work through delivery is Unbound's job: it stamps
    // first_response_at, which is the SLA the site publicly promises, and it
    // sets shipped_at, which is what the customer is invoiced against. Letting
    // a customer set either would mean the numbers on the marketing page were
    // measuring something the customer controls.
    //
    // isInternal is a user flag rather than an org role because a delivery
    // engineer is staff in every organisation, not a member elevated in one.
    if (parsed.data.next === "cancelled") {
      await assertPermission(ctx, "task:cancel");
    } else if (!ctx.isInternal) {
      return {
        ok: false,
        error: "Only the Unbound delivery team moves work through the board.",
      };
    }

    await transitionTask({
      taskId: parsed.data.taskId,
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      next: parsed.data.next,
    });

    revalidatePortal();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: messageFor(error) };
  }
}

function revalidatePortal(): void {
  revalidatePath("/app");
  revalidatePath("/app/tasks");
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Turn an exception into a sentence a customer can act on.
 *
 * QueueRuleError and ForbiddenError are already written for a person, so they
 * pass through. Anything else is a bug or an outage, and leaking its message
 * would put database internals on screen.
 */
function messageFor(error: unknown): string {
  if (error instanceof QueueRuleError) return error.message;
  if (error instanceof ForbiddenError) {
    return "Your role does not allow that. Ask an admin in your workspace.";
  }
  console.error("[task action]", error);
  return "Something went wrong on our side. Nothing was changed — try again.";
}
