import type { Metadata } from "next";
import Link from "next/link";
import { ContactBlock, LegalPage, SupportEmail, type LegalSection } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal";
import { getTrialSettings } from "@/lib/services/platform";

export const metadata: Metadata = {
  title: "Refund policy",
  description: "PickMyHire.ai interview purchases are final. If an interview doesn't work because of a problem on our side, we give the interview back.",
};

export default async function RefundsPage() {
  const trial = await getTrialSettings();
  const P = LEGAL.productName;

  const sections: LegalSection[] = [
    { id: "summary", title: "In short", body: <ul>
      <li>{P} has <b>no subscription</b>. You buy interviews once and use them when you need them.</li>
      <li><b>All purchases are final. We don&apos;t refund payments.</b></li>
      <li>If an interview doesn&apos;t work because of a problem on our side, <b>we give the interview back</b> to your balance, so you can use it again.</li>
      <li>Purchased interviews are valid for {LEGAL.validityMonths} months.</li>
    </ul> },
    { id: "automatic", title: "Interviews given back automatically", body: <p>An interview is only used when the candidate starts it, not when you invite them. If it ends before the candidate answers any question, for example because of a connection problem, it goes back to your balance automatically. You don&apos;t need to ask.</p> },
    { id: "problems", title: "Problems on our side", body: <>
      <p>If an interview didn&apos;t work properly because of a problem with {P}, for example the interview couldn&apos;t continue, the recording or report failed, or the AI interviewer stopped responding, we add the interview back to your balance.</p>
      <ul>
        <li>Tell us within 30 days of the interview: email <SupportEmail />, use the <Link href={LEGAL.contactPath}>contact form</Link>, or <b>Help and support</b> in the app.</li>
        <li>Include your company name, the candidate&apos;s name or the interview link, and what went wrong.</li>
        <li>We check and reply within 2 business days. Interviews we give back appear in your balance straight away.</li>
      </ul>
    </> },
    { id: "not-covered", title: "What isn't given back", body: <ul>
      <li>Interviews that a candidate started and answered, when nothing went wrong on our side, even if you decide not to use the result.</li>
      <li>Problems on the candidate&apos;s side, such as a poor connection, a blocked camera or microphone, or leaving the interview early, once they had started answering.</li>
      <li>Interviews that expired after {LEGAL.validityMonths} months without being used.</li>
      {trial.enabled && <li>Free trial interviews ({trial.interviews} for new accounts). They have no cash value.</li>}
    </ul> },
    { id: "billing-errors", title: "Billing mistakes", body: <p>If you were charged by mistake, for example twice for the same purchase, contact us and we&apos;ll correct it.</p> },
    { id: "chargebacks", title: "Card disputes", body: <p>Please contact us before disputing a payment with your bank; we can usually fix the problem faster. While a dispute is open, we may pause new purchases on the account.</p> },
    { id: "related", title: "Related", body: <p>See the <Link href="/terms#pricing">Terms of Service</Link> and the <Link href="/pricing">pricing page</Link> for how interviews are counted.</p> },
    { id: "contact", title: "Contact", body: <ContactBlock /> },
  ];

  return (
    <LegalPage eyebrow="Refund policy" title="Refund policy"
      intro={<p>Interview purchases are final, and we stand behind every interview: if one doesn&apos;t work because of us, you get it back.</p>}
      sections={sections} />
  );
}
