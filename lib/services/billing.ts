import "server-only";
import type Stripe from "stripe";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/session";
import { json, withOrg, withSystem, type Tx } from "@/lib/database/db";
import { env } from "@/lib/env";
import { LEGAL, TERMS_VERSION } from "@/lib/legal";
import { log } from "@/lib/logger";
import { money, quote } from "@/lib/pricing";
import { paymentsEnabled, stripe } from "@/lib/stripe";
import { platformAudit } from "./platform";
import { getPricingFor } from "./pricing";
import { readQuota, WAITING_STATUSES } from "./quota";

// Buying interviews online with Stripe Checkout.
//
// The price is always worked out here, from the company's own prices: the browser only says how many.
// A purchase adds its interviews once it's paid, exactly once, whether Stripe's webhook or the buyer's
// return to Billing gets here first. Purchased interviews are valid for VALID_MONTHS; refunds and expiry
// take back what's left of a purchase (never more than the company has left).

export const VALID_MONTHS = LEGAL.validityMonths ?? 12;
/** Statuses where a purchase's interviews count (until it expires). */
const ACTIVE = ["paid", "partially_refunded"];

export type PurchaseStatus = "pending" | "paid" | "failed" | "expired" | "refunded" | "partially_refunded";
export type PurchaseRow = {
  id: string; quantity: number; unit_cents: number; total_cents: number; currency: string; status: PurchaseStatus;
  interviews_added: number; interviews_expired: number; refunded_cents: number; receipt_url: string | null;
  paid_at: Date | null; expires_at: Date | null; expired_at: Date | null; created_at: Date; bought_by: string | null;
};

// ---------------------------------------------------------------- maths (pure, unit-tested)

/** After a refund: how many of the purchase's interviews are still paid for, and how many to take back. */
export function refundShare(p: { quantity: number; total_cents: number; interviews_added: number; interviews_expired: number }, refundedCents: number) {
  const refunded = Math.min(Math.max(0, refundedCents), p.total_cents);
  const keep = Math.min(p.interviews_added, Math.max(0, Math.floor((p.quantity * (p.total_cents - refunded)) / p.total_cents) - p.interviews_expired));
  return { refunded, keep, takeBack: p.interviews_added - keep, full: refunded >= p.total_cents };
}

/**
 * Unused interviews of purchases that just expired (oldest first). Older interviews are used first, so
 * what's left of an expiring purchase is the balance beyond the purchases that are still valid after it.
 */
export function expiredUnused(remaining: number, stillValid: number, due: number[]): number[] {
  let left = Math.max(0, remaining);
  return due.map((added, i) => {
    const newer = stillValid + due.slice(i + 1).reduce((a, x) => a + x, 0);
    const unused = Math.min(added, Math.max(0, left - newer));
    left -= unused;
    return unused;
  });
}

// ---------------------------------------------------------------- checkout

