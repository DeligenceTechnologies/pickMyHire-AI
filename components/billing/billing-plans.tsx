"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BuyDialog } from "@/components/billing/buy-dialog";
import { SliderPlans } from "@/components/pricing/slider-plans";
import type { Pricing } from "@/lib/pricing";

/** Settings → Billing: the same slider as the pricing page; its button opens the payment confirmation. */
export function BillingPlans({ pricing, contactHref, initialQty, payments }: {
  pricing: Pricing; contactHref: string; initialQty?: number | null;
  /** Online payment: null when Stripe isn't set up. */
  payments: { validMonths: number; testMode: boolean } | null;
}) {
  const [buying, setBuying] = useState<number | null>(null);
  const buy = (qty: number) => {
    if (payments) setBuying(qty);
    else toast.info("Online payment isn't available yet.", { description: "Book a call or use Help and support and we'll add interviews to your account.", duration: 10_000 });
  };
  return (
    <>
      {payments && <BuyDialog pricing={pricing} qty={buying} validMonths={payments.validMonths} testMode={payments.testMode} onClose={() => setBuying(null)} />}
      <SliderPlans pricing={pricing} trial={{ enabled: false, interviews: 0 }} start={{ href: "/settings/billing", label: "" }}
        packHref={null} packLabel="Buy {n} interviews" contactHref={contactHref} initialQty={initialQty} onBuy={buy} />
    </>
  );
}
