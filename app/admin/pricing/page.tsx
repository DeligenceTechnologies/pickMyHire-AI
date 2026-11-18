import Link from "next/link";
import { PricingForm } from "@/components/admin/pricing-form";
import { PageHeader } from "@/components/common/page-header";
import { FormCard } from "@/components/settings/form-card";
import { money } from "@/lib/pricing";
import { getTrialSettings } from "@/lib/services/platform";
import { getCostAssumptions, getPricing, listCompanyPricing } from "@/lib/services/pricing";

export const metadata = { title: "Pricing" };

export default async function AdminPricingPage() {
  const [pricing, costs, trial, companies] = await Promise.all([getPricing(), getCostAssumptions(), getTrialSettings(), listCompanyPricing()]);
  return (
    <>
      <PageHeader title="Pricing" description="Pay per interview. Change prices for everyone here, or for one company on its page." actions={<Link href="/pricing" target="_blank" className="text-sm font-medium text-primary hover:underline">View pricing page ↗</Link>} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PricingForm initial={pricing} initialCosts={costs} trialInterviews={trial.interviews} />
        <div>
          <FormCard title="Companies with their own prices" description="Set these on the company's page.">
            {companies.length === 0 ? <p className="text-sm text-muted-foreground">None yet. Every company uses the standard prices.</p> : (
              <ul className="-my-2 divide-y">
                {companies.map((c) => (
                  <li key={c.id} className="py-2.5">
                    <Link href={`/admin/companies/${c.id}`} className="font-medium hover:text-primary">{c.name}</Link>
                    <p className="text-xs text-muted-foreground tabular">{c.pricing.tiers.map((t) => `${t.min}+: ${money(t.cents)}`).join(" · ")}</p>
                    {c.pricing.note && <p className="text-xs text-muted-foreground">{c.pricing.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </FormCard>
        </div>
      </div>
    </>
  );
}
