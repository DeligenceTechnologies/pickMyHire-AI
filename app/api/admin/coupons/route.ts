import { body, route } from "@/lib/api";
import { requirePlatformAdminApi } from "@/lib/auth/session";
import { CouponSchema } from "@/lib/coupons";
import { createCoupon } from "@/lib/services/coupons";

export const POST = route(async (req) => {
  const admin = await requirePlatformAdminApi();
  return createCoupon(admin.userId, await body(req, CouponSchema));
});
