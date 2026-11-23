import "server-only";
import type Stripe from "stripe";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/session";
import { json, withOrg, withSystem, type Tx } from "@/lib/database/db";
import { env } from "@/lib/env";
import { LEGAL, TERMS_VERSION } from "@/lib/legal";
import { log } from "@/lib/logger";
import { money, quote, tierFor, tierName, type Pricing, type Quote } from "@/lib/pricing";
import { paymentsEnabled, stripe } from "@/lib/stripe";
import { purchaseRef } from "@/lib/purchase-ref";
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
  invoice_url: string | null; invoice_pdf: string | null; invoice_number: string | null; payment_method: string | null;
  /** What the buyer paid in their own currency, when Stripe converted it (minor units, e.g. paise). */
  local_amount?: number | null; local_currency?: string | null;
  paid_at: Date | null; expires_at: Date | null; expired_at: Date | null; created_at: Date; bought_by: string | null;
};


/** "Visa •••• 4242", or the payment type ("Link") for other methods. */
export function paymentMethodLabel(details: Stripe.Charge.PaymentMethodDetails | null | undefined): string | null {
  if (!details) return null;
  const card = details.card;
  const name = (s: string) => ({ amex: "American Express", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay" }[s] ?? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " "));
  if (card) return `${name(card.brand ?? "card")}${card.last4 ? ` •••• ${card.last4}` : ""}`;
  return details.type ? name(details.type) : null;
}

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

/** "Growth pack: $2.49 per interview (save 17%)". Shown on the payment page and the invoice. */
export function packLine(q: Pick<Quote, "qty" | "unitCents" | "savingPct">, pricing: Pricing): string {
  const i = pricing.tiers.findIndex((t) => t.min === tierFor(q.qty, pricing).min);
  return `${tierName(i)} pack: ${money(q.unitCents)} per interview${q.savingPct > 0 ? ` (save ${q.savingPct}%)` : ""}`;
}

const missing = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: string }).code === "resource_missing";

/**
 * The company's Stripe customer, so all its payments and invoices sit together in Stripe whoever buys.
 * Made on the first purchase and reused after. One the current Stripe account doesn't know (another
 * account, or test vs live) or that was deleted is replaced. The buyer becomes the customer's email, so
 * the receipt and invoice go to whoever paid. The company row is locked meanwhile, so two buyers at once
 * still make one customer.
 */
