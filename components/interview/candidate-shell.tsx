import { AlertCircle, Clock, Mail, Phone } from "lucide-react";
import { BrandMark } from "@/components/branding/brand-mark";
import { type Brand, brandStyle } from "@/lib/branding";

/** Candidate pages carry the hiring company's branding only (no platform branding). */
export function CandidateShell({ brand, job, children, step }: { brand?: Brand; job?: string; children: React.ReactNode; step?: number }) {
  return (
    <div className="flex min-h-screen flex-col" style={brandStyle(brand?.color ?? null)}>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            {brand ? <BrandMark brand={brand} height={30} /> : <p className="font-semibold">Interview</p>}
            {job && <p className="mt-0.5 truncate text-xs text-muted-foreground">{job}</p>}
          </div>
          {step != null && (
            <ol className="flex items-center gap-2 text-xs text-muted-foreground" aria-label="Steps">
              {["Welcome", "Consent", "Device check", "Interview"].map((s, i) => (
                <li key={s} className={`flex items-center gap-1.5 ${i === step ? "font-medium text-foreground" : ""}`}>
                  <span className={`flex size-5 items-center justify-center rounded-full text-[10px] ${i <= step ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{i + 1}</span>
                  <span className="hidden sm:inline">{s}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">{children}</main>
      <footer className="flex flex-col items-center gap-2 py-6 text-center text-xs text-muted-foreground">
        <span>Your responses are reviewed by the hiring team.</span>
      </footer>
    </div>
  );
}

export function CandidateError({ message }: { message: string }) {
  return (
    <CandidateShell>
      <div className="mx-auto max-w-md rounded-xl border bg-card p-8 text-center">
        <AlertCircle className="mx-auto size-8 text-muted-foreground" />
        <h1 className="mt-4 text-lg font-semibold">We can&apos;t open this interview</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    </CandidateShell>
  );
}

/**
 * The company has no interviews left: the candidate can't start yet, through no fault of their own.
 * They contact the company themselves; once it adds interviews, this same link works.
 */
export function CandidateOnHold({ brand, job, company, first, contact }: {
  brand?: Brand; job: string; company: string; first: string; contact: { name: string | null; email: string | null; phone: string | null } | null;
}) {
  const who = contact?.name ? `${contact.name.split(" ")[0]} at ${company}` : `the ${company} hiring team`;
  return (
    <CandidateShell brand={brand} job={job}>
      <div className="mx-auto max-w-lg rounded-xl border bg-card p-8 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300"><Clock className="size-6" aria-hidden /></span>
        <h1 className="mt-4 text-xl font-semibold">Your interview can&apos;t start just yet</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Hi {first}, {company} needs to add more interviews to their account before you can begin. This isn&apos;t anything you did.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Please contact {who} and let them know you&apos;re ready. Once they&apos;ve sorted it, come back to <b className="text-foreground">this same link</b> to start your interview.
        </p>
        {(contact?.email || contact?.phone) && (
          <div className="mt-6 space-y-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
            <p className="text-muted-foreground">Contact {who}:</p>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              {contact.email && (
                <a href={`mailto:${contact.email}?subject=${encodeURIComponent(`My interview for ${job}`)}`} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                  <Mail className="size-4" aria-hidden />{contact.email}
                </a>
              )}
              {contact.phone && (
                <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                  <Phone className="size-4" aria-hidden />{contact.phone}
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </CandidateShell>
  );
}
