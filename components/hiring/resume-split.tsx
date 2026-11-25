"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Download, FileText, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The candidate's resume next to the scorecard: open, it takes the left half of the page (the scorecard and
// the rest stay on the right); on a phone it covers the screen until closed. Open/closed lives in the
// address (?resume=1), so the panel email can link straight to it.

export type ResumeInfo = { candidateId: string; name: string; fileName: string; isPdf: boolean; text: string | null };

function useResumeOpen() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const open = params.get("resume") === "1";
  const set = useCallback((on: boolean) => {
    const q = new URLSearchParams(params.toString());
    if (on) q.set("resume", "1"); else q.delete("resume");
    router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [params, router, pathname]);
  return [open, set] as const;
}

/** "View resume" / "Hide resume" and Download, for the Candidate card. */
export function ResumeButtons({ resume }: { resume: ResumeInfo }) {
  const [open, setOpen] = useResumeOpen();
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant={open ? "outline" : "default"} onClick={() => setOpen(!open)}><FileText /> {open ? "Hide resume" : "View resume"}</Button>
      <a href={`/api/candidates/${resume.candidateId}/resume`} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })}><Download /> Download</a>
    </div>
  );
}

function ResumeViewer({ resume, onClose }: { resume: ResumeInfo; onClose: () => void }) {
  return (
    <section aria-label={`${resume.name}'s resume`} className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{resume.name} · <span className="font-normal text-muted-foreground">{resume.fileName}</span></p>
        <a href={`/api/candidates/${resume.candidateId}/resume`} target="_blank" rel="noreferrer" className={buttonVariants({ size: "icon-sm", variant: "ghost" })} aria-label="Download resume"><Download /></a>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close resume"><X /></Button>
      </div>
      {resume.isPdf ? (
        <iframe title={`${resume.name}'s resume`} src={`/api/candidates/${resume.candidateId}/resume/view#view=FitH`} className="min-h-0 w-full flex-1 bg-muted" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <p className="mb-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">This file type can&apos;t be shown here: this is the text read from it. Download it for the original layout.</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{resume.text?.trim() || "No text could be read from this file."}</p>
        </div>
      )}
    </section>
  );
}

/** The page body, with the resume beside it when open. */
export function ResumeSplit({ resume, children }: { resume: ResumeInfo | null; children: React.ReactNode }) {
  const [open, setOpen] = useResumeOpen();
  const show = open && !!resume;
  return (
    <div data-resume={show ? "open" : "closed"} className={cn("group/resume", show && "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6")}>
      {show && (
        <>
          {/* Phone and tablet: full screen until closed. */}
          <div className="fixed inset-0 z-50 flex flex-col bg-background p-3 lg:hidden">
            <ResumeViewer resume={resume} onClose={() => setOpen(false)} />
          </div>
          {/* Desktop: the left half, staying in view while the scorecard scrolls. */}
          <div className="hidden lg:block">
            <div className="sticky top-4 h-[calc(100vh-2rem)]"><ResumeViewer resume={resume} onClose={() => setOpen(false)} /></div>
          </div>
        </>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
