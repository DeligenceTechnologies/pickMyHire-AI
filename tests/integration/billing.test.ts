import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { withSystem } from "@/lib/database/db";

// Runs against the local database with a fake Stripe (no network). Each run uses its own throwaway company.
const sessions = new Map<string, Partial<Stripe.Checkout.Session>>();
const created: Stripe.Checkout.SessionCreateParams[] = [];
vi.mock("@/lib/stripe", () => ({
  paymentsEnabled: () => true,
  paymentsTestMode: () => true,
  stripe: () => ({
    checkout: {
      sessions: {
        create: async (params: Stripe.Checkout.SessionCreateParams) => {
          created.push(params);
          const id = `cs_test_${created.length}${Date.now().toString(36)}`;
          sessions.set(id, { id, metadata: params.metadata as Stripe.Metadata, client_reference_id: params.client_reference_id ?? null, payment_status: "unpaid", amount_total: 0, currency: "usd" });
          return { id, url: `https://checkout.stripe.test/${id}` };
        },
        retrieve: async (id: string) => sessions.get(id),
      },
    },
  }),
}));

const { applyRefund, expirePurchases, fulfilCheckout, handleStripeEvent, startCheckout } = await import("@/lib/services/billing");
const { getQuotaStatus, readQuota } = await import("@/lib/services/quota");

const id = Date.now().toString(36);
let orgId = "", ownerId = "";
const auth = () => ({ userId: ownerId, email: `owner-${id}@billing.test`, name: "Owner", orgId, orgName: "Billing Co", orgSlug: `billing-co-${id}`, role: "owner" as const, sessionId: "s", isPlatformAdmin: false });

/** Checkout, then mark the Stripe session paid with the amount Stripe would charge. */
async function buy(qty: number) {
  const { url } = await startCheckout(auth(), qty);
  const sessionId = url.split("/").pop()!;
  const s = sessions.get(sessionId)!;
  const line = created.at(-1)!.line_items![0];
  sessions.set(sessionId, {
    ...s, payment_status: "paid", amount_total: (line.price_data!.unit_amount as number) * (line.quantity as number), currency: "usd",
    payment_intent: { id: `pi_${sessionId}`, latest_charge: { receipt_url: "https://pay.stripe.test/receipt" } } as unknown as Stripe.PaymentIntent,
  });
  return sessionId;
}
const purchase = (sessionId: string) => withSystem((tx) => tx<{ id: string; status: string; interviews_added: number; total_cents: number; unit_cents: number; receipt_url: string | null }[]>`
  select id, status, interviews_added, total_cents, unit_cents, receipt_url from purchases where stripe_session_id = ${sessionId}`).then((r) => r[0]);