export async function stripeCustomerFor(auth: Pick<AuthContext, "orgId" | "email">): Promise<string> {
  return withSystem(async (tx) => {
    const [org] = await tx<{ name: string; stripe_customer_id: string | null }[]>`
      select name, stripe_customer_id from organizations where id = ${auth.orgId} for update`;
    if (!org) throw new ApiError(404, "Company not found");
    if (org.stripe_customer_id) {
      try {
        const c = await stripe().customers.retrieve(org.stripe_customer_id);
        if (!c.deleted) {
          if (c.email !== auth.email) await stripe().customers.update(c.id, { email: auth.email });
          return c.id;
        }
      } catch (err) {
        if (!missing(err)) throw err;
      }
    }
    const c = await stripe().customers.create({ name: org.name, email: auth.email, metadata: { organization_id: auth.orgId } });
    await tx`update organizations set stripe_customer_id = ${c.id} where id = ${auth.orgId}`;
    return c.id;
  });
}

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
      insert into purchases (organization_id, company_name, user_id, bought_by_name, bought_by_email, quantity, unit_cents, total_cents, terms_version)
      values (${auth.orgId}, ${auth.orgName}, ${auth.userId}, ${auth.name}, ${auth.email}, ${q.qty}, ${q.unitCents}, ${q.totalCents}, ${TERMS_VERSION})
      returning id`;
    await audit(tx, { orgId: auth.orgId, userId: auth.userId, action: "billing.checkout_started", entityType: "purchase", entityId: p.id, metadata: { quantity: q.qty, total_cents: q.totalCents, terms_version: TERMS_VERSION } });
    return p;
  });

  const app = env().APP_URL;
  const product = env().STRIPE_PRODUCT_ID;
  const meta = { purchase_id: purchase.id, organization_id: auth.orgId, reference: purchaseRef(purchase.id) };
  const pack = packLine(q, pricing);
  let session: Stripe.Checkout.Session;
  try {
    const customer = await stripeCustomerFor(auth);
    session = await stripe().checkout.sessions.create({
      mode: "payment",
      // Our price is in USD. Stripe shows and charges it in the buyer's own currency where it can (Adaptive
      // Pricing: Stripe's guaranteed rate, its conversion fee paid by the buyer); the session and payment stay
      // in USD, so our amount check and totals don't change. Where it can't, the buyer simply pays in USD.
      adaptive_pricing: { enabled: true },
      client_reference_id: purchase.id,
      customer,
      // The buyer's company name, billing address and (optional) tax ID go on the invoice and stay on the customer.
      customer_update: { name: "auto", address: "auto" },
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      line_items: [{
        quantity: q.qty,
        price_data: {
          currency: "usd",
          // The price is always ours (tiers and company prices); the Stripe Product only files the sale.
          unit_amount: q.unitCents,
          ...(product ? { product } : { product_data: { name: "AI interviews", description: `AI interviews on PickMyHire.ai, valid for ${VALID_MONTHS} months` } }),
        },
      }],
      custom_text: { submit: { message: `${pack}. Interviews are valid for ${VALID_MONTHS} months.` } },
      // A paid invoice for the company's records, alongside Stripe's receipt.
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `${q.qty} AI interviews on PickMyHire.ai, valid for ${VALID_MONTHS} months. ${pack}.`,
          metadata: meta,
        },
      },
      metadata: meta,
      payment_intent_data: { metadata: meta, description: `PickMyHire.ai: ${q.qty} AI interviews (${auth.orgName}), ${pack}, ref ${purchaseRef(purchase.id)}` },
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

/** What the buyer paid in their own currency, when Stripe converted it; null when they paid in USD. */
export function localPaid(session: Pick<Stripe.Checkout.Session, "presentment_details" | "currency">): { amount: number; currency: string } | null {
  const d = session.presentment_details;
  if (!d?.presentment_currency || d.presentment_amount == null) return null;
  const currency = d.presentment_currency.toLowerCase();
  return currency === session.currency?.toLowerCase() ? null : { amount: d.presentment_amount, currency };
}

export type FulfilResult = { status: "paid"; quantity: number; added: boolean; purchaseId: string } | { status: "pending" } | { status: "unknown" };

/**
 * Add a paid purchase's interviews to the company, once. Safe to call any number of times, from the
 * webhook or when the buyer comes back. `orgId` limits it to one company (the buyer's return).
 */
export async function fulfilCheckout(sessionId: string, orgId?: string): Promise<FulfilResult> {
  const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge", "invoice"] });
  const purchaseId = session.metadata?.purchase_id ?? session.client_reference_id;
  if (!purchaseId || (orgId && session.metadata?.organization_id !== orgId)) return { status: "unknown" };
  if (session.payment_status !== "paid") return { status: "pending" };
  const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const charge = intent && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const invoice = typeof session.invoice === "object" ? session.invoice : null;
  const local = localPaid(session);

  const done = await withSystem(async (tx) => {
    const [p] = await tx<{ id: string; organization_id: string | null; company_name: string | null; user_id: string | null; quantity: number; total_cents: number; currency: string; status: PurchaseStatus }[]>`
      select id, organization_id, company_name, user_id, quantity, total_cents, currency, status from purchases where id = ${purchaseId} for update`;
    if (!p || (orgId && p.organization_id !== orgId)) return { status: "unknown" as const };
    const ref = purchaseRef(p.id);
    if (!["pending", "failed", "expired"].includes(p.status)) {
      // Already added. Keep the invoice links if the first visit came before Stripe made the invoice.
      if (invoice) await tx`update purchases set stripe_invoice_id = ${invoice.id}, invoice_url = ${invoice.hosted_invoice_url ?? null}, invoice_pdf = ${invoice.invoice_pdf ?? null},
          invoice_number = ${invoice.number ?? null}
        where id = ${p.id} and invoice_url is null`;
      if (local) await tx`update purchases set local_amount = ${local.amount}, local_currency = ${local.currency} where id = ${p.id} and local_currency is null`;
      return { status: "paid" as const, quantity: p.quantity, added: false, purchaseId: p.id };
    }
    // Never add interviews for a payment that doesn't match what we asked for.
    if (session.amount_total !== p.total_cents || session.currency !== p.currency) {
      log.error("billing.amount_mismatch", { purchaseId: p.id, expected: p.total_cents, got: session.amount_total, currency: session.currency });
      await platformAudit(tx, { adminId: null, action: "billing.amount_mismatch", targetType: "organization", targetId: p.organization_id, details: { company: p.company_name, reference: ref, expected: money(p.total_cents), got: money(session.amount_total ?? 0) } });
      return { status: "unknown" as const };
    }
    const paidFields = tx`
      status = 'paid', paid_at = now(), stripe_session_id = ${session.id}, stripe_payment_intent = ${intent?.id ?? null},
      receipt_url = ${charge?.receipt_url ?? null},
      stripe_invoice_id = ${invoice?.id ?? null}, invoice_url = ${invoice?.hosted_invoice_url ?? null}, invoice_pdf = ${invoice?.invoice_pdf ?? null},
      invoice_number = ${invoice?.number ?? null}, payment_method = ${paymentMethodLabel(charge?.payment_method_details)},
      local_amount = ${local?.amount ?? null}, local_currency = ${local?.currency ?? null}`;
    if (!p.organization_id) {
      // Paid after the company was deleted: keep the record (so it can be refunded) but there's nowhere to add interviews.
      await tx`update purchases set ${paidFields} where id = ${p.id}`;
      log.error("billing.paid_company_deleted", { purchaseId: p.id });
      await platformAudit(tx, { adminId: null, action: "billing.paid_company_deleted", targetType: "purchase", targetId: p.id, details: { company: p.company_name, reference: ref, total: money(p.total_cents) } });
      return { status: "unknown" as const };
    }
    const [org] = await tx<{ name: string; plan: string; interview_quota: number | null }[]>`
      select name, plan, interview_quota from organizations where id = ${p.organization_id} for update`;
    await tx`
      update purchases set ${paidFields}, expires_at = now() + make_interval(months => ${VALID_MONTHS}), interviews_added = quantity
      where id = ${p.id}`;
    // A trial company that buys becomes a paying company: its trial end date no longer applies.
    await tx`
      update organizations set interview_quota = interview_quota + ${p.quantity}, plan = 'standard', trial_ends_at = null
      where id = ${p.organization_id} and interview_quota is not null`;
    const [{ waiting }] = await tx<{ waiting: number }[]>`
      select count(*)::int as waiting from interviews where organization_id = ${p.organization_id} and held_at is not null
        and status::text = any(${WAITING_STATUSES}) and (token_expires_at is null or token_expires_at > now())`;
    await audit(tx, { orgId: p.organization_id, userId: p.user_id, action: "billing.purchased", entityType: "purchase", entityId: p.id, metadata: { quantity: p.quantity, total_cents: p.total_cents, was_trial: org?.plan === "trial" } });
    await platformAudit(tx, { adminId: null, action: "company.purchased", targetType: "organization", targetId: p.organization_id, details: { company: org?.name, reference: ref, quantity: p.quantity, total: money(p.total_cents), was_trial: org?.plan === "trial" } });
    const people = await tx<{ id: string }[]>`
      select u.id from organization_members m join users u on u.id = m.user_id
      where m.organization_id = ${p.organization_id} and u.disabled_at is null and (m.role in ('owner', 'admin') or u.id = ${p.user_id})`;
    for (const u of people) {
      await tx`insert into notifications (organization_id, user_id, type, payload)
        values (${p.organization_id}, ${u.id}, 'billing.purchased', ${json({ quantity: String(p.quantity), total: money(p.total_cents), waiting: String(waiting) })})`;
    }
    return { status: "paid" as const, quantity: p.quantity, added: true, purchaseId: p.id };
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
    const [p] = await tx<{ id: string; organization_id: string | null; company_name: string | null; quantity: number; total_cents: number; refunded_cents: number; interviews_added: number; interviews_expired: number; status: PurchaseStatus }[]>`
      select id, organization_id, company_name, quantity, total_cents, refunded_cents, interviews_added, interviews_expired, status
      from purchases where stripe_payment_intent = ${intentId} for update`;
    if (!p || charge.amount_refunded <= p.refunded_cents) return;
    const { refunded, keep, takeBack, full } = refundShare(p, charge.amount_refunded);
    const ref = purchaseRef(p.id);
    if (!p.organization_id) {
      // The company was deleted: just record the refund (there's no balance to take interviews from).
      await tx`update purchases set refunded_cents = ${refunded}, interviews_added = ${keep}, status = ${full ? "refunded" : "partially_refunded"} where id = ${p.id}`;
      await platformAudit(tx, { adminId: null, action: "company.refunded", targetType: "purchase", targetId: p.id, details: { company: p.company_name, reference: ref, refunded: money(refunded), company_deleted: true } });
      return;
    }
    const q = await readQuota(tx, p.organization_id, { lock: true });
    const removed = q.remaining === null ? 0 : Math.min(takeBack, Math.max(0, q.remaining));
    if (removed) await tx`update organizations set interview_quota = interview_quota - ${removed} where id = ${p.organization_id} and interview_quota is not null`;
    const status = full ? "refunded" : "partially_refunded";
    await tx`update purchases set refunded_cents = ${refunded}, interviews_added = ${keep}, status = ${status} where id = ${p.id}`;
    await audit(tx, { orgId: p.organization_id, actorType: "system", action: "billing.refunded", entityType: "purchase", entityId: p.id, metadata: { refunded_cents: refunded, interviews_removed: removed, already_used: takeBack - removed } });
    await platformAudit(tx, { adminId: null, action: "company.refunded", targetType: "organization", targetId: p.organization_id, details: { company: p.company_name, reference: ref, refunded: money(refunded), interviews_removed: removed, already_used: takeBack - removed } });
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
export async function listPurchases(orgId: string, opts: { all?: boolean } = {}): Promise<(PurchaseRow & { buyer_email: string | null })[]> {
  return withOrg(orgId, (tx) => tx<(PurchaseRow & { buyer_email: string | null })[]>`
    select p.id, p.quantity, p.unit_cents, p.total_cents, p.currency, p.status, p.interviews_added, p.interviews_expired, p.refunded_cents,
      p.receipt_url, p.invoice_url, p.invoice_pdf, p.invoice_number, p.payment_method, p.local_amount, p.local_currency, p.paid_at, p.expires_at, p.expired_at, p.created_at, coalesce(u.name, p.bought_by_name) as bought_by,
      coalesce(p.bought_by_email, u.email) as buyer_email
    from purchases p left join users u on u.id = p.user_id
    where p.organization_id = ${orgId} ${opts.all ? tx`` : tx`and p.status in ('paid', 'refunded', 'partially_refunded')`}
    order by p.created_at desc limit ${opts.all ? 300 : 100}`);
}

export type PurchaseDetails = PurchaseRow & { reference: string; buyer_email: string | null };

/** One of the company's purchases, for the "Payment successful" dialog. */
export async function getPurchaseDetails(orgId: string, purchaseId: string): Promise<PurchaseDetails | null> {
  const [row] = await withOrg(orgId, (tx) => tx<(PurchaseRow & { buyer_email: string | null })[]>`
    select p.id, p.quantity, p.unit_cents, p.total_cents, p.currency, p.status, p.interviews_added, p.interviews_expired, p.refunded_cents,
      p.receipt_url, p.invoice_url, p.invoice_pdf, p.invoice_number, p.payment_method, p.local_amount, p.local_currency, p.paid_at, p.expires_at, p.expired_at, p.created_at,
      coalesce(u.name, p.bought_by_name) as bought_by, coalesce(p.bought_by_email, u.email) as buyer_email
    from purchases p left join users u on u.id = p.user_id
    where p.organization_id = ${orgId} and p.id = ${purchaseId}`);
  return row ? { ...row, reference: purchaseRef(row.id) } : null;
}

export type PurchaseDoc = "invoice" | "pdf" | "receipt";

/**
 * A working link to a purchase's invoice, invoice PDF or receipt. Stripe's links expire (receipts after
 * 30 days, invoices about 30 days after they're made), so ask Stripe for a fresh one each time; the
 * link saved at payment is the fallback if Stripe can't be reached. Only for the purchase's own company.
 */
export async function purchaseDocumentUrl(orgId: string, purchaseId: string, doc: PurchaseDoc): Promise<string | null> {
  const [p] = await withOrg(orgId, (tx) => tx<DocRow[]>`
    select stripe_invoice_id, stripe_payment_intent, invoice_url, invoice_pdf, receipt_url
    from purchases where organization_id = ${orgId} and id = ${purchaseId}`);
  return p ? freshDocumentUrl(p, purchaseId, doc) : null;
}

/** The same, for the platform admin: any company's purchase, including deleted companies. */
export async function adminPurchaseDocumentUrl(purchaseId: string, doc: PurchaseDoc): Promise<string | null> {
  const [p] = await withSystem((tx) => tx<DocRow[]>`
    select stripe_invoice_id, stripe_payment_intent, invoice_url, invoice_pdf, receipt_url from purchases where id = ${purchaseId}`);
  return p ? freshDocumentUrl(p, purchaseId, doc) : null;
}

type DocRow = { stripe_invoice_id: string | null; stripe_payment_intent: string | null; invoice_url: string | null; invoice_pdf: string | null; receipt_url: string | null };

async function freshDocumentUrl(p: DocRow, purchaseId: string, doc: PurchaseDoc): Promise<string | null> {
  const saved = doc === "invoice" ? p.invoice_url : doc === "pdf" ? p.invoice_pdf : p.receipt_url;
  if (!paymentsEnabled()) return saved;
  try {
    if (doc !== "receipt" && p.stripe_invoice_id) {
      const inv = await stripe().invoices.retrieve(p.stripe_invoice_id);
      const url = doc === "invoice" ? inv.hosted_invoice_url : inv.invoice_pdf;
      if (url) return url;
    }
    if (doc === "receipt" && p.stripe_payment_intent) {
      const intent = await stripe().paymentIntents.retrieve(p.stripe_payment_intent, { expand: ["latest_charge"] });
      const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
      if (charge?.receipt_url) return charge.receipt_url;
    }
  } catch (err) {
    log.warn("billing.document_link_failed", { purchaseId, doc, error: err instanceof Error ? err.message : String(err) });
  }
  return saved;
}

/** The company's Stripe customer, for the admin's "Open in Stripe" link. */
export async function getStripeCustomerId(orgId: string): Promise<string | null> {
  const [row] = await withSystem((tx) => tx<{ stripe_customer_id: string | null }[]>`select stripe_customer_id from organizations where id = ${orgId}`);
  return row?.stripe_customer_id ?? null;
}

// ---------------------------------------------------------------- platform admin: all payments

/**
 * The hex part of an order ID typed into search, however it's written: "PMH-D6C43DAF", "pmh d6c4",
 * "#D6C43DAF", or a full purchase id. Null when the text isn't one (4+ hex characters).
 */
export function orderIdSearch(q: string): string | null {
  const hex = q.trim().replace(/^#/, "").replace(/^pmh/i, "").replace(/[\s-]/g, "").toLowerCase();
  return /^[0-9a-f]{4,32}$/.test(hex) ? hex : null;
}

export const ADMIN_PAYMENTS_PAGE_SIZE = 50;
export type AdminPaymentFilter = "all" | "paid" | "refunded" | "deleted";
export type AdminPayment = PurchaseRow & {
  organization_id: string | null; company: string; reference: string; buyer_email: string | null; stripe_payment_intent: string | null;
};

/**
 * Every payment across companies (deleted ones too), newest first, with totals for the same filter.
 * `q` matches the company, buyer name or email, invoice number, or reference ("PMH-3F2A9C1E").
 */
export async function listAdminPayments(opts: { q?: string; filter?: AdminPaymentFilter; page?: number } = {}) {
  const q = (opts.q ?? "").trim().slice(0, 100);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const ref = orderIdSearch(q);
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  return withSystem(async (tx) => {
    const where = tx`p.status in ('paid', 'refunded', 'partially_refunded')
      ${opts.filter === "paid" ? tx`and p.status = 'paid'`
        : opts.filter === "refunded" ? tx`and p.status in ('refunded', 'partially_refunded')`
        : opts.filter === "deleted" ? tx`and p.organization_id is null` : tx``}
      ${q ? tx`and (coalesce(o.name, p.company_name) ilike ${like} or p.invoice_number ilike ${like}
        or coalesce(p.bought_by_email, u.email) ilike ${like} or coalesce(u.name, p.bought_by_name) ilike ${like}
        ${ref ? tx`or replace(p.id::text, '-', '') like ${`%${ref}%`}` : tx``})` : tx``}`;
    const rows = await tx<Omit<AdminPayment, "reference">[]>`
      select p.id, p.organization_id, coalesce(o.name, p.company_name, 'Deleted company') as company, p.quantity, p.unit_cents, p.total_cents,
        p.currency, p.status, p.interviews_added, p.interviews_expired, p.refunded_cents, p.receipt_url, p.invoice_url, p.invoice_pdf,
        p.invoice_number, p.payment_method, p.local_amount, p.local_currency, p.paid_at, p.expires_at, p.expired_at, p.created_at, p.stripe_payment_intent,
        coalesce(u.name, p.bought_by_name) as bought_by, coalesce(p.bought_by_email, u.email) as buyer_email
      from purchases p left join organizations o on o.id = p.organization_id left join users u on u.id = p.user_id
      where ${where}
      order by coalesce(p.paid_at, p.created_at) desc
      limit ${ADMIN_PAYMENTS_PAGE_SIZE + 1} offset ${(page - 1) * ADMIN_PAYMENTS_PAGE_SIZE}`;
    const [t] = await tx<{ count: number; paid: number; refunded: number }[]>`
      select count(*)::int as count, coalesce(sum(p.total_cents), 0)::float8 as paid, coalesce(sum(p.refunded_cents), 0)::float8 as refunded
      from purchases p left join organizations o on o.id = p.organization_id left join users u on u.id = p.user_id
      where ${where}`;
    return {
      rows: rows.slice(0, ADMIN_PAYMENTS_PAGE_SIZE).map((r) => ({ ...r, reference: purchaseRef(r.id) })),
      hasMore: rows.length > ADMIN_PAYMENTS_PAGE_SIZE,
      totals: { count: t.count, paid: t.paid, refunded: t.refunded, net: t.paid - t.refunded },
    };
  });
}

/** Every company's purchases, for the platform admin. */
export async function listAllPurchases(orgId?: string): Promise<(PurchaseRow & { company: string; organization_id: string | null })[]> {
  return withSystem((tx) => tx<(PurchaseRow & { company: string; organization_id: string | null })[]>`
    select p.id, p.organization_id, coalesce(o.name, p.company_name, 'Deleted company') as company, p.quantity, p.unit_cents, p.total_cents, p.currency, p.status, p.interviews_added,
      p.interviews_expired, p.refunded_cents, p.receipt_url, p.invoice_url, p.invoice_pdf, p.invoice_number, p.payment_method, p.local_amount, p.local_currency, p.paid_at, p.expires_at, p.expired_at, p.created_at, coalesce(u.name, p.bought_by_name) as bought_by
    from purchases p left join organizations o on o.id = p.organization_id left join users u on u.id = p.user_id
    where p.status in ('paid', 'refunded', 'partially_refunded') ${orgId ? tx`and p.organization_id = ${orgId}` : tx``}
    order by p.created_at desc limit 200`);
}