/** Create a Stripe Checkout page for `quantity` interviews at the company's price. Returns its URL. */
export async function startCheckout(auth: AuthContext, quantity: number): Promise<{ url: string }> {
  if (!paymentsEnabled()) throw new ApiError(503, "Online payment isn't available yet. Book a call or contact support and we'll add interviews for you.", "payments_off");
  const { pricing } = await getPricingFor(auth.orgId);
  const q = quote(quantity, pricing);
  if (q.qty !== quantity || q.belowMin) throw new ApiError(400, `Choose at least ${pricing.tiers[0].min} interviews.`, "below_minimum");
  if (q.contact) throw new ApiError(400, `For ${pricing.contactFrom} or more interviews, please talk to us for a custom price.`, "contact_us");

  const purchase = await withOrg(auth.orgId, async (tx) => {
    const [org] = await tx<{ interview_quota: number | null }[]>`select interview_quota from organizations where id = ${auth.orgId}`;
    if (!org) throw new ApiError(404, "Company not found");
    if (org.interview_quota === null) throw new ApiError(400, "Your plan already has unlimited interviews, so there's nothing to buy.", "unlimited");
    // Unfinished checkouts are harmless, but don't let one company open hundreds.
    const [{ open }] = await tx<{ open: number }[]>`
      select count(*)::int as open from purchases where organization_id = ${auth.orgId} and status = 'pending' and created_at > now() - interval '1 hour'`;
    if (open >= 20) throw new ApiError(429, "Too many payment attempts. Please wait a few minutes and try again.", "too_many_checkouts");
    const [p] = await tx<{ id: string }[]>`
      insert into purchases (organization_id, user_id, quantity, unit_cents, total_cents, terms_version)
      values (${auth.orgId}, ${auth.userId}, ${q.qty}, ${q.unitCents}, ${q.totalCents}, ${TERMS_VERSION})
      returning id`;
    await audit(tx, { orgId: auth.orgId, userId: auth.userId, action: "billing.checkout_started", entityType: "purchase", entityId: p.id, metadata: { quantity: q.qty, total_cents: q.totalCents, terms_version: TERMS_VERSION } });
    return p;
  });

  const app = env().APP_URL;
  const meta = { purchase_id: purchase.id, organization_id: auth.orgId };
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.create({
      mode: "payment",
      // Charge the exact USD price we show; no automatic conversion to the buyer's currency (and its fee).
      adaptive_pricing: { enabled: false },
      client_reference_id: purchase.id,
      customer_email: auth.email,
      line_items: [{
        quantity: q.qty,
        price_data: {
          currency: "usd",
          unit_amount: q.unitCents,
          product_data: { name: "AI interviews", description: `AI interviews on PickMyHire.ai, valid for ${VALID_MONTHS} months` },
        },
      }],
      metadata: meta,
      payment_intent_data: { metadata: meta, description: `PickMyHire.ai: ${q.qty} AI interviews (${auth.orgName})` },
      success_url: `${app}/settings/billing?purchase={CHECKOUT_SESSION_ID}`,
      cancel_url: `${app}/settings/billing?cancelled=1`,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    }, { idempotencyKey: `checkout-${purchase.id}` });
  } catch (err) {
    log.error("billing.checkout_failed", { purchaseId: purchase.id, error: err instanceof Error ? err.message : String(err) });
    await withOrg(auth.orgId, (tx) => tx`update purchases set status = 'failed' where id = ${purchase.id}`);
    throw new ApiError(502, "We couldn't open the payment page. Please try again in a moment.", "stripe_unavailable");
  }
  if (!session.url) throw new ApiError(502, "We couldn't open the payment page. Please try again in a moment.", "stripe_unavailable");
  await withOrg(auth.orgId, (tx) => tx`update purchases set stripe_session_id = ${session.id} where id = ${purchase.id}`);
  return { url: session.url };
}

// ---------------------------------------------------------------- paid

export type FulfilResult = { status: "paid"; quantity: number; added: boolean } | { status: "pending" } | { status: "unknown" };

/**
 * Add a paid purchase's interviews to the company, once. Safe to call any number of times, from the
 * webhook or when the buyer comes back. `orgId` limits it to one company (the buyer's return).
 */
