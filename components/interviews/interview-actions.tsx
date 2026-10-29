"use client";

import { useState } from "react";
import { Ban, Bell, Link2, MoreHorizontal, RefreshCw, Send, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { CopyButton } from "@/components/common/copy-button";
import { useAction } from "@/lib/client/use-action";
import { useRouter } from "next/navigation";

const NOT_STARTED = ["created", "invited", "consent_pending", "device_check", "ready", "expired"];
const FINISHED = ["completing", "completed", "processing", "report_ready", "failed"];

export function InterviewActions({ id, status, canWrite, canDelete, canRegenerate }: { id: string; status: string; canWrite: boolean; canDelete: boolean; canRegenerate: boolean }) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [link, setLink] = useState<string | null>(null);
  const [deleteWhat, setDeleteWhat] = useState<null | "recording" | "transcript" | "report" | "all">(null);
  const notStarted = NOT_STARTED.includes(status);
  const finished = FINISHED.includes(status);
  // Hide the "More actions" button when none of its items apply (e.g. a recruiter on a started interview).
  const hasMenu = (canWrite && notStarted) || canDelete;

  const newLink = async (resend: boolean) => {
    const r = await run<{ link: string }>("link", `/api/interviews/${id}/${resend ? "invite" : "link"}`, { success: resend ? "Invitation sent with a new link" : undefined });
    if (r) setLink(r.link);
  };

  return (
    <>
      {canWrite && notStarted && status !== "expired" && (
        <Button variant="outline" disabled={!!pending} onClick={() => newLink(true)}><Send /> {status === "created" ? "Send invitation" : "Resend invitation"}</Button>
      )}
      {canRegenerate && finished && (
        <Button variant="outline" disabled={!!pending} onClick={() => run("retry", `/api/interviews/${id}/report`, { success: "Re-generating evaluations and report" })}>
          <RefreshCw className={pending === "retry" ? "animate-spin" : ""} /> Regenerate report
        </Button>
      )}
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More actions" />}><MoreHorizontal /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {canWrite && notStarted && <DropdownMenuItem onClick={() => newLink(false)}><Link2 /> Get a new link</DropdownMenuItem>}
            {canWrite && ["invited", "consent_pending", "device_check", "ready"].includes(status) && (
              <DropdownMenuItem onClick={async () => { const r = await run<{ link: string }>("remind", `/api/interviews/${id}/remind`, { success: "Reminder sent" }); if (r) setLink(r.link); }}><Bell /> Send reminder</DropdownMenuItem>
            )}
            {canWrite && notStarted && <DropdownMenuItem onClick={() => run("plan", `/api/interviews/${id}/plan`, { success: "Interview plan regenerated" })}><Wand2 /> Regenerate question plan</DropdownMenuItem>}
            {canWrite && notStarted && status !== "expired" && <DropdownMenuItem onClick={() => run("cancel", `/api/interviews/${id}/cancel`, { success: "Interview cancelled" })}><Ban /> Cancel interview</DropdownMenuItem>}
            {canDelete && finished && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteWhat("recording")}><Trash2 /> Delete recording</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteWhat("transcript")}><Trash2 /> Delete transcript</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteWhat("report")}><Trash2 /> Delete report</DropdownMenuItem>
              </>
            )}
            {canDelete && <DropdownMenuItem variant="destructive" onClick={() => setDeleteWhat("all")}><Trash2 /> Delete interview</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Candidate interview link</DialogTitle>
            <DialogDescription>Previous links no longer work. This link is shown only once.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2"><Input readOnly value={link ?? ""} className="font-mono text-xs" /><CopyButton value={link ?? ""} /></div>
          <DialogFooter><Button onClick={() => setLink(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {deleteWhat && (
        <ConfirmDialog
          key={deleteWhat}
          open
          onOpenChange={(o) => !o && setDeleteWhat(null)}
          title={deleteWhat === "all" ? "Delete this interview?" : `Delete the ${deleteWhat}?`}
          description={deleteWhat === "all" ? "The interview, recording, transcript, evaluations and report will be permanently deleted." : `The ${deleteWhat} will be permanently deleted. This can't be undone.`}
          confirmLabel="Delete permanently"
          destructive
          onConfirm={async () => {
            const r = await run("delete", `/api/interviews/${id}?what=${deleteWhat}`, { method: "DELETE", success: "Deleted", refresh: deleteWhat !== "all" });
            setDeleteWhat(null);
            if (r && deleteWhat === "all") router.push("/interviews");
          }}
        />
      )}
    </>
  );
}
