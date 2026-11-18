import { z } from "zod";
import { ApiError, body, route } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { log } from "@/lib/logger";
import { unlockPurchases } from "@/lib/purchase-access";

const Schema = z.object({ code: z.string().trim().min(1, "Enter the access code.").max(200) });

/** Unlock buying online with the pre-launch access code. */
export const POST = route(async (req) => {
  const auth = await requireApiAuth("billing:manage");
  const { code } = await body(req, Schema);
  if (!(await unlockPurchases(code))) {
    log.warn("billing.access_code_wrong", { orgId: auth.orgId, userId: auth.userId });
    throw new ApiError(400, "That access code isn't right.", "wrong_code");
  }
  log.info("billing.access_unlocked", { orgId: auth.orgId, userId: auth.userId });
  return { ok: true };
}, { rateLimit: { key: "billing-access", limit: 5, windowMs: 60_000 } });
