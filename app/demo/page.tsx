import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Copyright } from "@/components/layout/logo";
import { DemoVideo, WALKTHROUGH_VIDEO } from "@/components/marketing/demo-video";
import { CookieSettingsLink } from "@/components/analytics/analytics";
import { SiteHeader } from "@/components/marketing/site-header";
import { DEMO_URL } from "@/lib/marketing";
import { getAppLink } from "@/lib/auth/session";
import { getTrialSettings } from "@/lib/services/platform";

export const metadata: Metadata = {
  title: { absolute: "Product demo · PickMyHire.ai" },
  description: "Watch a 4-minute walkthrough of PickMyHire.ai: a real AI video interview, then every round from job to shortlist, with the identity check, human interviews and the overall result.",
  openGraph: {
    title: "PickMyHire.ai · Product demo",
    description: "A 4-minute walkthrough: a real AI interview, then every round from job to shortlist.",
    images: ["/demo/og.jpg"],
  },
};

const CHAPTERS = [
  "A real AI interview, with adaptive questions",
  "Creating a job with AI and human interview rounds",
  "Apply link and AI application screening",
  "Inviting a candidate, consent and the identity check",
  "The evidence-backed report, with the identity check result",
  "Human interviews, scorecards and the overall result",
  "Shortlisting, with your team in control",
];

export default async function DemoPage() {
  const [trial, app] = await Promise.all([getTrialSettings(), getAppLink()]);
  return (
    <div className="min-h-screen bg-[#F8FAFD] text-[#0F1F3A]">
      <SiteHeader trial={trial.enabled} app={app} />
      <main className="mx-auto max-w-5xl px-5 py-14 sm:px-8 sm:py-20">
        <p className="text-center text-sm font-semibold tracking-[0.18em] text-[#0B5BD3] uppercase">Product demo</p>
        <h1 className="mt-3 text-center text-3xl font-bold tracking-tight text-balance sm:text-5xl">See PickMyHire.ai in action</h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg leading-relaxed text-[#4A5874]">
          A 4-minute walkthrough: a real AI interview, then every round from job to shortlist, with the identity check, human interviews and the overall result.
        </p>
        <DemoVideo className="mt-10" />
        <p className="mt-3 text-center text-xs text-[#7A8AA6]">Recorded with sample data, apart from the real candidate interview.</p>
        <p className="mt-3 text-center text-base text-[#3D4D6A]">Want every detail? <a href="#walkthrough" className="font-semibold text-[#0B5BD3] hover:underline">Watch the full 11-minute product walkthrough ↓</a></p>

        <div className="mt-12 grid gap-10 md:grid-cols-[1.2fr_1fr]">
          <section>
            <h2 className="text-lg font-semibold">What you&apos;ll see</h2>
            <ol className="mt-4 space-y-2.5 text-[15px] text-[#3D4D6A]">
              {CHAPTERS.map((c, i) => (
                <li key={c} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#E6EFFC] text-xs font-semibold text-[#0B5BD3]">{i + 1}</span>
                  {c}
                </li>
              ))}
            </ol>
          </section>
          {app ? (
          <section className="rounded-2xl border border-[#DCE4F0] bg-white p-6">
            <h2 className="text-lg font-semibold">Ready to try it?</h2>
            <p className="mt-2 text-[15px] text-[#4A5874]">Head back to your workspace to create a job and invite candidates. Questions? Our support team is one click away.</p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row md:flex-col lg:flex-row">
              <Link href={app.href} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B5BD3] px-5 py-3 text-sm font-semibold text-white hover:bg-[#0A4FB8]">{app.label} <ArrowRight className="size-4" /></Link>
              <Link href="/help" className="inline-flex items-center justify-center rounded-xl border border-[#CBD7EA] bg-white px-5 py-3 text-sm font-semibold hover:border-[#0B5BD3] hover:text-[#0B5BD3]">Help and support</Link>
            </div>
          </section>
          ) : (
          <section className="rounded-2xl border border-[#DCE4F0] bg-white p-6">
            <h2 className="text-lg font-semibold">Want to try it on your next role?</h2>
            <p className="mt-2 text-[15px] text-[#4A5874]">{trial.enabled ? `Start a free trial (${trial.interviews} interviews for ${trial.days} days), or book a call and we'll walk through your hiring process.` : "Book a call and we'll walk through your hiring process, or request access for your team."}</p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row md:flex-col lg:flex-row">
              <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B5BD3] px-5 py-3 text-sm font-semibold text-white hover:bg-[#0A4FB8]">Book a demo <ArrowRight className="size-4" /></a>
              <Link href={trial.enabled ? "/signup" : "/#request-access"} className="inline-flex items-center justify-center rounded-xl border border-[#CBD7EA] bg-white px-5 py-3 text-sm font-semibold hover:border-[#0B5BD3] hover:text-[#0B5BD3]">{trial.enabled ? "Start free trial" : "Request access"}</Link>
            </div>
          </section>
          )}
        </div>

        <section id="walkthrough" className="mt-20 scroll-mt-24">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Full product walkthrough</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-base leading-relaxed text-[#4A5874]">
            The 11-minute version: every screen in detail, from creating a job and screening applicants to the AI interview, the report, human rounds, scorecards and the shortlist.
          </p>
          <DemoVideo className="mt-8" video={WALKTHROUGH_VIDEO} />
          <p className="mt-3 text-center text-xs text-[#7A8AA6]">Recorded with sample data, apart from the real candidate interview.</p>
        </section>
      </main>
      <footer className="border-t border-[#E3EAF5] bg-white py-6 text-center"><Copyright /><div className="mt-2 flex items-center justify-center gap-4 text-xs text-[#5A6A86]"><Link href="/cookies" className="hover:text-[#0B5BD3]">Cookie policy</Link><CookieSettingsLink className="hover:text-[#0B5BD3]" /></div></footer>
    </div>
  );
}
