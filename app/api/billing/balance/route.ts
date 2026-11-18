import { route } from "@/lib/api";
import { can } from "@/lib/auth/permissions";
import { requireApiAuth } from "@/lib/auth/session";
import { getPricingFor } from "@/lib/services/pricing";
import { getQuotaStatus } from "@/lib/services/quota";

/** The company's interview balance, for warnings in the invite windows. */
export const GET = route(async () => {
  const auth = await requireApiAuth("interview:write");
  const [q, { pricing }] = await Promise.all([getQuotaStatus(auth.orgId), getPricingFor(auth.orgId)]);
  return { remaining: q.remaining, onHold: q.onHold, minutesPerInterview: pricing.minutesPerInterview, canBuy: can(auth.role, "billing:manage") };
});
