import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSystem } from "@/lib/database/db";
import { CouponSchema } from "@/lib/coupons";
import { couponStatus, createCoupon, deleteCoupon, getCoupon, INVALID_CODE, listCoupons, redeemCoupon, updateCoupon } from "@/lib/services/coupons";

// Promo codes against the local database: rewards, one use per company and per person, limits.
const id = Date.now().toString(36).toUpperCase();
const users: string[] = [];
const orgs: string[] = [];
const coupons: string[] = [];
let adminId = "";

async function user(name: string) {
  const email = `${name.toLowerCase()}-${id.toLowerCase()}@coupon.test`;
  const [u] = await withSystem((tx) => tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${email}, ${name}, 'x') returning id`);
  users.push(u.id);
  return { userId: u.id, email };
}
async function company(name: string, opts: { trial?: boolean; quota?: number | null; trialEnds?: Date } = {}) {
  const owner = await user(name);
  const [o] = await withSystem((tx) => tx<{ id: string }[]>`
    insert into organizations (name, slug, plan, interview_quota, trial_ends_at)
    values (${`${name} ${id}`}, ${`${name.toLowerCase()}-${id.toLowerCase()}`}, ${opts.trial ? "trial" : "standard"},
            ${opts.quota === undefined ? 3 : opts.quota}, ${opts.trial ? opts.trialEnds ?? new Date(Date.now() + 2 * 86_400_000) : null})
    returning id`);
  orgs.push(o.id);
  await withSystem((tx) => tx`insert into organization_members (organization_id, user_id, role) values (${o.id}, ${owner.userId}, 'owner')`);
  return { orgId: o.id, ...owner };
}
const org = (orgId: string) => withSystem(async (tx) => (await tx<{ interview_quota: number | null; trial_ends_at: Date | null }[]>`
  select interview_quota, trial_ends_at from organizations where id = ${orgId}`)[0]);
async function coupon(code: string, c: { interviews?: number; trialDays?: number; maxUses?: number | null; expiresAt?: string | null; active?: boolean } = {}) {
  const input = CouponSchema.parse({ code: `${code}${id}`, interviews: c.interviews ?? 10, trialDays: c.trialDays ?? 0, maxUses: c.maxUses ?? null, expiresAt: c.expiresAt ?? null, active: c.active ?? true, note: null });
  const { id: cid } = await createCoupon(adminId, input);
  coupons.push(cid);
  return { id: cid, code: input.code, input };
}

beforeAll(async () => { adminId = (await user("Admin")).userId; });
afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from coupons where id = any(${coupons})`;
    await tx`delete from organizations where id = any(${orgs})`;
    await tx`delete from users where id = any(${users})`;
  });
});

