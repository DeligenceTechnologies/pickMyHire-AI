"use client";

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client/api";
import { toastEmailResult } from "@/lib/client/email-result";
import { formatDate } from "@/lib/format";

export type DecisionKind = "rejected" | "shortlisted";
export type DecisionEmailValue = { send: boolean; subject: string; text: string; jobIds: string[] };
export const NO_DECISION_EMAIL: DecisionEmailValue = { send: false, subject: "", text: "", jobIds: [] };

type Draft = {
  to: string; candidateName: string; jobs: { id: string; title: string }[]; subject: string; text: string;
  sent: { job_title: string; sent_at: string; sent_by_name: string | null }[];
};

/**
 * "Email the candidate" in a decision dialog: unticked, with the default message to read and edit
 * before it goes. `jobIds` null: every job the candidate is in (archiving).
 */
export function DecisionEmailOption({ candidateId, kind, jobIds, value, onChange }: {
  candidateId: string; kind: DecisionKind; jobIds: string[] | null; value: DecisionEmailValue; onChange: (v: DecisionEmailValue) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [failed, setFailed] = useState(false);
  const key = jobIds?.join(",") ?? "";
  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ kind });
    if (key) q.set("jobs", key);
    api<Draft>(`/api/candidates/${candidateId}/decision-email?${q}`, { method: "GET" })
      .then((d) => { if (live) { setDraft(d); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [candidateId, kind, key]);

  if (failed || !draft) return null;
  const first = draft.candidateName.split(" ")[0];
  if (!draft.jobs.length) {
    const last = draft.sent[0];
    return last ? (
      <p className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
        <Mail className="size-4 shrink-0" aria-hidden />
        Already emailed {first} on {formatDate(last.sent_at)}{last.sent_by_name ? ` by ${last.sent_by_name}` : ""}.
      </p>
    ) : null;
  }
  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 px-3 py-2.5">
      <label className="flex items-start gap-3 text-sm">
        <Checkbox checked={value.send} className="mt-0.5"
          onCheckedChange={(c) => onChange(c ? { send: true, subject: value.subject || draft.subject, text: value.text || draft.text, jobIds: draft.jobs.map((j) => j.id) } : { ...value, send: false })} />
        <span>
          <span className="font-medium">Email {first} {kind === "rejected" ? "that we're not moving forward" : "that we're moving forward"}</span>
          <span className="block text-xs text-muted-foreground">Optional. You can read and change the message first. It never includes the reason or your notes.</span>
        </span>
      </label>
      {value.send && (
        <div className="space-y-2.5">
          <p className="text-xs text-muted-foreground">To: <span className="font-medium text-foreground">{draft.to}</span> · Replies come to you</p>
          <div className="space-y-1.5">
            <Label htmlFor="de-subject">Subject</Label>
            <Input id="de-subject" maxLength={200} value={value.subject} onChange={(e) => onChange({ ...value, subject: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="de-text">Message</Label>
            <Textarea id="de-text" rows={8} maxLength={4000} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Whether the ticked email is ready to send (empty subject or message would be refused). */
export const decisionEmailReady = (v: DecisionEmailValue) => !v.send || (v.subject.trim().length >= 3 && v.text.trim().length >= 20);

/** After the decision is saved: send the email if it was ticked. The decision stays saved either way. */
export async function sendDecisionEmailIfTicked(candidateId: string, kind: DecisionKind, v: DecisionEmailValue, name: string) {
  if (!v.send || !v.jobIds.length) return;
  try {
    const res = await api(`/api/candidates/${candidateId}/decision-email`, { body: { kind, jobIds: v.jobIds, subject: v.subject, text: v.text } });
    toastEmailResult(res, `Email sent to ${name}`, "The decision is saved. Please email them yourself.");
  } catch (err) {
    toast.error(`The decision is saved, but the email wasn't sent: ${(err as Error).message}`);
  }
}
