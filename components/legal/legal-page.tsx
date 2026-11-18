import Link from "next/link";
import { CookieSettingsLink } from "@/components/analytics/analytics";
import { Copyright } from "@/components/layout/logo";
import { SiteHeader } from "@/components/marketing/site-header";
import { getAppLink } from "@/lib/auth/session";
import { LEGAL } from "@/lib/legal";
import { getTrialSettings } from "@/lib/services/platform";
import { cn } from "@/lib/utils";

/** A legal detail, or a yellow placeholder while it's still missing. */
export function Fill({ v, label }: { v: string | number | null | undefined; label: string }) {
  if (v !== null && v !== undefined && v !== "") return <>{v}</>;
  return <mark className="rounded bg-amber-100 px-1 font-medium text-amber-900">[to fill: {label}]</mark>;
}

/** Terms · Privacy · Refunds · Cookies, for every public footer. */
export function LegalLinks({ className, linkClassName = "hover:text-[#0B5BD3]" }: { className?: string; linkClassName?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-[#5A6A86]", className)}>
      <Link href="/terms" className={linkClassName}>Terms</Link>
      <Link href="/privacy" className={linkClassName}>Privacy</Link>
      <Link href="/refunds" className={linkClassName}>Refunds</Link>
      <Link href="/cookies" className={linkClassName}>Cookie policy</Link>
      <CookieSettingsLink className={linkClassName} />
    </div>
  );
}

export type LegalSection = { id: string; title: string; body: React.ReactNode };

/** Shared layout for /terms, /privacy and /refunds: title, summary, contents list, sections. */
export async function LegalPage({ eyebrow, title, intro, sections }: { eyebrow: string; title: string; intro: React.ReactNode; sections: LegalSection[] }) {
  const [trial, app] = await Promise.all([getTrialSettings(), getAppLink()]);
  return (
    <div className="min-h-screen bg-[#F8FAFD] text-[#0F1F3A]">
      <SiteHeader trial={trial.enabled} app={app} />
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8">
        {LEGAL.draft && (
          <p className="mb-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <b>Draft.</b> This document hasn&apos;t been reviewed by a lawyer yet. Yellow parts still need company details.
          </p>
        )}
        <p className="text-sm font-semibold tracking-[0.18em] text-[#0B5BD3] uppercase">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-[#5A6A86]">Last updated {LEGAL.lastUpdated}</p>
        <div className="mt-6 text-[15px] leading-relaxed text-[#3D4D6A]">{intro}</div>

        <nav aria-label="Contents" className="mt-8 rounded-xl border border-[#DCE4F0] bg-white p-5">
          <p className="text-xs font-semibold tracking-wide text-[#5A6A86] uppercase">Contents</p>
          <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {sections.map((s, i) => <li key={s.id}><a href={`#${s.id}`} className="text-[#0B5BD3] hover:underline">{i + 1}. {s.title}</a></li>)}
          </ol>
        </nav>

        <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-[#3D4D6A]">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 space-y-3 [&_a]:text-[#0B5BD3] [&_a:hover]:underline [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
              <h2 className="text-xl font-semibold text-[#0F1F3A]">{i + 1}. {s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>
      </main>
      <footer className="border-t border-[#E3EAF5] bg-white py-6 text-center"><Copyright /><LegalLinks className="mt-2" /></footer>
    </div>
  );
}

/** Contact block used at the end of each legal page. */
export function ContactBlock() {
  return (
    <ul>
      <li>Company: <Fill v={LEGAL.companyLegalName} label="legal company name" /></li>
      <li>Address: <Fill v={LEGAL.registeredAddress} label="registered address" /></li>
      <li>Registration number: <Fill v={LEGAL.registrationNumber} label="registration number (e.g. CIN)" /> · Tax ID: <Fill v={LEGAL.taxId} label="GST / tax ID" /></li>
      <li>Support: <Fill v={LEGAL.supportEmail} label="support email" /> · Billing: <Fill v={LEGAL.billingEmail} label="billing email" /> · Privacy: <Fill v={LEGAL.privacyEmail} label="privacy email" /></li>
    </ul>
  );
}
