"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type ClientApiError } from "@/lib/client/api";
import { STAGE_LABEL, type Stage } from "@/lib/hiring";
import { decisionEmailReady, DecisionEmailOption, NO_DECISION_EMAIL, sendDecisionEmailIfTicked, type DecisionEmailValue } from "./decision-email-option";

const TITLE: Record<Stage, string> = {
  in_progress: "Move back to in progress", shortlisted: "Shortlist", hired: "Mark as hired", rejected: "Reject", withdrawn: "Mark as withdrawn",
};

/** Move a candidate between stages for a job. */
export function StageControl({ jobId, candidateId, candidateName, stage, allQualified }: { jobId: string; candidateId: string; candidateName: string; stage: Stage; allQualified: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState<Stage | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState<DecisionEmailValue>(NO_DECISION_EMAIL);
  const emailKind = target === "rejected" || target === "shortlisted" ? target : null;
  const needsReason = target === "shortlisted" && !allQualified;
  const open = (s: Stage) => { setNote(""); setEmail(NO_DECISION_EMAIL); setTarget(s); };
  const save = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api("/api/pipeline", { body: { jobId, candidateId, stage: target, note: note.trim() || null } });
      toast.success(`${candidateName}: ${STAGE_LABEL[target]}`);
      if (emailKind) await sendDecisionEmailIfTicked(candidateId, emailKind, email, candidateName);
      setTarget(null);
      router.refresh();
    } catch (e) {
      toast.error((e as ClientApiError).message);
    } finally {
      setBusy(false);
    }
  };
  const actions: { stage: Stage; primary?: boolean }[] =
    stage === "in_progress" ? [{ stage: "shortlisted", primary: allQualified }, { stage: "rejected" }, { stage: "withdrawn" }]
    : stage === "shortlisted" ? [{ stage: "hired", primary: true }, { stage: "rejected" }, { stage: "in_progress" }]
    : [{ stage: "in_progress" }];
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button key={a.stage} size="sm" variant={a.primary ? "default" : a.stage === "rejected" ? "outline" : "ghost"} className={a.stage === "rejected" ? "text-destructive" : undefined} onClick={() => open(a.stage)}>
            {TITLE[a.stage]}
          </Button>
        ))}
      </div>
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{target ? `${TITLE[target]}: ${candidateName}` : ""}</DialogTitle>
            <DialogDescription>
              {needsReason ? "Not every round is marked Qualified yet. Add a short reason to shortlist anyway; it's saved with the decision."
                : target === "rejected" ? "The candidate stays in your records. Nothing is sent to them unless you tick the email below."
                : "Your team sees this on the candidate's profile and the job pipeline."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="stage-note" required={needsReason}>{needsReason ? "Reason" : "Note"}{!needsReason && <span className="font-normal text-muted-foreground"> (optional)</span>}</Label>
            <Textarea id="stage-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {emailKind && <DecisionEmailOption candidateId={candidateId} kind={emailKind} jobIds={[jobId]} value={email} onChange={setEmail} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button disabled={busy || (needsReason && !note.trim()) || !decisionEmailReady(email)} variant={target === "rejected" ? "destructive" : "default"} onClick={save}>{busy && <Loader2 className="animate-spin" />} {target ? TITLE[target] : ""}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