describe("coupons", () => {
  it("adds free interviews and extends a trial, once per company", async () => {
    const c = await coupon("BOTH", { interviews: 10, trialDays: 14 });
    const a = await company("Trialco", { trial: true, quota: 3 });
    const before = await org(a.orgId);
    const res = await redeemCoupon(a, c.code.toLowerCase());
    expect(res).toMatchObject({ interviews: 10, trialDays: 14 });
    expect(res.message).toBe("Code applied: 10 free interviews · 14 extra trial days added.");
    const after = await org(a.orgId);
    expect(after.interview_quota).toBe(13);
    expect(after.trial_ends_at!.getTime() - before.trial_ends_at!.getTime()).toBe(14 * 86_400_000);
    await expect(redeemCoupon(a, c.code)).rejects.toMatchObject({ status: 409, message: "Your company has already used this code." });
    expect((await org(a.orgId)).interview_quota).toBe(13);
  });

  it("restarts an ended trial from today", async () => {
    const c = await coupon("REVIVE", { interviews: 0, trialDays: 7 });
    const a = await company("Ended", { trial: true, trialEnds: new Date(Date.now() - 5 * 86_400_000) });
    await redeemCoupon(a, c.code);
    const ends = (await org(a.orgId)).trial_ends_at!.getTime();
    expect(Math.abs(ends - (Date.now() + 7 * 86_400_000))).toBeLessThan(60_000);
  });

  it("gives only what applies to the plan", async () => {
    const both = await coupon("PLAN", { interviews: 5, trialDays: 10 });
    const daysOnly = await coupon("DAYS", { interviews: 0, trialDays: 10 });
    const std = await company("Standard", { quota: 3 });
    expect(await redeemCoupon(std, both.code)).toMatchObject({ interviews: 5, trialDays: 0 });
    expect((await org(std.orgId)).trial_ends_at).toBeNull();
    await expect(redeemCoupon(std, daysOnly.code)).rejects.toMatchObject({ status: 400, code: "nothing_to_add" });
    const unlimited = await company("Unlimited", { quota: null });
    await expect(redeemCoupon(unlimited, (await coupon("UNL")).code)).rejects.toMatchObject({ status: 400, message: /unlimited/ });
  });

  it("refuses wrong, switched-off, expired and used-up codes with the same message", async () => {
    const a = await company("Refused");
    const off = await coupon("OFF", { active: false });
    const expired = await coupon("OLD", { expiresAt: "2020-01-01" });
    const one = await coupon("ONE", { maxUses: 1 });
    await redeemCoupon(await company("First"), one.code);
    for (const code of [`NOPE${id}`, off.code, expired.code, one.code]) {
      await expect(redeemCoupon(a, code)).rejects.toMatchObject({ status: 400, message: INVALID_CODE });
    }
    expect((await org(a.orgId)).interview_quota).toBe(3);
  });

  it("never goes over the limit when companies redeem at the same moment", async () => {
    const c = await coupon("RACE", { maxUses: 2 });
    const cos = await Promise.all(["Ra", "Rb", "Rc", "Rd", "Re"].map((n) => company(n)));
    const results = await Promise.allSettled(cos.map((co) => redeemCoupon(co, c.code)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((await getCoupon(c.id))!.coupon.uses).toBe(2);
  });

  it("can't be used again by the same person in a new company", async () => {
    const c = await coupon("PERSON");
    const a = await company("Again");
    await redeemCoupon(a, c.code);
    const [o2] = await withSystem((tx) => tx<{ id: string }[]>`insert into organizations (name, slug) values (${`Second ${id}`}, ${`second-${id.toLowerCase()}`}) returning id`);
    orgs.push(o2.id);
    await expect(redeemCoupon({ ...a, orgId: o2.id }, c.code)).rejects.toMatchObject({ status: 409, message: "You've already used this code." });
    // History stays after the company is deleted.
    await withSystem((tx) => tx`delete from organizations where id = ${a.orgId}`);
    const { redemptions } = (await getCoupon(c.id))!;
    expect(redemptions[0]).toMatchObject({ organization_id: null, company_name: `Again ${id}` });
  });

  it("is managed by the platform admin", async () => {
    const c = await coupon("ADMIN");
    await expect(createCoupon(adminId, c.input)).rejects.toMatchObject({ status: 409 });
    await updateCoupon(adminId, c.id, { ...c.input, active: false, maxUses: 5 });
    const listed = (await listCoupons()).find((x) => x.id === c.id)!;
    expect(couponStatus(listed)).toBe("off");
    await redeemCoupon(await company("Used"), (await coupon("USED")).code).then(async () => {
      const used = coupons[coupons.length - 1];
      await expect(deleteCoupon(adminId, used)).rejects.toMatchObject({ status: 400 });
      await expect(updateCoupon(adminId, used, { ...(await coupon("TMP")).input, code: `RENAMED${id}` })).rejects.toMatchObject({ status: 400 });
    });
    await deleteCoupon(adminId, c.id);
    expect(await getCoupon(c.id)).toBeNull();
  });

  it("validates the admin form", () => {
    expect(CouponSchema.safeParse({ code: "ab", interviews: 1, trialDays: 0, maxUses: null, expiresAt: null, active: true, note: null }).success).toBe(false);
    expect(CouponSchema.safeParse({ code: "launch 50", interviews: 0, trialDays: 0, maxUses: null, expiresAt: null, active: true, note: null }).success).toBe(false);
    expect(CouponSchema.parse({ code: "launch 50", interviews: 3, trialDays: 0, maxUses: null, expiresAt: null, active: true, note: null }).code).toBe("LAUNCH50");
  });
});
