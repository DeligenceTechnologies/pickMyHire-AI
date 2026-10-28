import "server-only";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { withSystem, type Tx } from "@/lib/database/db";
import { describeReward, type CouponInput } from "@/lib/coupons";
import { hashToken } from "@/lib/security/tokens";
import { platformAudit } from "./platform";

// Promo codes. A company redeems a code to add free interviews to its quota and/or
// extend its free trial. Each company, and each person, can use a code once.

export type Coupon = {
  id: string; code: string; interviews: number; trial_days: number; max_uses: number | null; expires_at: Date | null;
  active: boolean; note: string | null; created_at: Date; uses: number;
};
export type CouponStatus = "active" | "off" | "expired" | "used_up";

export const couponStatus = (c: Pick<Coupon, "active" | "expires_at" | "max_uses" | "uses">): CouponStatus =>
  !c.active ? "off" : c.expires_at && c.expires_at <= new Date() ? "expired" : c.max_uses != null && c.uses >= c.max_uses ? "used_up" : "active";

/** Wrong, switched off, expired and used-up codes all get the same answer, so codes can't be probed. */
export const INVALID_CODE = "This code isn't valid or has expired.";

const emailHash = (email: string) => hashToken(`coupon:${email.trim().toLowerCase()}`);
/** A date picked in the admin form is valid to the end of that day (UTC). */
const endOfDay = (d: string | null) => (d ? new Date(`${d}T23:59:59.999Z`) : null);

const COLUMNS = (tx: Tx) => tx`
  c.id, c.code::text as code, c.interviews, c.trial_days, c.max_uses, c.expires_at, c.active, c.note, c.created_at,
  (select count(*)::int from coupon_redemptions r where r.coupon_id = c.id) as uses`;

// ---------------------------------------------------------------- platform admin

export async function listCoupons() {
  return withSystem((tx) => tx<Coupon[]>`select ${COLUMNS(tx)} from coupons c order by c.created_at desc`);
}

export async function getCoupon(id: string) {
  return withSystem(async (tx) => {
    const [coupon] = await tx<Coupon[]>`select ${COLUMNS(tx)} from coupons c where c.id = ${id}`;
    if (!coupon) return null;
    const redemptions = await tx<{
      id: string; organization_id: string | null; company_name: string; user_name: string | null; user_email: string | null;
      interviews_added: number; trial_days_added: number; created_at: Date;
    }[]>`
      select r.id, r.organization_id, coalesce(o.name, r.company_name) as company_name, u.name as user_name, u.email::text as user_email,
        r.interviews_added, r.trial_days_added, r.created_at
      from coupon_redemptions r
      left join organizations o on o.id = r.organization_id
      left join users u on u.id = r.user_id
      where r.coupon_id = ${id}
      order by r.created_at desc`;
    return { coupon, redemptions };
  });
}

export async function createCoupon(adminId: string, input: CouponInput) {
  return withSystem(async (tx) => {
    const [taken] = await tx`select 1 from coupons where code = ${input.code}`;
    if (taken) throw new ApiError(409, "A coupon with this code already exists.", "conflict", [{ path: "code", message: "This code is already used" }]);
    const [c] = await tx<{ id: string }[]>`
      insert into coupons (code, interviews, trial_days, max_uses, expires_at, active, note, created_by)
      values (${input.code}, ${input.interviews}, ${input.trialDays}, ${input.maxUses}, ${endOfDay(input.expiresAt)}, ${input.active}, ${input.note || null}, ${adminId})
      returning id`;
    await platformAudit(tx, { adminId, action: "coupon.created", targetType: "coupon", targetId: c.id, details: { code: input.code, reward: describeReward(input.interviews, input.trialDays) } });
    return { id: c.id };
  });
}

/** Changes apply to future redemptions; companies that already redeemed keep what they got. */
export async function updateCoupon(adminId: string, id: string, input: CouponInput) {
  return withSystem(async (tx) => {
    const [c] = await tx<{ code: string; uses: number }[]>`
      select code::text as code, (select count(*)::int from coupon_redemptions where coupon_id = ${id}) as uses from coupons where id = ${id} for update`;
    if (!c) throw new ApiError(404, "Coupon not found");
    if (input.code !== c.code) {
      if (c.uses > 0) throw new ApiError(400, "The code can't be changed after it has been used.", "error", [{ path: "code", message: "Already used by a company" }]);
      const [taken] = await tx`select 1 from coupons where code = ${input.code} and id <> ${id}`;
      if (taken) throw new ApiError(409, "A coupon with this code already exists.", "conflict", [{ path: "code", message: "This code is already used" }]);
    }
    await tx`
      update coupons set code = ${input.code}, interviews = ${input.interviews}, trial_days = ${input.trialDays}, max_uses = ${input.maxUses},
        expires_at = ${endOfDay(input.expiresAt)}, active = ${input.active}, note = ${input.note || null}, updated_at = now()
      where id = ${id}`;
    await platformAudit(tx, { adminId, action: "coupon.updated", targetType: "coupon", targetId: id, details: { code: input.code, active: input.active, reward: describeReward(input.interviews, input.trialDays) } });
    return { ok: true };
  });
}

