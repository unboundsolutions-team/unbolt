"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createOrganizationFor, getSessionUser, OnboardingError } from "@/server/onboarding";

import type { ActionResult } from "./tasks";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give your workspace a name — usually your brand or company.")
    .max(80, "That name is too long."),
});

/**
 * Create the caller's first workspace.
 *
 * The user id comes from the session, never from the form. The name is the only
 * thing the browser gets to decide.
 */
export async function createWorkspaceAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Someone who already has a workspace has either double-submitted or come
  // back to this URL later. Sending them on is friendlier than an error, and it
  // stops a stray refresh creating a duplicate organisation.
  if (user.hasOrganization) redirect("/app");

  const parsed = schema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That name will not work.",
      field: "name",
    };
  }

  try {
    await createOrganizationFor({ userId: user.userId, name: parsed.data.name });
  } catch (error) {
    if (error instanceof OnboardingError) return { ok: false, error: error.message, field: "name" };
    console.error("[create workspace]", error);
    return { ok: false, error: "Something went wrong on our side. Try again." };
  }

  // Outside the try: redirect() signals by throwing, so catching around it
  // would swallow the navigation and report a failure that never happened.
  redirect("/app");
}
