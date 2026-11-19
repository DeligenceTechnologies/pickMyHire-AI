import Link from "next/link";
import { ArrowRight, BadgeCheck, CheckCircle2, PlayCircle } from "lucide-react";
import { LEGAL } from "@/lib/legal";
import { minPurchase, money, type Pricing } from "@/lib/pricing";

type Trial = { enabled: boolean; interviews: number };

/** What the public pricing pages show under the prices: how it works, what's included, FAQ and a final call to action. */
export function PricingSections({ pricing, trial, start }: { pricing: Pricing; trial: Trial; start: { href: string; label: string } }) {
  const lowest = pricing.tiers[pricing.tiers.length - 1].cents;
  const base = pricing.tiers[0].cents;
  const steps = [
    { t: trial.enabled ? "Start free" : "Get access", d: trial.enabled ? `Sign up with your work email and run ${trial.interviews} real interviews, no card needed.` : "Request access and we'll set up your workspace." },
    { t: "Buy a pack", d: `Choose ${pricing.recommended ?? minPurchase(pricing)} interviews, or any number from ${minPurchase(pricing)} up. Bigger packs cost less per interview.` },
    { t: "Invite candidates", d: "An interview is only used when a candidate starts it. Invites that are never opened cost nothing." },
  ];
  // Everything the product does, grouped. Keep in sync with real features (no promises of things we don't have).
  const features: { title: string; items: string[] }[] = [
    { title: "AI interviews", items: [
      "A natural AI voice interviewer, with a name you choose",
      "Questions personalized to each candidate's resume and the job",
      "Follow-up questions based on each answer",
      "Candidates join from a link, on any device, at any time. No app or account",
      "Ready-made interview templates, or build your own sections and timing",
      "Consent screen before every interview",
      "Optional identity check during the interview",
    ] },
    { title: "Reports and evidence", items: [
      "Full recording: candidate video and interviewer voice",
      "Searchable transcript with timestamps, ready to download",
      "AI report: summary, strengths and areas to explore",
      "Section assessments, each linked to the moment in the recording",
      "A short one-page report to share with your team",
      "Compare candidates for a job side by side",
      "Optional AI feedback email to each candidate",
    ] },
    { title: "Hiring workflow", items: [
      "Job pages with a public apply link and your own application questions",
      "AI resume screening against the job's requirements",
      "Candidate pipeline with stages and round decisions",
      "Human interview rounds: schedule with your team, with calendar invites",
      "Scorecards for each interviewer, and an overall result across rounds",
      "Email and in-app notifications when interviews are done",
    ] },
    { title: "Team, brand and data", items: [
      "Unlimited team members, jobs and templates",
      "Roles: owner, admin, recruiter, interviewer and viewer",
      "Your logo and colors on candidate pages and emails",
      `Recordings kept for ${pricing.recordingMonths} months; reports kept while your account is active`,
      "Data retention settings, candidate data deletion and an audit log",
      "Help and support inside the app",
    ] },
  ];
  const faq: [string, string][] = [
    ["What counts as one interview?", `One candidate taking one AI interview. Most interviews take ${pricing.advertisedMinutes} minutes or less, and a template can run up to ${pricing.minutesPerInterview} minutes and still count as one. A template longer than that counts as 2, and you're asked to confirm when you save it.`],
    ["When is an interview used?", "When the candidate starts it, not when you invite them. If the interview ends before the candidate answers anything, it's given back automatically."],
    ["Is there a subscription?", "No. You buy interviews when you need them. There's no monthly fee and nothing renews automatically."],
    ["How do bigger packs save money?", `The more interviews you buy at once, the less each one costs: from ${money(base)} down to ${money(lowest)}. The lower price applies to every interview in that purchase.`],
    ["Can I buy any number?", `Yes, any number from ${minPurchase(pricing)} up, like 12, 23 or 55. If a slightly bigger pack costs less in total, the calculator tells you.`],
    ["Can I get a refund?", "All purchases are final, so we don't refund payments. But if an interview doesn't work because of a problem on our side, we give the interview back to your balance. Interviews that end before the candidate answers anything come back automatically."],
    ["Do purchased interviews expire?", `Yes, after ${LEGAL.validityMonths} months. Buy the number you expect to use in that time; you can always add more later.`],
    ["What if we run out of interviews?", "You can still invite candidates. Anyone who opens their link sees a polite message to contact you, and you get an alert. Once you add interviews, the same link works."],
    ["How long do you keep recordings?", `Interview recordings are deleted after ${pricing.recordingMonths} months. Reports, transcripts, scores and decisions stay while your account is active, and you can delete any candidate's data at any time.`],
    ["What about hiring large volumes?", pricing.contactFrom ? `For ${pricing.contactFrom} or more interviews at once, talk to us for a custom price.` : "Larger packs get the lowest price automatically."],
  ];

  return (
    <>
      {/* How it works */}
      <section className="border-y border-[#E3EAF5] bg-white py-16">
        <div className="mx-auto max-w-5xl px-5 sm:px-8">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">How it works</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.t} className="rounded-2xl border border-[#E3EAF5] bg-[#F8FAFD] p-6">
                <span className="flex size-8 items-center justify-center rounded-full bg-[#0B5BD3] text-sm font-semibold text-white">{i + 1}</span>
                <p className="mt-4 font-semibold">{s.t}</p>
                <p className="mt-1 text-[15px] leading-relaxed text-[#4A5874]">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Everything included */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:px-8">
        <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Everything included in every pack</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-[15px] text-[#4A5874]">The full product for every company, from the free trial to the largest pack. Bigger packs only change the price.</p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((g) => (
            <div key={g.title} className="rounded-2xl border border-[#E3EAF5] bg-white p-6">
              <p className="font-semibold">{g.title}</p>
              <ul className="mt-4 space-y-2.5">
                {g.items.map((x) => (
                  <li key={x} className="flex gap-2.5 text-sm leading-snug text-[#3D4D6A]"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#0B5BD3]" aria-hidden />{x}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-5 pb-16 sm:px-8">
        <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Questions about pricing</h2>
        <div className="mt-8 divide-y divide-[#E3EAF5] rounded-2xl border border-[#DCE4F0] bg-white">
          {faq.map(([q, a]) => (
            <details key={q} className="group px-6 py-4">
              <summary className="cursor-pointer list-none font-semibold marker:hidden">
                <span className="flex items-center justify-between gap-4">{q}<span className="text-xl leading-none text-[#0B5BD3] transition-transform group-open:rotate-45" aria-hidden>+</span></span>
              </summary>
              <p className="mt-2 text-[15px] leading-relaxed text-[#4A5874]">{a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-[#5B6B86]">Prices in US dollars. Taxes may apply depending on where you are. All purchases are final: if an interview doesn&apos;t work because of us, we give it back. See our <Link href="/refunds" className="text-[#0B5BD3] hover:underline">refund policy</Link> and <Link href="/terms" className="text-[#0B5BD3] hover:underline">terms</Link>.</p>
      </section>

      {/* Final call to action */}
      <section className="px-5 pb-20 sm:px-8">
        <div className="mx-auto max-w-4xl rounded-3xl bg-[#0B2A5B] px-6 py-12 text-center text-white sm:px-12">
          <BadgeCheck className="mx-auto size-8 text-[#8FB8FF]" aria-hidden />
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">{trial.enabled ? `Try it on a real role, ${trial.interviews} interviews free` : "See it on a real role"}</h2>
          <p className="mx-auto mt-3 max-w-xl text-[#C9DAF5]">No credit card, no subscription. Buy a pack only when you&apos;re ready.</p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={start.href} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 font-semibold text-[#0B2A5B] hover:bg-[#E9F0FB]">{start.label} <ArrowRight className="size-4" /></Link>
            <Link href="/demo" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/30 px-6 py-3 font-semibold text-white hover:bg-white/10"><PlayCircle className="size-4" /> Watch the 3-minute demo</Link>
          </div>
        </div>
      </section>
    </>
  );
}