export async function fulfilCheckout(sessionId: string, orgId?: string): Promise<FulfilResult> {
  const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge"] });
  const purchaseId = session.metadata?.purchase_id ?? session.client_reference_id;
  if (!purchaseId || (orgId && session.metadata?.organization_id !== orgId)) return { status: "unknown" };
  if (session.payment_status !== "paid") return { status: "pending" };
  const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const charge = intent && typeof intent.latest_charge === "object" ? intent.latest_charge : null;

  const done = await withSystem(async (tx) => {
    const [p] = await tx<{ id: string; organization_id: string; user_id: string | null; quantity: number; total_cents: number; currency: string; status: PurchaseStatus }[]>`
      select id, organization_id, user_id, quantity, total_cents, currency, status from purchases where id = ${purchaseId} for update`;
    if (!p || (orgId && p.organization_id !== orgId)) return { status: "unknown" as const };
    if (!["pending", "failed", "expired"].includes(p.status)) return { status: "paid" as const, quantity: p.quantity, added: false };
    // Never add interviews for a payment that doesn't match what we asked for.
    if (session.amount_total !== p.total_cents || session.currency !== p.currency) {
      log.error("billing.amount_mismatch", { purchaseId: p.id, expected: p.total_cents, got: session.amount_total, currency: session.currency });
      await platformAudit(tx, { adminId: null, action: "billing.amount_mismatch", targetType: "organization", targetId: p.organization_id, details: { purchase: p.id, expected: p.total_cents, got: session.amount_total } });
      return { status: "unknown" as const };
    }
    const [org] = await tx<{ name: string; plan: string; interview_quota: number | null }[]>`
      select name, plan, interview_quota from organizations where id = ${p.organization_id} for update`;
    await tx`
      update purchases set status = 'paid', paid_at = now(), expires_at = now() + make_interval(months => ${VALID_MONTHS}),
        interviews_added = quantity, stripe_session_id = ${session.id}, stripe_payment_intent = ${intent?.id ?? null},
        receipt_url = ${charge?.receipt_url ?? null}
      where id = ${p.id}`;
    // A trial company that buys becomes a paying company: its trial end date no longer applies.
    await tx`
      update organizations set interview_quota = interview_quota + ${p.quantity}, plan = 'standard', trial_ends_at = null
      where id = ${p.organization_id} and interview_quota is not null`;
    const [{ waiting }] = await tx<{ waiting: number }[]>`
      select count(*)::int as waiting from interviews where organization_id = ${p.organization_id} and held_at is not null
        and status::text = any(${WAITING_STATUSES}) and (token_expires_at is null or token_expires_at > now())`;
    await audit(tx, { orgId: p.organization_id, userId: p.user_id, action: "billing.purchased", entityType: "purchase", entityId: p.id, metadata: { quantity: p.quantity, total_cents: p.total_cents, was_trial: org?.plan === "trial" } });
    await platformAudit(tx, { adminId: null, action: "company.purchased", targetType: "organization", targetId: p.organization_id, details: { company: org?.name, quantity: p.quantity, total: money(p.total_cents), was_trial: org?.plan === "trial" } });
    const people = await tx<{ id: string }[]>`
      select u.id from organization_members m join users u on u.id = m.user_id
      where m.organization_id = ${p.organization_id} and u.disabled_at is null and (m.role in ('owner', 'admin') or u.id = ${p.user_id})`;
    for (const u of people) {
      await tx`insert into notifications (organization_id, user_id, type, payload)
        values (${p.organization_id}, ${u.id}, 'billing.purchased', ${json({ quantity: String(p.quantity), total: money(p.total_cents), waiting: String(waiting) })})`;
    }
    return { status: "paid" as const, quantity: p.quantity, added: true };
  });
  if (done.status === "paid" && done.added) log.info("billing.purchase_paid", { purchaseId, quantity: done.quantity });
  return done;
}

// ---------------------------------------------------------------- webhook

/** Handle one Stripe event (already signature-checked). Each event is handled once; a failure lets Stripe retry. */
export async function handleStripeEvent(event: Stripe.Event): Promise<"handled" | "duplicate" | "ignored"> {
  const relevant = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired", "charge.refunded"];
  if (!relevant.includes(event.type)) return "ignored";
  const fresh = await withSystem((tx) => tx`insert into stripe_events (id, type) values (${event.id}, ${event.type}) on conflict (id) do nothing returning id`);
  if (!fresh.length) return "duplicate";
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await fulfilCheckout(event.data.object.id);
        break;
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const s = event.data.object;
        const status = event.type === "checkout.session.expired" ? "expired" : "failed";
        await withSystem((tx) => tx`update purchases set status = ${status} where stripe_session_id = ${s.id} and status = 'pending'`);
        break;
      }
      case "charge.refunded":
        await applyRefund(event.data.object);
        break;
    }
    return "handled";
  } catch (err) {
    // Forget the event so Stripe's retry is handled again.
    await withSystem((tx) => tx`delete from stripe_events where id = ${event.id}`).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------- refunds

/**
 * A refund made in the Stripe dashboard: take back the refunded share of the purchase's interviews,
 * but never more than the company has left (interviews already used stay used).
 */
export async function applyRefund(charge: Stripe.Charge) {
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) return;
  await withSystem(async (tx) => {
    const [p] = await tx<{ id: string; organization_id: string; quantity: number; total_cents: number; refunded_cents: number; interviews_added: number; interviews_expired: number; status: PurchaseStatus }[]>`
      select id, organization_id, quantity, total_cents, refunded_cents, interviews_added, interviews_expired, status
      from purchases where stripe_payment_intent = ${intentId} for update`;
    if (!p || charge.amount_refunded <= p.refunded_cents) return;
    const { refunded, keep, takeBack, full } = refundShare(p, charge.amount_refunded);
    const q = await readQuota(tx, p.organization_id, { lock: true });
    const removed = q.remaining === null ? 0 : Math.min(takeBack, Math.max(0, q.remaining));
    if (removed) await tx`update organizations set interview_quota = interview_quota - ${removed} where id = ${p.organization_id} and interview_quota is not null`;
    const status = full ? "refunded" : "partially_refunded";
    await tx`update purchases set refunded_cents = ${refunded}, interviews_added = ${keep}, status = ${status} where id = ${p.id}`;
    await audit(tx, { orgId: p.organization_id, actorType: "system", action: "billing.refunded", entityType: "purchase", entityId: p.id, metadata: { refunded_cents: refunded, interviews_removed: removed, already_used: takeBack - removed } });
    await platformAudit(tx, { adminId: null, action: "company.refunded", targetType: "organization", targetId: p.organization_id, details: { purchase: p.id, refunded: money(refunded), interviews_removed: removed, already_used: takeBack - removed } });
  });
}

