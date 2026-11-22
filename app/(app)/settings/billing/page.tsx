import Link from "next/link";
import { ArrowRight, CheckCircle2, Info, XCircle } from "lucide-react";
import { BillingTabs } from "@/components/billing/purchase-moves";
import { PurchaseAccess } from "@/components/billing/purchase-access";
import { hasPurchaseAccess } from "@/lib/purchase-access";
import { BillingPlans } from "@/components/billing/billing-plans";
import { FormCard } from "@/components/settings/form-card";
import { requireAuth } from "@/lib/auth/session";
import { DEMO_URL } from "@/lib/marketing";
import { money } from "@/lib/pricing";
import { getPricingFor } from "@/lib/services/pricing";
import { getQuotaStatus } from "@/lib/services/quota";
import { fulfilCheckout, getPurchaseDetails, listPurchases, VALID_MONTHS, type FulfilResult } from "@/lib/services/billing";
import { PaymentSuccessDialog } from "@/components/billing/payment-success-dialog";
import { paymentsEnabled, paymentsTestMode } from "@/lib/stripe";
import { log } from "@/lib/logger";

export const metadata = { title: "Billing" };

export default async function BillingPage(props: PageProps<"/settings/billing">) {
  const auth = await requireAuth("billing:manage");
  const params = await props.searchParams;
  const raw = params.pack;
  // Back from Stripe: add the interviews now (the webhook does the same; whichever comes first wins, once).
  const sessionId = typeof params.purchase === "string" && /^cs_(test|live)_[A-Za-z0-9]+$/.test(params.purchase) ? params.purchase : null;
  let paid: FulfilResult | null = null;
  if (sessionId && paymentsEnabled()) {
    paid = await fulfilCheckout(sessionId, auth.orgId).catch((err) => {
      log.warn("billing.return_check_failed", { error: err instanceof Error ? err.message : String(err) });
      return { status: "pending" as const };
    });
  }
  const details = paid?.status === "paid" ? await getPurchaseDetails(auth.orgId, paid.purchaseId) : null;
  const cancelled = params.cancelled === "1";
  const [quota, { pricing, custom }, purchases, canBuy] = await Promise.all([getQuotaStatus(auth.orgId), getPricingFor(auth.orgId), listPurchases(auth.orgId), hasPurchaseAccess()]);
  const left = quota.remaining;
  // "?pack=50": chosen on the pricing page; shown ready to buy.
  const pack = typeof raw === "string" && /^\d{1,5}$/.test(raw) && Number(raw) >= pricing.tiers[0].min ? Number(raw) : null;
  const last = purchases[0];
  return (
    <>
      <BillingTabs active="buy" count={purchases.length || undefined} />
      {details && <PaymentSuccessDialog p={details} company={auth.orgName} balance={left} waiting={quota.onHold} />}
      {paid?.status === "paid" && (
        <p className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span><b>Payment received. {paid.quantity} interviews added</b> to your account, valid for {VALID_MONTHS} months. A receipt is on its way to your email.{quota.onHold > 0 ? ` ${quota.onHold} ${quota.onHold === 1 ? "candidate is" : "candidates are"} waiting: let them know they can start with the same link.` : ""}</span>
        </p>
      )}
      {paid?.status === "pending" && (
        <p className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span><b>Your payment is being confirmed.</b> Your interviews will be added in a moment. Refresh this page shortly.</span>
        </p>
      )}
      {cancelled && !paid && (
        <p className="flex items-start gap-2.5 rounded-xl border bg-muted/50 px-4 py-3 text-sm">
          <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>Payment cancelled. Nothing was charged.</span>
        </p>
      )}
      {/* Balance and buying together, compact, so the slider and its Buy button fit on the first screen. */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h2 className="font-semibold">{canBuy ? "Buy interviews" : "Your interviews"}</h2>
            {custom && canBuy && <p className="text-sm text-muted-foreground">Your company has its own prices.</p>}
          </div>
          <dl aria-label="Your interviews" className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
            {[
              ["available", left === null ? "Unlimited" : left],
              ["waiting or running", quota.inProgress],
              ["used", quota.used],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex items-baseline gap-1.5">
                <dd className={`text-lg font-semibold tabular ${k === "available" && left === 0 ? "text-destructive" : ""}`}>{v}</dd>
                <dt className="text-muted-foreground">{k}</dt>
              </div>
            ))}
          </dl>
        </div>
        {quota.plan === "trial" && quota.trialDaysLeft !== null && (
          <p className="text-xs text-muted-foreground">Free trial · {quota.trialEnded ? "ended" : `${quota.trialDaysLeft} ${quota.trialDaysLeft === 1 ? "day" : "days"} left`}. Interviews you buy don&apos;t expire with the trial.</p>
        )}
        {quota.onHold > 0 && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <b>{quota.onHold} {quota.onHold === 1 ? "candidate tried" : "candidates tried"} to start</b> while you had no interviews left. Once you add interviews, their same link works: let them know they can start. You&apos;ll find them in the bell notifications.
          </p>
        )}
        {canBuy ? <BillingPlans pricing={pricing} contactHref={DEMO_URL} initialQty={pack} payments={paymentsEnabled() ? { validMonths: VALID_MONTHS, testMode: paymentsTestMode() } : null} /> : <PurchaseAccess contactHref={DEMO_URL} />}
      </section>

      <FormCard title="How interviews are counted">
        <ul className="grid gap-x-8 gap-y-2.5 text-sm md:grid-cols-2">
          <li className="flex gap-2"><Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /><span>An interview of up to <b>{pricing.minutesPerInterview} minutes</b> counts as <b>1</b>. A longer template counts as <b>2</b> per candidate (you confirm this when you save it). Templates can be up to {pricing.maxMinutes} minutes.</span></li>
          <li className="flex gap-2"><Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /><span>An interview is used when the candidate starts it. If it ends before they answer anything, it&apos;s given back automatically.</span></li>
          <li className="flex gap-2"><Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /><span>Recordings are kept for <b>{pricing.recordingMonths} months</b>. Reports, transcripts and scores stay while your account is active.</span></li>
          <li className="flex gap-2"><Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /><span>Interviews you buy are valid for {VALID_MONTHS} months.{canBuy ? ` Prices in USD; from ${money(pricing.tiers[pricing.tiers.length - 1].cents)} per interview.` : ""}</span></li>
        </ul>
        {last && (
          <p className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm text-muted-foreground">
            <span>Last purchase: {last.quantity} interviews · {money(last.total_cents)}</span>
            <Link href="/settings/billing/history" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">See purchase history<ArrowRight className="size-3.5" aria-hidden /></Link>
          </p>
        )}
      </FormCard>
    </>
  );
}
