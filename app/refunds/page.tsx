import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPurchaseAccess } from "@/lib/purchase-access";
import { ContactBlock, Fill, LegalPage, type LegalSection } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal";
import { getTrialSettings } from "@/lib/services/platform";

export const metadata: Metadata = {
  title: "Refund policy",
  description: "When you can get a refund for PickMyHire.ai interview packs, and how to ask for one.",
};

export default async function RefundsPage() {
  // Drafts: hidden until launch, except for people testing with the purchase access code.
  if (!(await hasPurchaseAccess())) notFound();
  const trial = await getTrialSettings();
  const P = LEGAL.productName;
  const days = <Fill v={LEGAL.refundDays} label="number of" />;
  const billing = <Fill v={LEGAL.billingEmail} label="billing email" />;

  const sections: LegalSection[] = [
    { id: "summary", title: "In short", body: <ul>
      <li>{P} has <b>no subscription</b>. You buy interviews once and use them when you need them.</li>
      <li><b>Unused interviews can be refunded within {days} days</b> of purchase.</li>
      <li>Interviews that end before the candidate answers anything are <b>returned to your balance automatically</b>.</li>
    </ul> },
    { id: "eligible", title: "What can be refunded", body: <ul>
      <li><b>Unused interviews, within {days} days of purchase.</b> We refund the price you paid for each unused interview in that purchase. Interviews already used aren&apos;t refundable.</li>
      <li><b>Charged by mistake</b>, for example a duplicate payment: refunded in full.</li>
      <li><b>A problem on our side</b> that stopped interviews from working: we return the affected interviews to your balance or refund them, whichever you prefer.</li>
    </ul> },
    { id: "not-eligible", title: "What isn't refunded", body: <ul>
      <li>Interviews that a candidate has started and answered, even if you later decide not to use the result.</li>
      <li>Requests made more than {days} days after purchase, except for mistakes or problems on our side.</li>
      {trial.enabled && <li>Free trial interviews ({trial.interviews} for new accounts), which have no cash value.</li>}
      <li>Interviews that expired after <Fill v={LEGAL.validityMonths} label="number of" /> months without being used.</li>
    </ul> },
    { id: "automatic", title: "Automatic returns", body: <p>An interview is only used when the candidate starts it. If it ends before the candidate answers any question, for example because of a connection problem, it goes back to your balance automatically. You don&apos;t need to ask.</p> },
    { id: "how", title: "How to ask for a refund", body: <ul>
      <li>Email {billing} from your account&apos;s email address, with your company name and the purchase date.</li>
      <li>We reply within 2 business days. Approved refunds go back to the original card, and usually arrive within 5–10 business days, depending on your bank.</li>
      <li>The refunded interviews are removed from your balance.</li>
    </ul> },
    { id: "chargebacks", title: "Card disputes", body: <p>Please contact us before disputing a payment with your bank; we can usually fix the problem faster. While a dispute is open, we may pause new purchases on the account.</p> },
    { id: "related", title: "Related", body: <p>See the <Link href="/terms#pricing">Terms of Service</Link> and the <Link href="/pricing">pricing page</Link> for how interviews are counted.</p> },
    { id: "contact", title: "Contact", body: <ContactBlock /> },
  ];

  return (
    <LegalPage eyebrow="Refund policy" title="Refund policy"
      intro={<p>We want you to buy only the interviews you need. This page explains when you can get your money back.</p>}
      sections={sections} />
  );
}