beforeAll(async () => {
  await withSystem(async (tx) => {
    const [o] = await tx<{ id: string }[]>`
      insert into organizations (name, slug, interview_quota, quota_counted_from, plan, trial_ends_at)
      values (${`Billing Co ${id}`}, ${`billing-co-${id}`}, 3, now() - interval '1 day', 'trial', now() + interval '10 days') returning id`;
    orgId = o.id;
    const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`owner-${id}@billing.test`}, 'Owner', 'x') returning id`;
    ownerId = u.id;
    await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${u.id}, 'owner')`;
  });
});
afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = ${ownerId}`;
  });
});
beforeEach(() => { created.length = 0; });

describe("buying interviews", () => {
  it("the server sets the price from the company's tiers, not the browser", async () => {
    await startCheckout(auth(), 50);
    const line = created[0].line_items![0];
    expect(line.quantity).toBe(50);
    expect(line.price_data!.unit_amount).toBe(249); // standard 50+ tier
    expect(created[0].metadata).toMatchObject({ organization_id: orgId });
  });

  it("rejects amounts below the minimum and above the talk-to-us level", async () => {
    await expect(startCheckout(auth(), 5)).rejects.toMatchObject({ status: 400 });
    await expect(startCheckout(auth(), 250)).rejects.toMatchObject({ status: 400 });
  });

  it("adds the interviews once, turns a trial into a paying company, and stores the receipt", async () => {
    const before = (await getQuotaStatus(orgId)).remaining!;
    const sid = await buy(10);
    expect(await fulfilCheckout(sid, orgId)).toEqual({ status: "paid", quantity: 10, added: true });
    // The webhook and a page refresh arrive too: nothing more is added.
    expect(await fulfilCheckout(sid)).toEqual({ status: "paid", quantity: 10, added: false });
    expect(await fulfilCheckout(sid, orgId)).toMatchObject({ added: false });
    const q = await getQuotaStatus(orgId);
    expect(q.remaining).toBe(before + 10);
    expect(q.plan).toBe("standard");
    expect(await purchase(sid)).toMatchObject({ status: "paid", interviews_added: 10, total_cents: 2990, receipt_url: "https://pay.stripe.test/receipt" });
    const [n] = await withSystem((tx) => tx<{ payload: { quantity: string } }[]>`select payload from notifications where organization_id = ${orgId} and type = 'billing.purchased'`);
    expect(n.payload.quantity).toBe("10");
  });

  it("an unpaid session, or another company's session, adds nothing", async () => {
    const { url } = await startCheckout(auth(), 10);
    const sid = url.split("/").pop()!;
    expect(await fulfilCheckout(sid, orgId)).toEqual({ status: "pending" });
    expect(await fulfilCheckout(sid, "00000000-0000-4000-8000-000000000000")).toEqual({ status: "unknown" });
  });

  it("a paid amount that doesn't match the purchase adds nothing", async () => {
    const before = (await getQuotaStatus(orgId)).remaining!;
    const sid = await buy(10);
    sessions.set(sid, { ...sessions.get(sid)!, amount_total: 100 });
    expect(await fulfilCheckout(sid, orgId)).toEqual({ status: "unknown" });
    expect((await getQuotaStatus(orgId)).remaining).toBe(before);
  });

  it("the same webhook event twice is handled once", async () => {
    const sid = await buy(10);
    const event = { id: `evt_${sid}`, type: "checkout.session.completed", data: { object: { id: sid } } } as unknown as Stripe.Event;
    const before = (await getQuotaStatus(orgId)).remaining!;
    expect(await handleStripeEvent(event)).toBe("handled");
    expect(await handleStripeEvent(event)).toBe("duplicate");
    expect((await getQuotaStatus(orgId)).remaining).toBe(before + 10);
  });

  it("a full refund takes back unused interviews, never below zero", async () => {
    const sid = await buy(10);
    await fulfilCheckout(sid, orgId);
    const p = await purchase(sid);
    const before = (await getQuotaStatus(orgId)).remaining!;
    await applyRefund({ payment_intent: `pi_${sid}`, amount_refunded: p.total_cents } as unknown as Stripe.Charge);
    expect((await getQuotaStatus(orgId)).remaining).toBe(before - 10);
    expect(await purchase(sid)).toMatchObject({ status: "refunded", interviews_added: 0 });
    // The same refund again changes nothing.
    await applyRefund({ payment_intent: `pi_${sid}`, amount_refunded: p.total_cents } as unknown as Stripe.Charge);
    expect((await getQuotaStatus(orgId)).remaining).toBe(before - 10);
  });

  it("an expired purchase takes back only its unused interviews", async () => {
    const sid = await buy(10);
    await fulfilCheckout(sid, orgId);
    await withSystem((tx) => tx`update purchases set expires_at = now() - interval '1 minute' where stripe_session_id = ${sid}`);
    // Before expiry runs: the balance, and what the purchases that are still valid hold.
    const r0 = (await withSystem((tx) => readQuota(tx, orgId))).remaining!;
    const [{ valid }] = await withSystem((tx) => tx<{ valid: number }[]>`
      select coalesce(sum(interviews_added), 0)::int as valid from purchases
      where organization_id = ${orgId} and status in ('paid', 'partially_refunded') and expired_at is null and expires_at > now()`);
    const expected = Math.min(10, Math.max(0, r0 - valid));
    expect((await getQuotaStatus(orgId)).remaining).toBe(r0 - expected); // reading the balance expires it
    const [p] = await withSystem((tx) => tx<{ interviews_expired: number; expired_at: Date | null }[]>`select interviews_expired, expired_at from purchases where stripe_session_id = ${sid}`);
    expect(p).toMatchObject({ interviews_expired: expected });
    expect(p.expired_at).not.toBeNull();
    // Running it again does nothing more.
    expect(await withSystem((tx) => expirePurchases(tx, orgId))).toBe(0);
    expect((await getQuotaStatus(orgId)).remaining).toBe(r0 - expected);
  });

  it("only owners and admins can buy (route permission)", async () => {
    const { can } = await import("@/lib/auth/permissions");
    expect(can("owner", "billing:manage")).toBe(true);
    expect(can("recruiter", "billing:manage")).toBe(false);
    expect(can("viewer", "billing:manage")).toBe(false);
  });
});
