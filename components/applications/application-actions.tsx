"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Send, XCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/common/copy-button";
import { useAction } from "@/lib/client/use-action";
import { emptyChoice, type RoundChoice, RoundPicker } from "@/components/interview/round-picker";

export function ApplicationActions({ id, status, interviewId, canWrite, canInvite, jobId, candidateId, candidateName }: {
  id: string; status: string; interviewId: string | null; canWrite: boolean; canInvite: boolean; jobId: string; candidateId: string; candidateName: string;
}) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sendInvite, setSendInvite] = useState(true);
  const [link, setLink] = useState<string | null>(null);
  const [choice, setChoice] = useState<RoundChoice>(emptyChoice);
  const [blocked, setBlocked] = useState(false);

  const invited = !!interviewId;
  return (
    <>
      {invited && <Link href={`/interviews/${interviewId}`} className={buttonVariants()}>View interview</Link>}
      {!invited && canWrite && (
        <Button variant="outline" size="icon" aria-label="Re-run AI screening" title="Re-run AI screening" disabled={!!pending}
          onClick={() => run("screen", `/api/applications/${id}/screen`, { success: "Screening updated" })}>
          <RefreshCw className={pending === "screen" ? "animate-spin" : ""} />
        </Button>
      )}
      {!invited && canWrite && status !== "declined" && (
        <Button variant="outline" disabled={!!pending} onClick={() => run("decline", `/api/applications/${id}`, { method: "PATCH", body: { status: "declined" }, success: "Marked as not moving forward" })}>
          <XCircle /> Not moving forward
        </Button>
      )}
      {!invited && canWrite && status === "declined" && (
        <Button variant="outline" disabled={!!pending} onClick={() => run("reopen", `/api/applications/${id}`, { method: "PATCH", body: { status: "new" }, success: "Application reopened" })}>Reopen</Button>
      )}
      {canInvite && (
        <Button variant={invited ? "outline" : "default"} onClick={() => { setLink(null); setOpen(true); }}>
          <Send /> {invited ? "Invite to another round" : "Invite to AI interview"}
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          {link ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="size-5 text-emerald-600" /> Interview created</DialogTitle>
                <DialogDescription>{sendInvite ? "The invitation email has been sent. " : ""}This personal link is shown only once.</DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2"><Input readOnly value={link} className="font-mono text-xs" /><CopyButton value={link} /></div>
              <DialogFooter><Button onClick={() => { setOpen(false); router.refresh(); }}>Done</Button></DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Invite to AI interview</DialogTitle>
                <DialogDescription>A personalized interview is generated from this job and the applicant&apos;s resume, using the round&apos;s template.</DialogDescription>
              </DialogHeader>
              {open && <RoundPicker jobId={jobId} candidateId={candidateId} candidateName={candidateName} onChange={(c, b) => { setChoice(c); setBlocked(b); }} />}
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={sendInvite} onCheckedChange={(c) => setSendInvite(!!c)} /> Email the invitation to the applicant now</label>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button disabled={!!pending || blocked} onClick={async () => {
                  const r = await run<{ link: string }>("invite", `/api/applications/${id}/invite`, { body: { sendInvite, ...choice }, success: "Interview created", refresh: false });
                  if (r) setLink(r.link);
                }}>{pending === "invite" && <Loader2 className="animate-spin" />}{sendInvite ? "Send invitation" : "Create interview"}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
