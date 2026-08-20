"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAuth } from "@/server/auth-context";
import { CommentError, postComment } from "@/server/comments";
import { ForbiddenError, can } from "@/server/rbac";

import type { ActionResult } from "./tasks";

/**
 * A customer replying on their own task.
 *
 * Separate from the admin comment action rather than shared with a flag,
 * because the two differ in the thing that matters: this one resolves the
 * organisation from the customer's session and can never post an internal note.
 * A single action taking `isInternal` from a form would be one missing check
 * away from letting a customer write in the staff-only thread.
 */
const schema = z.object({
  taskId: z.string().uuid(),
  body: z.string().trim().min(1, "Write something first."),
});

export async function replyToTaskAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await requireAuth();

    // Commenting is part of discussing work, so it rides on task:comment — a
    // viewer can read a task but not speak on it.
    if (!can(ctx.role, "task:comment")) {
      return { ok: false, error: "Your role is read-only on this workspace." };
    }

    const parsed = schema.safeParse({
      taskId: formData.get("taskId"),
      body: formData.get("body"),
    });

    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Write something first." };
    }

    await postComment({
      taskId: parsed.data.taskId,
      // From the session, never the form. A task id belonging to another
      // tenant simply matches nothing inside the insert.
      organizationId: ctx.organizationId,
      authorId: ctx.userId,
      body: parsed.data.body,
      // Hardcoded false, not passed through. A customer cannot post a hidden
      // comment on their own task, and there is no code path here that could
      // let them.
      isInternal: false,
      authorIsInternal: false,
    });

    revalidatePath(`/app/tasks/${parsed.data.taskId}`);
    revalidatePath("/app/tasks");
    return { ok: true };
  } catch (error) {
    if (error instanceof CommentError) return { ok: false, error: error.publicMessage };
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "Your role does not allow commenting." };
    }
    console.error("[reply]", error);
    return { ok: false, error: "That didn't post. Try again." };
  }
}
