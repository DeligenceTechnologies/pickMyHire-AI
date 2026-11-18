import { LegalLinks } from "@/components/legal/legal-page";
import { Copyright } from "@/components/layout/logo";
import { PricingSections } from "@/components/pricing/sections";
import { SiteHeader } from "@/components/marketing/site-header";
import { getAppLink, getAuth } from "@/lib/auth/session";
import { getTrialSettings } from "@/lib/services/platform";
import { getPricing, getPricingFor } from "@/lib/services/pricing";
import { getQuotaStatus } from "@/lib/services/quota";

/**
 * The signed-in company's situation, so the pricing page shows what fits it:
 * free interviews still left, or only the buy options once they're used up.
 */
export type PricingAccount = { plan: "trial" | "standard"; /** null = no limit */ remaining: number | null; freeLeft: number; freeUsedUp: boolean };

/** Everything a public pricing page needs: prices, trial, the visitor's account, and where its buttons go. */
export async function getPricingPageData() {
  const [standard, trial, app, auth] = await Promise.all([getPricing(), getTrialSettings(), getAppLink(), getAuth()]);
  let pricing = standard;
  let account: PricingAccount | null = null;
  if (auth) {
    // A signed-in company sees its own prices (if the platform admin set any) and its balance.
    const [q, own] = await Promise.all([getQuotaStatus(auth.orgId), getPricingFor(auth.orgId)]);
    pricing = own.pricing;
    const onTrial = q.plan === "trial";
    const remaining = q.remaining === null ? null : Math.max(0, q.remaining);
    const freeLeft = onTrial && !q.trialEnded ? (remaining ?? 0) : 0;
    account = { plan: q.plan, remaining, freeLeft, freeUsedUp: onTrial && freeLeft === 0 };
  }
  const start = app ? { href: "/settings/billing", label: "Buy interviews" }
    : trial.enabled ? { href: "/signup", label: `Start with ${trial.interviews} free interviews` } : { href: "/#request-access", label: "Request access" };
  // A pack's button: straight to Billing when signed in, else to sign-up with the pack remembered.
  const packHref = app ? "/settings/billing" : trial.enabled ? "/signup" : null;
  const packLabel = app ? "Buy {n} interviews" : trial.enabled ? "Get {n} interviews" : "Request access";
  return { pricing, trial, app, account, start, packHref, packLabel };
}

type Data = Awaited<ReturnType<typeof getPricingPageData>>;

/** Header, a short hero (or the page's own `hero`), the page's own pricing block, then the shared sections and footer. */
export function PricingShell({ data, title, subtitle, hero, children }: { data: Data; title?: string; subtitle?: React.ReactNode; hero?: React.ReactNode; children: React.ReactNode }) {
  const { pricing, trial, app, start } = data;
  return (
    <div className="min-h-screen bg-[#F8FAFD] text-[#0F1F3A]">
      <SiteHeader trial={trial.enabled} app={app} />
      <main>
        {hero ?? <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50rem_24rem_at_50%_-10%,rgba(22,115,255,0.12),transparent)]" />
          <div className="relative mx-auto max-w-4xl px-5 pt-6 pb-5 text-center sm:px-8 sm:pt-7">
            <p className="text-sm font-semibold tracking-[0.18em] text-[#0B5BD3] uppercase">Pricing</p>
            <h1 className="mt-1.5 text-3xl font-bold tracking-tight text-balance sm:text-[2.5rem] sm:leading-tight">{title}</h1>
            <p className="mx-auto mt-1.5 max-w-3xl text-base leading-relaxed text-[#4A5874] sm:text-lg">{subtitle}</p>
            {trial.enabled && !app && (
              <p className="mt-3 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
                Start with {trial.interviews} free interviews, no credit card needed
              </p>
            )}
          </div>
        </section>}
        <section className="mx-auto max-w-6xl px-5 pb-16 sm:px-8">{children}</section>
        <PricingSections pricing={pricing} trial={trial} start={start} />
      </main>
      <footer className="border-t border-[#E3EAF5] bg-white py-6 text-center"><Copyright /><LegalLinks className="mt-2" /></footer>
    </div>
  );
}
