"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, FileText } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PdfPages } from "./pdf-pages";

// The candidate's resume in a large dialog, so it's easy to read. Open/closed lives in the address
// (?resume=1), so the panel email can link straight to it.

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

/** "View resume" and Download, for the Candidate card. */
export function ResumeButtons({ resume }: { resume: ResumeInfo }) {
  const [, setOpen] = useResumeOpen();
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setOpen(true)}><FileText /> View resume</Button>
      <a href={`/api/candidates/${resume.candidateId}/resume`} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })}><Download /> Download</a>
    </div>
  );
}

/** The page, plus the resume dialog when it's open. */
export function ResumeSplit({ resume, children }: { resume: ResumeInfo | null; children: React.ReactNode }) {
  const [open, setOpen] = useResumeOpen();
  // The dialog can't start open while the page loads (the email link, ?resume=1): it opens one frame later.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const viewUrl = resume ? `/api/candidates/${resume.candidateId}/resume/view` : "";
  return (
    <>
      {children}
      {resume && (
        <Dialog open={open && ready} onOpenChange={setOpen}>
          <DialogContent className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
            <div className="flex items-center gap-2 border-b py-3 pr-12 pl-4">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-base">{resume.name}&apos;s resume</DialogTitle>
                <DialogDescription className="truncate text-xs">{resume.fileName}</DialogDescription>
              </div>
              {resume.isPdf && (
                <a href={viewUrl} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "ghost" })} aria-label="Open in a new tab"><ExternalLink /><span className="hidden sm:inline">New tab</span></a>
              )}
              <a href={`/api/candidates/${resume.candidateId}/resume`} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })} aria-label="Download resume"><Download /><span className="hidden sm:inline">Download</span></a>
            </div>
            {resume.isPdf ? (
              <PdfPages url={viewUrl} title={`${resume.name}'s resume`} />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-10">
                <p className="mb-4 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">This file type can&apos;t be shown here: this is the text read from it. Download it for the original layout.</p>
                <p className="mx-auto max-w-3xl text-[15px] leading-7 whitespace-pre-wrap">{resume.text?.trim() || "No text could be read from this file."}</p>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
