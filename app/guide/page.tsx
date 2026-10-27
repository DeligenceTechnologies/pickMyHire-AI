import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LifeBuoy, PlayCircle } from "lucide-react";
import { Copyright } from "@/components/layout/logo";
import { CookieSettingsLink } from "@/components/analytics/analytics";
import { SiteHeader } from "@/components/marketing/site-header";
import { getAppLink } from "@/lib/auth/session";
import { getGuide } from "@/lib/guide";
import { getTrialSettings } from "@/lib/services/platform";

export const metadata: Metadata = {
  title: { absolute: "Product guide · PickMyHire.ai" },
  description: "Step-by-step help for PickMyHire.ai with screenshots: set up your company, create jobs, screen applications, run AI and human interviews, and shortlist.",
  openGraph: {
    title: "PickMyHire.ai · Product guide",
    description: "Every step from your first job to the shortlist, with screenshots.",
    images: ["/demo/og.jpg"],
  },
};

export default async function GuidePage() {
  const [trial, app] = await Promise.all([getTrialSettings(), getAppLink()]);
  const { html, toc } = getGuide();
  return (
    <div className="min-h-screen bg-[#F8FAFD] text-[#0F1F3A]">
      <SiteHeader trial={trial.enabled} app={app} />
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-8 sm:py-16">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold tracking-[0.18em] text-[#0B5BD3] uppercase">Product guide</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-5xl">How to use PickMyHire.ai</h1>
          <p className="mt-4 text-lg leading-relaxed text-[#4A5874]">
            Every step from your first job to the shortlist, with screenshots. Jump to the part you need, or follow it from the top when you&apos;re setting up.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm font-semibold">
            <Link href="/demo" className="inline-flex items-center gap-2 rounded-xl border border-[#CBD7EA] bg-white px-4 py-2.5 hover:border-[#0B5BD3] hover:text-[#0B5BD3]"><PlayCircle className="size-4" /> Watch the demo</Link>
            <Link href={app ? "/help" : "/#contact"} className="inline-flex items-center gap-2 rounded-xl border border-[#CBD7EA] bg-white px-4 py-2.5 hover:border-[#0B5BD3] hover:text-[#0B5BD3]"><LifeBuoy className="size-4" /> {app ? "Contact support" : "Contact us"}</Link>
          </div>
          <p className="mt-4 text-xs text-[#7A8AA6]">Screenshots use a sample company and sample candidates.</p>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14">
          <nav aria-label="Guide contents" className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
            <details className="group rounded-2xl border border-[#DCE4F0] bg-white p-4 lg:border-0 lg:bg-transparent lg:p-0" open>
              <summary className="cursor-pointer text-sm font-semibold lg:pointer-events-none lg:list-none">Contents</summary>
              <ol className="mt-3 space-y-1 text-sm">
                {toc.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="block rounded-lg px-2 py-1.5 text-[#3D4D6A] hover:bg-[#E9F0FB] hover:text-[#0B5BD3]">{s.title}</a>
                  </li>
                ))}
              </ol>
            </details>
          </nav>
          <article className="guide min-w-0 max-w-3xl" dangerouslySetInnerHTML={{ __html: html }} />
        </div>

        <section className="mt-16 rounded-2xl bg-[#0B1E3D] p-8 text-white sm:p-10">
          <h2 className="text-2xl font-bold tracking-tight">Still stuck?</h2>
          <p className="mt-2 max-w-2xl text-[#C9D6EC]">
            {app ? "Write to our team from Help and support in the app. We reply there and by email." : "Tell us what you're trying to do and we'll help you get set up."}
          </p>
          <Link href={app ? "/help" : "/#contact"} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#0B4FB8] hover:bg-[#EAF2FF]">
            {app ? "Contact support" : "Contact us"} <ArrowRight className="size-4" />
          </Link>
        </section>
      </main>
      <footer className="border-t border-[#E3EAF5] bg-white py-6 text-center"><Copyright /><div className="mt-2 flex items-center justify-center gap-4 text-xs text-[#5A6A86]"><Link href="/cookies" className="hover:text-[#0B5BD3]">Cookie policy</Link><CookieSettingsLink className="hover:text-[#0B5BD3]" /></div></footer>
    </div>
  );
}
