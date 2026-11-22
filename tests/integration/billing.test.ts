import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { withSystem } from "@/lib/database/db";

// Runs against the local database with a fake Stripe (no network). Each run uses its own throwaway company.
const sessions = new Map<string, Partial<Stripe.Checkout.Session>>();
const created: Stripe.Checkout.SessionCreateParams[] = [];
// Fake Stripe customers; a customer id this "account" doesn't know answers like Stripe does (resource_missing).
const customers = new Map<string, { id: string; name: string; email: string; deleted?: boolean }>();
const customerCalls = { created: 0, updated: 0 };
vi.mock("@/lib/stripe", () => ({
  paymentsEnabled: () => true,
  paymentsTestMode: () => true,
  stripe: () => ({
    customers: {
      create: async (p: { name: string; email: string }) => {
        customerCalls.created++;
        const c = { id: `cus_test_${customers.size + 1}${Date.now().toString(36)}`, name: p.name, email: p.email };
        customers.set(c.id, c);
        return c;
      },
      retrieve: async (cid: string) => {
        const c = customers.get(cid);
        if (!c) throw Object.assign(new Error("No such customer"), { code: "resource_missing" });
        return c;
      },
      update: async (cid: string, p: { email: string }) => { customerCalls.updated++; customers.get(cid)!.email = p.email; return customers.get(cid); },
    },
    invoices: { retrieve: async (iid: string) => ({ id: iid, hosted_invoice_url: `https://invoice.stripe.com/fresh/${iid}`, invoice_pdf: `https://pay.stripe.com/fresh/${iid}.pdf` }) },
    paymentIntents: { retrieve: async (pid: string) => ({ id: pid, latest_charge: { receipt_url: `https://pay.stripe.com/receipts/fresh/${pid}` } }) },
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

const { adminPurchaseDocumentUrl, applyRefund, expirePurchases, fulfilCheckout, getPurchaseDetails, handleStripeEvent, listAdminPayments, orderIdSearch, listPurchases, packLine, paymentMethodLabel, purchaseDocumentUrl, startCheckout } = await import("@/lib/services/billing");
const { purchaseRef } = await import("@/lib/purchase-ref");
const { DEFAULT_PRICING, quote } = await import("@/lib/pricing");
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
    payment_intent: { id: `pi_${sessionId}`, latest_charge: { receipt_url: "https://pay.stripe.test/receipt", payment_method_details: { type: "card", card: { brand: "visa", last4: "4242" } } } } as unknown as Stripe.PaymentIntent,
    invoice: { id: `in_${sessionId}`, number: "PMH-0001", hosted_invoice_url: "https://invoice.stripe.test/i", invoice_pdf: "https://invoice.stripe.test/i.pdf" } as unknown as Stripe.Invoice,
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
    await tx`delete from purchases where organization_id = ${orgId} or company_name like ${`Billing Co ${id}%`} or company_name = 'Billing Co'`;
    // This test's payments and refunds also wrote platform audit entries: don't leave them in the admin log.
    await tx`delete from platform_audit_logs where details->>'company' like ${`Billing Co ${id}%`} or target_id = ${orgId}`;
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
    expect(await fulfilCheckout(sid, orgId)).toMatchObject({ status: "paid", quantity: 10, added: true });
    // The webhook and a page refresh arrive too: nothing more is added.
    expect(await fulfilCheckout(sid)).toMatchObject({ status: "paid", quantity: 10, added: false });
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

describe("company Stripe account: customer, invoice, pack details", () => {
  const storedCustomer = () => withSystem((tx) => tx<{ stripe_customer_id: string | null }[]>`select stripe_customer_id from organizations where id = ${orgId}`).then((r) => r[0].stripe_customer_id);

  it("names the pack and the saving", () => {
    expect(packLine(quote(50, DEFAULT_PRICING), DEFAULT_PRICING)).toBe("Growth pack: $2.49 per interview (save 17%)");
    expect(packLine(quote(20, DEFAULT_PRICING), DEFAULT_PRICING)).toBe("Starter pack: $2.99 per interview");
  });

  it("asks for the billing address and tax ID, makes an invoice, and shows the pack", async () => {
    await startCheckout(auth(), 50);
    const c = created[0];
    expect(c.customer).toMatch(/^cus_test_/);
    expect(c.customer_email).toBeUndefined();
    expect(c.billing_address_collection).toBe("required");
    expect(c.tax_id_collection).toEqual({ enabled: true });
    expect(c.customer_update).toEqual({ name: "auto", address: "auto" });
    expect(c.invoice_creation?.enabled).toBe(true);
    expect(c.invoice_creation?.invoice_data?.description).toContain("Growth pack: $2.49 per interview (save 17%)");
    expect(JSON.stringify(c.custom_text)).toContain("Growth pack");
    expect(c.line_items![0].price_data!.unit_amount).toBe(249);
  });

  it("makes one Stripe customer per company and reuses it", async () => {
    const before = customerCalls.created;
    await startCheckout(auth(), 10);
    await startCheckout(auth(), 10);
    expect(customerCalls.created - before).toBeLessThanOrEqual(1);
    expect(created[0].customer).toBe(created[1].customer);
    expect(await storedCustomer()).toBe(created[0].customer);
  });

  it("replaces a customer the current Stripe account doesn't know (another account, or test vs live)", async () => {
    await withSystem((tx) => tx`update organizations set stripe_customer_id = 'cus_from_old_account' where id = ${orgId}`);
    await startCheckout(auth(), 10);
    expect(created[0].customer).not.toBe("cus_from_old_account");
    expect(await storedCustomer()).toBe(created[0].customer);
  });

  it("sends the receipt to whoever buys", async () => {
    await startCheckout(auth(), 10);
    const cid = created[0].customer as string;
    customers.get(cid)!.email = "someone-else@billing.test";
    await startCheckout(auth(), 10);
    expect(customers.get(cid)!.email).toBe(auth().email);
  });

  it("gives each purchase a short reference and names the card", () => {
    expect(purchaseRef("3f2a9c1e-0000-4000-8000-000000000000")).toBe("PMH-3F2A9C1E");
    expect(paymentMethodLabel({ type: "card", card: { brand: "visa", last4: "4242" } } as never)).toBe("Visa •••• 4242");
    expect(paymentMethodLabel({ type: "card", card: { brand: "amex", last4: "0005" } } as never)).toBe("American Express •••• 0005");
    expect(paymentMethodLabel({ type: "link" } as never)).toBe("Link");
    expect(paymentMethodLabel(null)).toBeNull();
  });

  it("puts the reference on the Stripe payment so it can be searched there", async () => {
    await startCheckout(auth(), 10);
    const ref = created[0].metadata!.reference as string;
    expect(ref).toBe(purchaseRef(created[0].metadata!.purchase_id as string));
    expect(created[0].payment_intent_data?.description).toContain(ref);
  });

  it("returns the paid purchase's details for the success dialog, only to its own company", async () => {
    const sid = await buy(10);
    const r = await fulfilCheckout(sid);
    expect(r.status).toBe("paid");
    const purchaseId = (r as { purchaseId: string }).purchaseId;
    const d = await getPurchaseDetails(orgId, purchaseId);
    expect(d).toMatchObject({ quantity: 10, invoice_number: "PMH-0001", payment_method: "Visa •••• 4242", buyer_email: auth().email, reference: purchaseRef(purchaseId) });
    expect(await getPurchaseDetails("00000000-0000-4000-8000-000000000000", purchaseId)).toBeNull();
  });

  it("stores the invoice links with the paid purchase", async () => {
    const sid = await buy(10);
    await fulfilCheckout(sid);
    const [row] = await withSystem((tx) => tx<{ stripe_invoice_id: string; invoice_url: string; invoice_pdf: string }[]>`
      select stripe_invoice_id, invoice_url, invoice_pdf from purchases where stripe_session_id = ${sid}`);
    expect(row).toMatchObject({ stripe_invoice_id: `in_${sid}`, invoice_url: "https://invoice.stripe.test/i", invoice_pdf: "https://invoice.stripe.test/i.pdf" });
  });
});

describe("people leaving, links expiring", () => {
  it("opens invoices and receipts with a fresh Stripe link, only for the purchase's own company", async () => {
    const sid = await buy(10);
    const r = await fulfilCheckout(sid) as { purchaseId: string };
    expect(await purchaseDocumentUrl(orgId, r.purchaseId, "invoice")).toBe(`https://invoice.stripe.com/fresh/in_${sid}`);
    expect(await purchaseDocumentUrl(orgId, r.purchaseId, "pdf")).toBe(`https://pay.stripe.com/fresh/in_${sid}.pdf`);
    expect(await purchaseDocumentUrl(orgId, r.purchaseId, "receipt")).toBe(`https://pay.stripe.com/receipts/fresh/pi_${sid}`);
    expect(await purchaseDocumentUrl("00000000-0000-4000-8000-000000000000", r.purchaseId, "invoice")).toBeNull();
  });

  it("keeps who paid when the buyer leaves the company or their account is deleted", async () => {
    // A second admin buys, then is removed from the company and their account deleted.
    const leaverId = await withSystem(async (tx) => {
      const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`leaver-${id}@billing.test`}, 'Leaver', 'x') returning id`;
      await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${u.id}, 'admin')`;
      return u.id;
    });
    const leaver = { ...auth(), userId: leaverId, email: `leaver-${id}@billing.test`, name: "Leaver" };
    const { url } = await startCheckout(leaver, 10);
    const sid = url.split("/").pop()!;
    const line = created.at(-1)!.line_items![0];
    sessions.set(sid, { ...sessions.get(sid)!, payment_status: "paid", amount_total: (line.price_data!.unit_amount as number) * (line.quantity as number), currency: "usd" });
    const r = await fulfilCheckout(sid) as { purchaseId: string };
    await withSystem(async (tx) => {
      await tx`delete from organization_members where user_id = ${leaverId}`;
      await tx`delete from users where id = ${leaverId}`;
    });
    // The company keeps the interviews and the record of who paid.
    const row = (await listPurchases(orgId)).find((p) => p.id === r.purchaseId)!;
    expect(row).toMatchObject({ status: "paid", bought_by: "Leaver", interviews_added: 10 });
    expect((await getPurchaseDetails(orgId, r.purchaseId))!.buyer_email).toBe(`leaver-${id}@billing.test`);
  });
});

describe("admin payments, and a company being deleted", () => {
  it("lists payments with totals and finds one by reference, invoice number or buyer", async () => {
    const sid = await buy(10);
    const r = await fulfilCheckout(sid) as { purchaseId: string };
    const ref = purchaseRef(r.purchaseId);
    for (const q of [ref, ref.slice(4).toLowerCase(), "PMH-0001", `owner-${id}@billing.test`, `Billing Co`]) {
      const { rows } = await listAdminPayments({ q });
      expect(rows.some((p) => p.id === r.purchaseId), q).toBe(true);
    }
    const all = await listAdminPayments({ q: ref });
    expect(all.totals).toMatchObject({ count: 1, paid: 2990, refunded: 0, net: 2990 });
    expect((await listAdminPayments({ q: "PMH-FFFFFFFF" })).rows).toHaveLength(0);
  });

  it("keeps a deleted company's payments, still refundable, and doesn't add interviews to nowhere", async () => {
    // A throwaway company buys, then is deleted.
    const [o] = await withSystem((tx) => tx<{ id: string }[]>`
      insert into organizations (name, slug, interview_quota, quota_counted_from) values (${`Billing Co ${id} gone`}, ${`billing-gone-${id}`}, 3, now()) returning id`);
    const gone = { ...auth(), orgId: o.id, orgName: `Billing Co ${id} gone` };
    const { url } = await startCheckout(gone, 10);
    const sid = url.split("/").pop()!;
    const line = created.at(-1)!.line_items![0];
    const paid = { payment_status: "paid" as const, amount_total: (line.price_data!.unit_amount as number) * (line.quantity as number), currency: "usd",
      payment_intent: { id: `pi_${sid}`, latest_charge: null } as unknown as Stripe.PaymentIntent };
    sessions.set(sid, { ...sessions.get(sid)!, ...paid });
    const r = await fulfilCheckout(sid) as { purchaseId: string };
    await withSystem((tx) => tx`delete from organizations where id = ${o.id}`);

    const { rows } = await listAdminPayments({ filter: "deleted", q: purchaseRef(r.purchaseId) });
    expect(rows[0]).toMatchObject({ organization_id: null, company: `Billing Co ${id} gone`, status: "paid" });
    // A refund in Stripe afterwards is still recorded.
    await applyRefund({ payment_intent: `pi_${sid}`, amount_refunded: 2990 } as unknown as Stripe.Charge);
    expect((await listAdminPayments({ q: purchaseRef(r.purchaseId) })).rows[0].status).toBe("refunded");

    // A checkout opened before the deletion and paid after it: recorded, no interviews anywhere, no crash.
    const [o2] = await withSystem((tx) => tx<{ id: string }[]>`
      insert into organizations (name, slug, interview_quota, quota_counted_from) values (${`Billing Co ${id} late`}, ${`billing-late-${id}`}, 3, now()) returning id`);
    const late = await startCheckout({ ...auth(), orgId: o2.id, orgName: `Billing Co ${id} late` }, 10);
    const sid2 = late.url.split("/").pop()!;
    await withSystem((tx) => tx`delete from organizations where id = ${o2.id}`);
    sessions.set(sid2, { ...sessions.get(sid2)!, ...paid, payment_intent: { id: `pi_${sid2}`, latest_charge: null } as unknown as Stripe.PaymentIntent });
    expect(await fulfilCheckout(sid2)).toEqual({ status: "unknown" });
    const after = (await listAdminPayments({ q: `Billing Co ${id} late` })).rows[0];
    expect(after).toMatchObject({ status: "paid", organization_id: null, interviews_added: 0 });
  });
});

describe("admin: order ID search and documents", () => {
  it("reads an order ID however it's typed", () => {
    for (const q of ["PMH-D6C43DAF", "pmh-d6c43daf", "PMH D6C43DAF", " #D6C43DAF ", "d6c43daf", "PMH-D6C4"]) expect(orderIdSearch(q), q).toMatch(/^d6c4/);
    for (const q of ["", "PMH-", "abc", "Northwind", "pcvlugti-0001"]) expect(orderIdSearch(q), q).toBeNull();
  });

  it("finds a payment by part of its ID, in any style, and opens its documents for the admin", async () => {
    const sid = await buy(10);
    const r = await fulfilCheckout(sid) as { purchaseId: string };
    const ref = purchaseRef(r.purchaseId);
    for (const q of [ref.toLowerCase(), ref.replace("-", " "), ref.slice(4, 10), `#${ref.slice(4)}`]) {
      expect((await listAdminPayments({ q })).rows.some((p) => p.id === r.purchaseId), q).toBe(true);
    }
    expect(await adminPurchaseDocumentUrl(r.purchaseId, "invoice")).toBe(`https://invoice.stripe.com/fresh/in_${sid}`);
    expect(await adminPurchaseDocumentUrl("00000000-0000-4000-8000-000000000000", "invoice")).toBeNull();
  });
});
