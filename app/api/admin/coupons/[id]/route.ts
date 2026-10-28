import { body, route, uuidParam } from "@/lib/api";
import { requirePlatformAdminApi } from "@/lib/auth/session";
import { CouponSchema } from "@/lib/coupons";
import { deleteCoupon, updateCoupon } from "@/lib/services/coupons";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const admin = await requirePlatformAdminApi();
  return updateCoupon(admin.userId, uuidParam(id), await body(req, CouponSchema));
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const admin = await requirePlatformAdminApi();
  return deleteCoupon(admin.userId, uuidParam(id));
});