/** Only unused coupons can be deleted; used ones are switched off instead, to keep the history. */
export async function deleteCoupon(adminId: string, id: string) {
  return withSystem(async (tx) => {
    const [c] = await tx<{ code: string; uses: number }[]>`
      select code::text as code, (select count(*)::int from coupon_redemptions where coupon_id = ${id}) as uses from coupons where id = ${id} for update`;
    if (!c) throw new ApiError(404, "Coupon not found");
    if (c.uses > 0) throw new ApiError(400, "This coupon has been used. Switch it off instead, so its history is kept.");
    await tx`delete from coupons where id = ${id}`;
    await platformAudit(tx, { adminId, action: "coupon.deleted", targetType: "coupon", targetId: id, details: { code: c.code } });
    return { ok: true };
  });
}

// ---------------------------------------------------------------- companies

/**
 * Redeem a code for the company. The coupon and company rows are locked, so a
 * code with a use limit can't be over-used by companies redeeming at the same moment.
 */
export async function redeemCoupon(auth: { orgId: string; userId: string; email: string }, code: string) {
  return withSystem(async (tx) => {
    const [coupon] = await tx<{ id: string; code: string; interviews: number; trial_days: number; max_uses: number | null; expires_at: Date | null; active: boolean }[]>`
      select id, code::text as code, interviews, trial_days, max_uses, expires_at, active from coupons where code = ${code} for update`;
    if (!coupon || !coupon.active || (coupon.expires_at && coupon.expires_at <= new Date())) throw new ApiError(400, INVALID_CODE, "invalid_code");
    const [{ uses }] = await tx<{ uses: number }[]>`select count(*)::int as uses from coupon_redemptions where coupon_id = ${coupon.id}`;
    if (coupon.max_uses != null && uses >= coupon.max_uses) throw new ApiError(400, INVALID_CODE, "invalid_code");

    const [org] = await tx<{ name: string; plan: "standard" | "trial"; interview_quota: number | null }[]>`
      select name, plan, interview_quota from organizations where id = ${auth.orgId} for update`;
    if (!org) throw new ApiError(404, "Company not found");
    const hash = emailHash(auth.email);
    const [used] = await tx<{ same_org: boolean }[]>`
      select organization_id = ${auth.orgId} as same_org from coupon_redemptions
      where coupon_id = ${coupon.id} and (organization_id = ${auth.orgId} or email_hash = ${hash}) limit 1`;
    if (used) throw new ApiError(409, used.same_org ? "Your company has already used this code." : "You've already used this code.", "already_redeemed");

    // Interviews only add to a limited quota; trial days only extend a free trial.
    const interviews = org.interview_quota == null ? 0 : coupon.interviews;
    const trialDays = org.plan === "trial" ? coupon.trial_days : 0;
    if (!interviews && !trialDays) {
      throw new ApiError(400, org.interview_quota == null
        ? "Your plan already has unlimited interviews, so this code doesn't add anything."
        : "This code extends free trials, and your company isn't on a free trial.", "nothing_to_add");
    }

    await tx`
      update organizations set
        interview_quota = interview_quota + ${interviews},
        trial_ends_at = case when ${trialDays}::int > 0 then greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => ${trialDays}::int) else trial_ends_at end
      where id = ${auth.orgId}`;
    await tx`
      insert into coupon_redemptions (coupon_id, organization_id, user_id, company_name, email_hash, interviews_added, trial_days_added)
      values (${coupon.id}, ${auth.orgId}, ${auth.userId}, ${org.name}, ${hash}, ${interviews}, ${trialDays})`;
    const reward = describeReward(interviews, trialDays);
    await audit(tx, { orgId: auth.orgId, userId: auth.userId, action: "plan.coupon_redeemed", entityType: "organization", entityId: auth.orgId, metadata: { code: coupon.code, interviews, trialDays } });
    await platformAudit(tx, { adminId: null, action: "coupon.redeemed", targetType: "coupon", targetId: coupon.id, details: { code: coupon.code, company: org.name, organizationId: auth.orgId, reward } });
    return { interviews, trialDays, message: `Code applied: ${reward} added.` };
  });
}
