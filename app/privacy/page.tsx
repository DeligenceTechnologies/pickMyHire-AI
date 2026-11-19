import type { Metadata } from "next";
import Link from "next/link";
import { ContactBlock, LegalPage, SupportEmail, type LegalSection } from "@/components/legal/legal-page";
import { LEGAL, PRIVACY_VERSION, SUBPROCESSORS } from "@/lib/legal";
import { getPricing } from "@/lib/services/pricing";

// Built on each visit: it reads prices and settings from the database (not available while building).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How PickMyHire.ai collects, uses and protects data about hiring teams, candidates and website visitors.",
};

export default async function PrivacyPage() {
  const pricing = await getPricing();
  const P = LEGAL.productName;
  const company = LEGAL.companyName;
  const privacyEmail = <SupportEmail />;

  const sections: LegalSection[] = [
    { id: "who", title: "Who we are and our role", body: <>
      <p>{P} is provided by {company}. We act in two roles:</p>
      <ul>
        <li><b>For candidates</b>, the hiring company that invites you decides why and how your data is used (it is the &quot;controller&quot;). We process your data on its behalf to run the interview and produce reports (we are the &quot;processor&quot;). For questions about a specific job or decision, contact that company first; we&apos;ll help it respond.</li>
        <li><b>For hiring teams and website visitors</b>, we decide how account and website data is used, so we are responsible for it.</li>
      </ul>
    </> },
    { id: "candidates", title: "Data about candidates", body: <>
      <p>When you apply for a job or take an interview on {P}, we may process:</p>
      <ul>
        <li><b>Application details</b>: name, email, phone, resume, and answers to the employer&apos;s application questions.</li>
        <li><b>Interview recording</b>: video and audio of your answers, and the AI interviewer&apos;s voice.</li>
        <li><b>Transcript</b>: a written record of what was said, created by speech-to-text.</li>
        <li><b>AI analysis</b>: summaries, strengths, areas to explore, section assessments and a report for the hiring team.</li>
        <li><b>Identity check</b> (only if the employer turns it on): a reference photo at the start and a few photos during the interview. The face comparison runs <b>on your own device</b>; only those small photos and a numeric face template (128 numbers) are sent to us, so the hiring team can confirm the same person took the whole interview. This is biometric data: see <a href="#biometric">Biometric data</a> below.</li>
        <li><b>Consent</b>: when you agreed, and to which version of the consent text.</li>
        <li><b>Technical data</b>: browser, device, connection quality and error logs, used to keep the interview working.</li>
      </ul>
      <p>You see a consent screen before every interview that explains the recording and the AI. You can stop at any time.</p>
    </> },
    { id: "customers", title: "Data about hiring teams", body: <ul>
      <li>Account details: name, work email, company name, role and password (stored only as a secure hash).</li>
      <li>Workspace content: jobs, templates, notes, scorecards and decisions.</li>
      <li>Billing details: purchases and invoices. Card details are handled by Stripe and never reach our servers.</li>
      <li>Usage and security logs, such as sign-ins and important actions (an audit log).</li>
      <li>Messages you send us, such as support requests or demo bookings.</li>
    </ul> },
    { id: "visitors", title: "Data about website visitors", body: <p>On our public pages we use essential cookies, and Google Analytics only if you accept analytics cookies. Analytics never runs on interview pages or inside the workspace. See our <Link href="/cookies">cookie policy</Link>.</p> },
    { id: "use", title: "How we use data", body: <ul>
      <li>To run interviews: speak questions, transcribe answers, choose follow-up questions and create reports for the hiring team.</li>
      <li>To provide the workspace: jobs, candidates, scheduling of human rounds, notifications and emails.</li>
      <li>To keep the service secure, prevent misuse, and fix problems.</li>
      <li>To handle payments, invoices and taxes.</li>
      <li>To reply to support requests and, for hiring teams, to send important service messages.</li>
    </ul> },
    { id: "ai", title: "AI and automated decisions", body: <ul>
      <li>AI conducts the interview and writes reports, but <b>it never makes the hiring decision</b>. People at the hiring company review the evidence and decide.</li>
      <li>Reports are labelled as AI-generated advice and link back to what the candidate actually said.</li>
      <li><b>We don&apos;t use interview recordings, transcripts or resumes to train AI models</b>, and our AI provider doesn&apos;t use them for training under its business terms.</li>
    </ul> },
    { id: "biometric", title: "Biometric data (identity check)", body: <ul>
      <li><b>When:</b> only if the hiring company turns on the identity check for an interview. The candidate is told on the consent screen and must agree before the interview starts.</li>
      <li><b>What:</b> a reference photo, a few photos during the interview, and a numeric face template (128 numbers). The face comparison itself runs on the candidate&apos;s device.</li>
      <li><b>Why:</b> only to help the hiring team confirm that the same person took the whole interview. Nothing is decided automatically; people review any flag.</li>
      <li><b>Never</b> sold, leased, traded or used for any other purpose, and never used to train AI models.</li>
      <li><b>Deleted</b> together with the interview recording, within {pricing.recordingMonths} months at most, or earlier if the hiring company deletes the interview or the candidate&apos;s data.</li>
    </ul> },
    { id: "legal-basis", title: "Legal bases", body: <p>Where laws such as the GDPR apply, we rely on: performing our contract with hiring companies; the hiring company&apos;s legitimate interest in assessing applicants, or the candidate&apos;s consent where the law requires it (for example for recording and biometric checks); our legal obligations (for example tax records); and our legitimate interest in keeping the service secure.</p> },
    { id: "providers", title: "Who we share data with", body: <>
      <p>We share data only with the hiring company you applied to, and with these providers that help us run {P}. They may only use it to provide their service to us.</p>
      <div className="overflow-x-auto rounded-xl border border-[#DCE4F0] bg-white">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="bg-[#F3F7FC] text-xs text-[#5A6A86]"><tr><th className="px-4 py-2.5 font-medium">Provider</th><th className="px-4 py-2.5 font-medium">What for</th><th className="px-4 py-2.5 font-medium">Data</th></tr></thead>
          <tbody className="divide-y divide-[#EEF2F8]">
            {SUBPROCESSORS.map((s) => <tr key={s.name}><td className="px-4 py-3 font-medium"><a href={s.link} target="_blank" rel="noopener noreferrer">{s.name}</a></td><td className="px-4 py-3">{s.purpose}</td><td className="px-4 py-3">{s.data}</td></tr>)}
          </tbody>
        </table>
      </div>
      <p>We may also share data if the law requires it, or as part of a merger or sale of our business (with the same protections). <b>We never sell personal data.</b></p>
    </> },
    { id: "transfers", title: "Where data is stored", body: <p>Our database, file storage and application servers are hosted in {LEGAL.dataRegion}. Some providers, such as our AI, email and payment providers, may process data in other countries, including the United States. Where the law requires it, we use appropriate safeguards such as standard contractual clauses.</p> },
    { id: "retention", title: "How long we keep data", body: <ul>
      <li><b>Interview recordings</b>: deleted after {pricing.recordingMonths} months at most. A hiring company can choose a shorter period.</li>
      <li><b>Transcripts, reports, scores and decisions</b>: kept while the hiring company&apos;s account is active, unless it deletes them earlier or sets a retention period.</li>
      <li><b>Identity check photos and face templates</b>: kept with the interview and deleted with it.</li>
      <li><b>Account data</b>: kept while the account is open, then deleted within 30 days of closing, apart from records we must keep by law (such as invoices).</li>
      <li>Backups are overwritten on a rolling schedule.</li>
    </ul> },
    { id: "security", title: "Security", body: <p>We protect data with encryption in transit and at rest, access controls that keep each company&apos;s data separate, private links for recordings, an audit log of sensitive actions, and limited staff access. No system is perfectly secure; if a breach affects your data, we&apos;ll notify the affected company and, where required, the authorities and you.</p> },
    { id: "rights", title: "Your rights", body: <>
      <p>Depending on where you live, you can ask to access, correct, delete or get a copy of your data, object to or restrict its use, and withdraw consent. You can also complain to your data protection authority.</p>
      <ul>
        <li><b>Candidates</b>: contact the company that invited you, or write to us at {privacyEmail} and we&apos;ll pass your request to them and help.</li>
        <li><b>Hiring teams</b>: manage most data in the workspace (for example, delete a candidate&apos;s data), or write to {privacyEmail}.</li>
        <li><b>US state privacy rights</b> (for example California): you can ask what personal information we hold about you, and ask us to correct or delete it. We don&apos;t sell personal information, we don&apos;t share it for targeted advertising, and we won&apos;t treat you differently for using these rights. For candidate data, we act as a service provider to the hiring company and handle your request with it.</li>
      </ul>
      <p>We may need to confirm your identity before acting on a request. You can also send requests through our <Link href={LEGAL.contactPath}>contact form</Link>.</p>
    </> },
    { id: "children", title: "Age", body: <p>{P} is for hiring adults. Interviews aren&apos;t intended for anyone under {LEGAL.minimumCandidateAge}, and we don&apos;t knowingly process their data.</p> },
    { id: "changes", title: "Changes", body: <p>We&apos;ll update this policy when our practices change and show the date at the top. For important changes we&apos;ll inform hiring companies in advance. Current version: {PRIVACY_VERSION}.</p> },
    { id: "contact", title: "Contact", body: <ContactBlock /> },
  ];

  return (
    <LegalPage eyebrow="Privacy Policy" title="Privacy Policy"
      intro={<p>This policy explains what data {P} collects about hiring teams, candidates and website visitors, how we use it, who helps us, and your choices. We keep it in plain language.</p>}
      sections={sections} />
  );
}