// ---------------------------------------------------------------- expiry

/**
 * Purchased interviews are valid for VALID_MONTHS. When a purchase expires, its unused interviews come
 * off the balance. Older interviews are used first: free and added interviews, then purchases from the
 * oldest. So what's left of an expiring purchase is the balance beyond the purchases still valid after it.
 * Cheap when nothing is due (an indexed lookup); runs before the balance is read or used.
 */
export async function expirePurchases(tx: Tx, orgId: string): Promise<number> {
  const due = await tx<{ id: string; interviews_added: number }[]>`
    select id, interviews_added from purchases
    where organization_id = ${orgId} and status = any(${ACTIVE}) and expired_at is null and expires_at <= now()
    order by expires_at for update`;
  if (!due.length) return 0;
  const q = await readQuota(tx, orgId, { lock: true });
  const [{ valid }] = await tx<{ valid: number }[]>`
    select coalesce(sum(interviews_added), 0)::int as valid from purchases
    where organization_id = ${orgId} and status = any(${ACTIVE}) and expired_at is null and expires_at > now()`;
  const unused = q.remaining === null ? due.map(() => 0) : expiredUnused(q.remaining, valid, due.map((p) => p.interviews_added));
  const total = unused.reduce((a, x) => a + x, 0);
  for (const [i, p] of due.entries()) {
    await tx`update purchases set expired_at = now(), interviews_expired = ${unused[i]}, interviews_added = interviews_added - ${unused[i]} where id = ${p.id}`;
  }
  if (total) await tx`update organizations set interview_quota = interview_quota - ${total} where id = ${orgId} and interview_quota is not null`;
  await audit(tx, { orgId, actorType: "system", action: "billing.interviews_expired", entityType: "organization", entityId: orgId, metadata: { purchases: due.length, interviews: total } });
  return total;
}

// ---------------------------------------------------------------- history

/** The company's purchases (paid, refunded). With `all`, unfinished checkouts (cancelled, failed, expired) too. */
export async function listPurchases(orgId: string, opts: { all?: boolean } = {}): Promise<PurchaseRow[]> {
  return withOrg(orgId, (tx) => tx<PurchaseRow[]>`
    select p.id, p.quantity, p.unit_cents, p.total_cents, p.currency, p.status, p.interviews_added, p.interviews_expired, p.refunded_cents,
      p.receipt_url, p.paid_at, p.expires_at, p.expired_at, p.created_at, u.name as bought_by
    from purchases p left join users u on u.id = p.user_id
    where p.organization_id = ${orgId} ${opts.all ? tx`` : tx`and p.status in ('paid', 'refunded', 'partially_refunded')`}
    order by p.created_at desc limit ${opts.all ? 300 : 100}`);
}

/** Every company's purchases, for the platform admin. */
export async function listAllPurchases(orgId?: string): Promise<(PurchaseRow & { company: string; organization_id: string })[]> {
  return withSystem((tx) => tx<(PurchaseRow & { company: string; organization_id: string })[]>`
    select p.id, p.organization_id, o.name as company, p.quantity, p.unit_cents, p.total_cents, p.currency, p.status, p.interviews_added,
      p.interviews_expired, p.refunded_cents, p.receipt_url, p.paid_at, p.expires_at, p.expired_at, p.created_at, u.name as bought_by
    from purchases p join organizations o on o.id = p.organization_id left join users u on u.id = p.user_id
    where p.status in ('paid', 'refunded', 'partially_refunded') ${orgId ? tx`and p.organization_id = ${orgId}` : tx``}
    order by p.created_at desc limit 200`);
}
