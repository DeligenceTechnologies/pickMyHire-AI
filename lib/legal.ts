// Legal details shown on /terms, /privacy and /refunds. Fill the nulls before publishing:
// every null shows on the pages as a yellow "[to fill: …]" placeholder.
// Change a *_VERSION when the text of that document changes in a way users should accept again.

export const LEGAL = {
  /** Show the yellow "Draft, not yet reviewed by a lawyer" banner. Set to false once reviewed. */
  draft: true,
  lastUpdated: "14 November 2026",
  productName: "PickMyHire.ai",
  website: "pickmyhire.ai",

  companyLegalName: null as string | null, // e.g. "Deligence Technologies Pvt. Ltd."
  registeredAddress: null as string | null,
  country: null as string | null, // e.g. "India"
  registrationNumber: null as string | null, // e.g. CIN
  taxId: null as string | null, // e.g. GSTIN

  supportEmail: null as string | null, // e.g. "support@pickmyhire.ai"
  billingEmail: null as string | null, // e.g. "billing@pickmyhire.ai"
  privacyEmail: null as string | null, // e.g. "privacy@pickmyhire.ai"
  grievanceOfficer: null as string | null, // name + email, required for India (DPDP Act)

  governingLaw: null as string | null, // e.g. "the laws of India"
  courts: null as string | null, // e.g. "the courts of Chandigarh, India"

  dataRegion: null as string | null, // where Supabase and Render run, e.g. "Mumbai, India (AWS ap-south-1)"
  minimumCandidateAge: 18,

  refundDays: 14 as number | null, // unused interviews can be refunded within this many days of purchase
  validityMonths: 12 as number | null, // purchased interviews expire after this many months
} as const;

export const TERMS_VERSION = "2026-11-v1";
export const PRIVACY_VERSION = "2026-11-v1";

/** Services that process data for us. Shown on the privacy page. */
export const SUBPROCESSORS: { name: string; purpose: string; data: string; link: string }[] = [
  { name: "OpenAI", purpose: "AI interviewer voice, speech-to-text, questions, analysis and reports", data: "Interview audio, transcripts, resume and job details", link: "https://openai.com/policies/business-terms" },
  { name: "Supabase", purpose: "Database and file storage (recordings, resumes)", data: "All account, job, candidate and interview data", link: "https://supabase.com/privacy" },
  { name: "Render", purpose: "Hosting the application servers", data: "Data passing through the application", link: "https://render.com/privacy" },
  { name: "Resend", purpose: "Sending emails (invitations, notifications, receipts)", data: "Names, email addresses, email content", link: "https://resend.com/legal/privacy-policy" },
  { name: "Stripe", purpose: "Card payments and invoices (when you buy interviews)", data: "Billing name, email, address and payment details (card numbers go to Stripe, never to us)", link: "https://stripe.com/privacy" },
  { name: "Google Analytics", purpose: "Visitor statistics on public pages, only if the visitor accepts analytics cookies", data: "Pseudonymous usage data", link: "https://policies.google.com/privacy" },
  { name: "Cal.com", purpose: "Booking demo calls, if you choose to book one", data: "Name, email, meeting details", link: "https://cal.com/privacy" },
];
