"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { assertPermission, requireAuth } from "@/server/auth-context";
import { ForbiddenError } from "@/server/rbac";
import { parseShopDomain } from "@/server/shopify/domain";
import { disconnectStore } from "@/server/shopify/store-service";

import type { ActionResult } from "./tasks";

/**
 * Store actions.
 *
 * Same three rules as the task actions: the organisation comes from the session
 * and never from the form, permission is checked before any work, and nothing
 * throws at the client.
 */

const disconnectSchema = z.object({ storeId: z.string().uuid() });

export async function disconnectStoreAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await requireAuth();
    await assertPermission(ctx, "store:disconnect");

    const parsed = disconnectSchema.safeParse({ storeId: formData.get("storeId") });
    if (!parsed.success) return { ok: false, error: "That store could not be found." };

    // Scoped to the caller's organisation inside the statement, so a store id
    // belonging to another tenant simply matches nothing.
    const done = await disconnectStore({
      organizationId: ctx.organizationId,
      storeId: parsed.data.storeId,
    });

    if (!done) return { ok: false, error: "That store is already disconnected." };

    revalidatePath("/app/stores");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "Your role does not allow disconnecting stores." };
    }
    console.error("[disconnect store]", error);
    return { ok: false, error: "Something went wrong. The store was not changed." };
  }
}

/**
 * Turn a typed shop domain into the install URL.
 *
 * Validation happens here as well as in the install route — not redundantly,
 * but so the merchant gets an inline error on the form instead of a round trip
 * that bounces them back with a query parameter.
 */
const connectSchema = z.object({ shop: z.string().trim().min(1, "Enter your store address.") });

export async function beginConnectAction(
  _prev: ActionResult<{ url: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await requireAuth();
    await assertPermission(ctx, "store:connect");

    const parsed = connectSchema.safeParse({ shop: formData.get("shop") });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter your store address.", field: "shop" };
    }

    const shop = parseShopDomain(parsed.data.shop);
    if (!shop) {
      return {
        ok: false,
        error: "That isn't a Shopify store address. It looks like your-store.myshopify.com.",
        field: "shop",
      };
    }

    return { ok: true, data: { url: `/api/shopify/install?shop=${encodeURIComponent(shop)}` } };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "Your role does not allow connecting stores." };
    }
    console.error("[begin connect]", error);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}
