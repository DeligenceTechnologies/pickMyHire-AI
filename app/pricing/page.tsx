import type { Metadata } from "next";
import { getPricingPageData, PricingShell } from "@/components/pricing/page-shell";
import { SliderPlans } from "@/components/pricing/slider-plans";
import { DEMO_URL } from "@/lib/marketing";
import { money } from "@/lib/pricing";

// The public pricing page: one slider, three columns (Free, Pay per interview, Enterprise).
// Public. Buying itself (Settings → Billing) can still be limited with PURCHASE_ACCESS_CODE.
// Built on each visit: it reads prices and settings from the database (not available while building).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Pricing · PickMyHire.ai" },
  description: "Pay per AI interview. No subscription, no monthly fees. Start with free interviews, then buy only what you need, with lower prices for larger packs.",
};

export default async function PricingPage() {
  const data = await getPricingPageData();
  const first = data.pricing.tiers[0].cents;
  const lowest = data.pricing.tiers[data.pricing.tiers.length - 1].cents;
  return (
    <PricingShell data={data}
      hero={
        <section className="mx-auto max-w-6xl px-5 pt-5 pb-4 sm:px-8 md:pt-6">
          <p className="text-sm font-semibold text-[#0B5BD3]">Pricing</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-balance sm:text-[2.25rem] sm:leading-tight">Pay only for the interviews you run</h1>
          <p className="mt-1 text-[15px] leading-relaxed text-[#4A5874]">
            Interviews start at <b className="text-[#0F1F3A]">{money(first)}</b> each, and drop to <b className="text-[#0F1F3A]">{money(lowest)}</b> with bigger packs. No subscription.
          </p>
        </section>
      }>
      <SliderPlans pricing={data.pricing} trial={data.trial} start={data.start} packHref={data.packHref} packLabel={data.packLabel} contactHref={DEMO_URL} account={data.account} />
    </PricingShell>
  );
}
