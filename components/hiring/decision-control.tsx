"use client";

import { useState } from "react";
import { Check, Loader2, Pause, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/lib/client/use-action";
import { DECISION_LABEL, DECISIONS, type Decision } from "@/lib/hiring";
import { cn } from "@/lib/utils";
import { DecisionBadge } from "./badges";
import { decisionEmailReady, DecisionEmailOption, NO_DECISION_EMAIL, sendDecisionEmailIfTicked, type DecisionEmailValue } from "./decision-email-option";

const ICON = { qualified: Check, not_qualified: X, on_hold: Pause } as const;
const ACTIVE: Record<Decision, string> = {
  qualified: "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600/90",
  not_qualified: "border-red-600 bg-red-600 text-white hover:bg-red-600/90",
  on_hold: "border-amber-500 bg-amber-500 text-white hover:bg-amber-500/90",
};

/** The team's decision on one interview round. The AI report and scorecards are advice; this is the call. */
export function DecisionControl({ endpoint, decision, note, decidedBy, decidedOn, canEdit, hint, email }: {
  /** `decidedOn` is already formatted by the server (avoids time-zone differences while hydrating). */
  endpoint: string; decision: Decision | null; note: string | null; decidedBy: string | null; decidedOn: string | null; canEdit: boolean;
  /** e.g. "2 of 2 interviewers recommend Qualified" */
  hint?: string | null;
  /** The round's candidate and job: "Not qualified" + Rejected can also email the candidate. */
  email?: { candidateId: string; jobId: string; name: string };
}) {
  const { run, pending } = useAction();
  const [choice, setChoice] = useState<Decision | null>(null);
  const [text, setText] = useState("");
  const [clearing, setClearing] = useState(false);
  const [reason, setReason] = useState("");
  // Not qualified usually ends the candidate's application: offer to move them to Rejected in the same step.
  const [reject, setReject] = useState(true);
  const [mail, setMail] = useState<DecisionEmailValue>(NO_DECISION_EMAIL);
  const offerEmail = !!email && choice === "not_qualified" && reject;
  const save = async (d: Decision | null, n: string | null) => {
    const alsoReject = d === "not_qualified" && reject;
    const ok = await run("decide", endpoint, {
      body: { decision: d, note: n, ...(alsoReject ? { reject: true } : {}) },
      success: d ? `Marked ${DECISION_LABEL[d]}${alsoReject ? " and moved to Rejected" : ""}` : "Round reopened",
    });
    if (ok && alsoReject && email) await sendDecisionEmailIfTicked(email.candidateId, "rejected", mail, email.name);
    if (ok) { setChoice(null); setClearing(false); }
  };
  return (
    <div className="space-y-3">
      {decision ? (
        <div className="space-y-1">
          <DecisionBadge decision={decision} className="text-sm" />
          <p className="text-xs text-muted-foreground">{[decidedBy && `by ${decidedBy}`, decidedOn].filter(Boolean).join(" · ")}</p>
          {note && <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-sm">{note}</p>}
        </div>
      ) : <p className="text-sm text-muted-foreground">No decision yet.</p>}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {DECISIONS.map((d) => {
            const Icon = ICON[d];
            return (
              <Button key={d} size="sm" variant="outline" disabled={!!pending} className={cn(decision === d && ACTIVE[d])}
                onClick={() => { setText(decision === d ? note ?? "" : ""); setReject(true); setMail(NO_DECISION_EMAIL); setChoice(d); }} aria-pressed={decision === d}>
                <Icon /> {DECISION_LABEL[d]}
              </Button>
            );
          })}
          {decision && <Button size="sm" variant="ghost" disabled={!!pending} onClick={() => { setReason(""); setClearing(true); }}>Clear</Button>}
        </div>
      )}
      <Dialog open={clearing} onOpenChange={setClearing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen this round?</DialogTitle>
            <DialogDescription>The decision is removed and interviewers can edit their scorecards again. The reason and any scorecard changes are shown to your team in the history.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="clear-reason" required>Reason</Label>
            <Textarea id="clear-reason" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. New information from the reference check" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearing(false)}>Keep decision</Button>
            <Button disabled={!!pending || !reason.trim()} onClick={() => save(null, reason.trim())}>{pending && <Loader2 className="animate-spin" />} Reopen round</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!choice} onOpenChange={(o) => !o && setChoice(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mark this round {choice ? DECISION_LABEL[choice] : ""}?</DialogTitle>
            <DialogDescription>Your team sees the decision on the candidate&apos;s profile and the job pipeline.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="decision-note">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="decision-note" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Strong on APIs, needs to go deeper on system design" />
          </div>
          {choice === "not_qualified" && (
            <label className="flex items-start gap-3 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
              <Checkbox checked={reject} onCheckedChange={(c) => setReject(!!c)} className="mt-0.5" />
              <span>
                <span className="font-medium">Also move the candidate to Rejected for this job</span>
                <span className="block text-xs text-muted-foreground">Untick to keep them in progress, for example to give them another round. A hired candidate isn&apos;t changed.</span>
              </span>
            </label>
          )}
          {offerEmail && <DecisionEmailOption candidateId={email.candidateId} kind="rejected" jobIds={[email.jobId]} value={mail} onChange={setMail} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setChoice(null)}>Cancel</Button>
            <Button disabled={!!pending || (offerEmail && !decisionEmailReady(mail))} onClick={() => choice && save(choice, text.trim() || null)}>{pending && <Loader2 className="animate-spin" />} Save decision</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
