import { body, route } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { RedeemSchema } from "@/lib/coupons";
import { redeemCoupon } from "@/lib/services/coupons";

/** Redeem a promo code for the signed-in user's company (Owner and Admin). */
export const POST = route(async (req) => {
  const auth = await requireApiAuth("usage:view");
  const { code } = await body(req, RedeemSchema);
  return redeemCoupon(auth, code);
}, { rateLimit: { key: "coupon-redeem", limit: 10, windowMs: 15 * 60_000 } });
