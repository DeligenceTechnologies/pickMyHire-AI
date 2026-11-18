import { z } from "zod";
import { body, route, uuidParam } from "@/lib/api";
import { requirePlatformAdminApi } from "@/lib/auth/session";
import { CompanyPricingSchema } from "@/lib/pricing";
import { saveCompanyPricing } from "@/lib/services/pricing";

/** A company's own prices; `pricing: null` puts it back on standard pricing. */
const Schema = z.object({ pricing: CompanyPricingSchema.nullable() });

export const PUT = route<{ id: string }>(async (req, { id }) => {
  const admin = await requirePlatformAdminApi();
  await saveCompanyPricing(admin.userId, uuidParam(id), (await body(req, Schema)).pricing);
  return { ok: true };
});
