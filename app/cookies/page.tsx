import type { Metadata } from "next";
import Link from "next/link";
import { Copyright } from "@/components/layout/logo";
import { SiteHeader } from "@/components/marketing/site-header";
import { CookieSettingsLink } from "@/components/analytics/analytics";
import { CONSENT_COOKIE, GA_ID } from "@/lib/analytics";
import { getAppLink } from "@/lib/auth/session";
import { getTrialSettings } from "@/lib/services/platform";

export const metadata: Metadata = {
  title: "Cookie policy",
  description: "Which cookies PickMyHire.ai uses, why, and how to change your choice.",
};

const COOKIES: [string, string, string, string][] = [
  [CONSENT_COOKIE, "Strictly necessary", "Remembers whether you accepted or declined analytics cookies.", "6 months"],
  ["aii_session", "Strictly necessary", "Keeps you signed in to your workspace. Set only when you sign in.", "14 days"],
  ["_ga", "Analytics (only if you accept)", "Google Analytics: tells visits apart so we can count visitors.", "13 months"],
  [`_ga_${GA_ID.replace(/^G-/, "")}`, "Analytics (only if you accept)", "Google Analytics: keeps track of the current visit.", "13 months"],
];

export default async function CookiesPage() {
  const [trial, app] = await Promise.all([getTrialSettings(), getAppLink()]);
  return (
    <div className="min-h-screen bg-[#F8FAFD] text-[#0F1F3A]">
      <SiteHeader trial={trial.enabled} app={app} />
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#0B5BD3]">Cookie policy</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">How we use cookies</h1>
        <p className="mt-2 text-sm text-[#5A6A86]">Last updated 27 October 2026</p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-[#3D4D6A]">
          <p>Cookies are small files a website stores in your browser. PickMyHire.ai uses a few that are needed for the site to work, and, only if you agree, analytics cookies that help us understand how visitors use our public website.</p>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-[#0F1F3A]">Analytics, only with your consent</h2>
            <p>If you accept analytics cookies (<strong>Accept all</strong>, or switch on Analytics in <strong>Preferences</strong>), we use Google Analytics on our public pages (the home page, the demo page and job application pages) to count visits and see which pages are useful. If you click <strong>Reject all</strong>, or don&apos;t choose, Google Analytics isn&apos;t loaded at all.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>No advertising or remarketing, and Google signals are switched off.</li>
              <li>Never used on candidate interview pages, in the recruiter workspace, or on sign-in pages.</li>
              <li>Page addresses are trimmed before they&apos;re sent, so they never include private links or codes.</li>
              <li>Google provides this service for us. You can read <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer" className="text-[#0B5BD3] hover:underline">how Google uses information from sites that use its services</a>.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#0F1F3A]">Cookies we use</h2>
            <div className="overflow-x-auto rounded-xl border border-[#DCE4F0] bg-white">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-[#F3F7FC] text-xs text-[#5A6A86]"><tr><th className="px-4 py-2.5 font-medium">Cookie</th><th className="px-4 py-2.5 font-medium">Type</th><th className="px-4 py-2.5 font-medium">Purpose</th><th className="px-4 py-2.5 font-medium">Kept for</th></tr></thead>
                <tbody className="divide-y divide-[#EEF2F8]">
                  {COOKIES.map(([name, type, purpose, ttl]) => (
                    <tr key={name}><td className="px-4 py-3 font-mono text-xs">{name}</td><td className="px-4 py-3">{type}</td><td className="px-4 py-3">{purpose}</td><td className="px-4 py-3 whitespace-nowrap">{ttl}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-[#0F1F3A]">Changing your choice</h2>
            <p>You can change your choice at any time. Declining removes the analytics cookies from your browser.</p>
            <CookieSettingsLink className="inline-flex h-10 items-center rounded-xl border border-[#CBD7EA] bg-white px-5 text-sm font-semibold hover:border-[#0B5BD3] hover:text-[#0B5BD3]" />
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-[#0F1F3A]">Questions</h2>
            <p>Contact us through the <Link href="/#contact" className="text-[#0B5BD3] hover:underline">contact form</Link>.</p>
          </section>
        </div>
      </main>
      <footer className="border-t border-[#E3EAF5] bg-white py-6 text-center"><Copyright /></footer>
    </div>
  );
}
