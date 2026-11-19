// Legal details shown on /terms, /privacy and /refunds.
// Change a *_VERSION when the text of that document changes in a way users should accept again.

export const LEGAL = {
  lastUpdated: "19 November 2026",
  productName: "PickMyHire.ai",
  /** The company that provides the service (update with the registered business name when it's final). */
  companyName: "PickMyHire",
  website: "pickmyhire.ai",
  supportEmail: "support@pickmyhire.ai",
  /** The contact form on the home page; it reaches the PickMyHire team (Admin → Requests). */
  contactPath: "/#contact",
  governingLaw: "the laws of the United States",
  /** Where the database, file storage and application servers run. */
  dataRegion: "Singapore",
  minimumCandidateAge: 18,
  /** Purchased interviews expire after this many months. */
  validityMonths: 12,
} as const;

export const TERMS_VERSION = "2026-11-v2";
export const PRIVACY_VERSION = "2026-11-v2";

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
