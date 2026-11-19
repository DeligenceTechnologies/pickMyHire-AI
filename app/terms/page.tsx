import type { Metadata } from "next";
import Link from "next/link";
import { ContactBlock, LegalPage, SupportEmail, type LegalSection } from "@/components/legal/legal-page";
import { LEGAL, TERMS_VERSION } from "@/lib/legal";
import { getTrialSettings } from "@/lib/services/platform";
import { getPricing } from "@/lib/services/pricing";

// Built on each visit: it reads prices and settings from the database (not available while building).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using PickMyHire.ai, the AI interview platform for hiring teams.",
};

export default async function TermsPage() {
  const [pricing, trial] = await Promise.all([getPricing(), getTrialSettings()]);
  const P = LEGAL.productName;
  const company = LEGAL.companyName;

  const sections: LegalSection[] = [
    { id: "agreement", title: "Agreement", body: <>
      <p>These Terms of Service (&quot;Terms&quot;) are an agreement between {company} (&quot;we&quot;, &quot;us&quot;) and the organization that creates a {P} account (&quot;you&quot;, the &quot;Customer&quot;). By creating an account, buying interviews or using {P}, you accept these Terms on behalf of your organization, and you confirm that you&apos;re allowed to do so.</p>
      <p>{P} is a tool for businesses. It isn&apos;t intended for personal or household use.</p>
    </> },
    { id: "service", title: "What PickMyHire.ai does", body: <>
      <p>{P} lets hiring teams create jobs, invite candidates to AI-led video interviews, and review recordings, transcripts and AI-generated reports. It also supports human interview rounds, scorecards and decisions.</p>
      <p><b>The AI gives advice; people decide.</b> AI reports, summaries, scores and identity checks are there to help your team review evidence. They can be wrong. You are responsible for every hiring decision, and you shouldn&apos;t make a decision about a candidate based only on an AI output.</p>
    </> },
    { id: "accounts", title: "Your account", body: <ul>
      <li>Keep sign-in details secure and tell us straight away if you think your account has been accessed without permission.</li>
      <li>You&apos;re responsible for what happens in your account, including actions by team members you invite.</li>
      <li>Give accurate information when you sign up, and keep it up to date.</li>
    </ul> },
    { id: "responsibilities", title: "Your responsibilities as a hiring team", body: <>
      <p>You decide which candidates to interview and how to use the results, so you are responsible for using {P} lawfully. In particular, you agree to:</p>
      <ul>
        <li>tell candidates that the interview is conducted by AI, recorded and analysed, and get any consent the law requires (candidates also see a consent screen before every interview);</li>
        <li>follow the employment, anti-discrimination, privacy and AI rules that apply where you and your candidates are, including any rules on automated tools in hiring;</li>
        <li>not use {P} to make decisions based on protected characteristics such as race, religion, sex, age, disability or nationality;</li>
        <li>only upload resumes and other information you are allowed to use, and respond to candidates&apos; requests about their data;</li>
        <li>review AI outputs with a person before deciding.</li>
      </ul>
    </> },
    { id: "acceptable-use", title: "Acceptable use", body: <>
      <p>You must not:</p>
      <ul>
        <li>use {P} for anything unlawful, deceptive or harmful, or to interview people who haven&apos;t agreed to take part;</li>
        <li>interview candidates under {LEGAL.minimumCandidateAge};</li>
        <li>try to break, overload, reverse engineer or get around the security or limits of the service;</li>
        <li>resell or share access to {P} outside your organization without our written agreement;</li>
        <li>upload malware, or content you don&apos;t have the right to use.</li>
      </ul>
    </> },
    { id: "pricing", title: "Interviews, prices and payment", body: <ul>
      <li><b>Pay per interview.</b> You buy interviews in advance. There is no subscription and nothing renews automatically. Prices are shown on the <Link href="/pricing">pricing page</Link> (or agreed with you separately) and are in US dollars.</li>
      {trial.enabled && <li><b>Free trial.</b> New accounts get {trial.interviews} free interviews. They have no cash value.</li>}
      <li><b>When an interview is used.</b> An interview is used when a candidate starts it, not when you invite them. If an interview ends before the candidate answers any question, it&apos;s returned to your balance automatically.</li>
      <li><b>Length.</b> An interview template up to {pricing.minutesPerInterview} minutes counts as one interview. A longer template counts as two, and you&apos;re asked to confirm this when you save it.</li>
      <li><b>Validity.</b> Purchased interviews can be used for {LEGAL.validityMonths} months from purchase. Unused interviews then expire.</li>
      <li><b>Payment.</b> Payments are processed by Stripe. Prices exclude taxes unless shown otherwise; you pay any applicable taxes.</li>
      <li><b>All purchases are final.</b> We don&apos;t refund payments. If an interview doesn&apos;t work because of a problem on our side, we add it back to your balance. See our <Link href="/refunds">refund policy</Link>.</li>
      <li><b>Price changes</b> apply to future purchases only, never to interviews you have already bought.</li>
    </ul> },
    { id: "data", title: "Your data and candidates' data", body: <>
      <ul>
        <li><b>You own your data</b>: jobs, candidate information, recordings, transcripts, reports and decisions (&quot;Customer Data&quot;).</li>
        <li>For candidate data, you decide why and how it is used, and we process it on your behalf to provide {P}. Our <Link href="/privacy">Privacy Policy</Link> explains what we collect and which providers help us.</li>
        <li>We don&apos;t sell Customer Data, and we don&apos;t use it to train AI models.</li>
        <li><b>Retention.</b> Interview recordings are deleted after {pricing.recordingMonths} months (or sooner, if you set a shorter retention period in Settings). Reports, transcripts and decisions are kept while your account is active, and you can delete any candidate&apos;s data at any time.</li>
        <li>If your organization needs a data processing agreement, contact <SupportEmail />.</li>
      </ul>
    </> },
    { id: "ip", title: "Intellectual property", body: <p>We own {P}, including its software, design and content, apart from Customer Data. We give you a limited, non-transferable right to use {P} for your internal hiring while these Terms apply. If you send us feedback, we may use it freely to improve the service.</p> },
    { id: "third-party", title: "Third-party services", body: <p>{P} relies on trusted providers, for example for AI processing, hosting, email and payments. They are listed in our <Link href="/privacy#providers">Privacy Policy</Link>. We choose them carefully but aren&apos;t responsible for outages of services we don&apos;t control.</p> },
    { id: "availability", title: "Availability and changes", body: <p>We work to keep {P} available and secure, but we can&apos;t promise it will always be uninterrupted or error-free. We may improve or change features over time. If we remove something important you have paid for, we&apos;ll give you reasonable notice and help you use the interviews you have left.</p> },
    { id: "disclaimer", title: "Disclaimers", body: <p>Apart from what these Terms say, {P} is provided &quot;as is&quot;. We don&apos;t guarantee any hiring outcome, or that AI outputs are complete or accurate. Nothing in these Terms limits rights you have under law that can&apos;t be limited.</p> },
    { id: "liability", title: "Limitation of liability", body: <>
      <p>To the extent the law allows:</p>
      <ul>
        <li>neither party is liable for indirect or consequential losses, or lost profits, revenue or data;</li>
        <li>our total liability under these Terms is limited to the amount you paid us in the 12 months before the claim.</li>
      </ul>
      <p>These limits don&apos;t apply where the law doesn&apos;t allow them, for example in cases of fraud.</p>
    </> },
    { id: "indemnity", title: "Indemnity", body: <p>You agree to cover us against claims from third parties (including candidates) that arise from how you used {P} or the decisions you made with it, in breach of these Terms or the law.</p> },
    { id: "termination", title: "Suspension and closing an account", body: <ul>
      <li>You can stop using {P} at any time and ask us to close your account.</li>
      <li>We may suspend or close an account that breaks these Terms or puts others at risk. Where reasonable, we&apos;ll warn you first.</li>
      <li>After closing, you can ask for an export of your data for 30 days. After that we delete it, except where the law requires us to keep it.</li>
    </ul> },
    { id: "changes", title: "Changes to these Terms", body: <p>We may update these Terms. For important changes we&apos;ll tell account owners by email or in the app at least 14 days before they apply, and ask you to accept the new version. The version in force is the one on this page (version {TERMS_VERSION}).</p> },
    { id: "law", title: "Governing law", body: <p>These Terms are governed by {LEGAL.governingLaw}. Before starting any formal dispute, please contact us so we can try to resolve it together. Any dispute that can&apos;t be resolved that way is decided by the competent courts in the United States.</p> },
    { id: "contact", title: "Contact", body: <ContactBlock /> },
  ];

  return (
    <LegalPage eyebrow="Terms of Service" title="Terms of Service"
      intro={<p>These Terms explain the rules for using {P}: what we provide, what we expect from hiring teams, and how payments work. Please read them before you create an account or buy interviews.</p>}
      sections={sections} />
  );
}
