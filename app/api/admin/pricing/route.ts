import { z } from "zod";
import { body, route } from "@/lib/api";
import { requirePlatformAdminApi } from "@/lib/auth/session";
import { PricingSchema } from "@/lib/pricing";
import { CostSchema, savePricing } from "@/lib/services/pricing";

const Schema = z.object({ pricing: PricingSchema, costs: CostSchema });

/** Standard pricing for every company without its own prices. */
export const PUT = route(async (req) => {
  const admin = await requirePlatformAdminApi();
  const { pricing, costs } = await body(req, Schema);
  await savePricing(admin.userId, pricing, costs);
  return { ok: true };
});
