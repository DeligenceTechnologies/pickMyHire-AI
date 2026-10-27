"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/common/copy-button";
import { api, ClientApiError } from "@/lib/client/api";
import { emptyChoice, type RoundChoice, RoundPicker } from "./round-picker";
import { emptyValues, pruneErrors, QuestionFields, valuesFromAnswers, type AnswerValues } from "@/components/applications/question-fields";
import { validateAnswers, type ApplicationForm } from "@/lib/application-form";

type Option = { id: string; label: string; sub?: string };

const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Invite a candidate to an AI interview. Used from a job (pick/create a
 * candidate) or from a candidate (pick a job).
 */
export function InviteDialog({ jobId, candidateId, candidateName, jobs, triggerLabel = "Invite candidate" }: {
  jobId?: string;
  candidateId?: string;
  candidateName?: string;
  jobs?: Option[];
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">(candidateId ? "existing" : "new");
  const [candidates, setCandidates] = useState<Option[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState(candidateId ?? "");
  const [selectedJob, setSelectedJob] = useState(jobId ?? jobs?.[0]?.id ?? "");
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [file, setFile] = useState<File | null>(null);
  const [sendInvite, setSendInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [choice, setChoice] = useState<RoundChoice>(emptyChoice);
  const [blocked, setBlocked] = useState(false);
  const [questions, setQuestions] = useState<ApplicationForm | null>(null);
  const [answers, setAnswers] = useState<AnswerValues>(emptyValues);
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const existingId = candidateId ?? (mode === "existing" ? selectedCandidate : "");

  // The job's application questions: the person inviting fills them in from what the candidate told them.
  useEffect(() => {
    if (!open || !selectedJob) return;
    let live = true;
    api<{ form: ApplicationForm }>(`/api/jobs/${selectedJob}/application-form`).then((r) => {
      if (!live) return;
      const has = Object.values(r.form.standard).some((q) => q.enabled) || r.form.custom.length > 0;
      setQuestions(has ? r.form : null);
    }).catch(() => live && setQuestions(null));
    return () => { live = false; };
  }, [open, selectedJob]);

  // Answers already on file for this candidate and job are filled in.
  useEffect(() => {
    if (!open || !selectedJob) return;
    let live = true;
    const load = existingId
      ? api<{ answers: Record<string, unknown> | null }>(`/api/candidates/${existingId}/jobs/${selectedJob}/answers`).then((r) => r.answers)
      : Promise.resolve(null);
    load.then((found) => { if (live) { setAnswers(valuesFromAnswers(found)); setAnswerErrors({}); } }).catch(() => {});
    return () => { live = false; };
  }, [open, selectedJob, existingId]);

  useEffect(() => {
    if (!open || candidateId || mode !== "existing") return;
    const t = setTimeout(() => {
      api<{ rows: { id: string; name: string; email: string }[] }>(`/api/candidates?q=${encodeURIComponent(search)}`)
        .then((r) => setCandidates(r.rows.map((c) => ({ id: c.id, label: c.name, sub: c.email }))))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [open, search, mode, candidateId]);

  const reset = () => {
    setLink(null); setError(null); setForm({ name: "", email: "", phone: "" }); setFile(null); setBusy(false); setAnswers(emptyValues()); setAnswerErrors({});
    if (!candidateId) setSelectedCandidate("");
  };

  const submit = async () => {
    setError(null);
    setAnswerErrors({});
    if (questions) {
      const checked = validateAnswers(questions, answers);
      if (Object.keys(checked.errors).length) {
        setAnswerErrors(checked.errors);
        setError("Please fill in the candidate's answers in the right format.");
        return;
      }
    }
    setBusy(true);
    try {
      let cid = selectedCandidate;
      if (!candidateId && mode === "new") {
        const res = await api<{ id: string }>("/api/candidates", { body: { name: form.name, email: form.email, phone: form.phone || null } });
        cid = res.id;
        if (file) {
          const fd = new FormData();
          fd.append("file", file);
          const up = await fetch(`/api/candidates/${cid}/resume`, { method: "POST", body: fd });
          if (!up.ok) toast.warning(((await up.json().catch(() => ({}))) as { error?: string }).error ?? "Resume upload failed — you can upload it from the candidate page.");
          else await new Promise((r) => setTimeout(r, 400)); // let resume parsing begin before planning
        }
      }
      if (!cid) throw new ClientApiError("Select a candidate.", 400);
      if (!selectedJob) throw new ClientApiError("Select a job.", 400);
      if (questions) {
        try {
          await api(`/api/candidates/${cid}/jobs/${selectedJob}/answers`, { method: "PUT", body: { answers } });
        } catch (e) {
          const issues = (e as ClientApiError).issues ?? [];
          setAnswerErrors(Object.fromEntries(issues.filter((i) => i.path.startsWith("answers.")).map((i) => [i.path.slice(8), i.message])));
          throw e;
        }
      }
      const res = await api<{ id: string; link: string }>("/api/interviews", { body: { jobId: selectedJob, candidateId: cid, sendInvite, ...choice } });
      setLink(res.link);
      toast.success(sendInvite ? "Invitation sent" : "Interview created");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={() => { reset(); setOpen(true); }}><Send /> {triggerLabel}</Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          {link ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="size-5 text-emerald-600" /> Interview ready</DialogTitle>
                <DialogDescription>
                  {sendInvite ? "The invitation email has been sent. " : ""}This is the candidate&apos;s personal link. For security it&apos;s shown only now — you can issue a new one later from the interview page.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                <CopyButton value={link} />
              </div>
              <p className="text-xs text-muted-foreground">The personalized interview plan is being generated from the job and resume. The candidate can start once it&apos;s ready (usually under a minute).</p>
              <DialogFooter><Button onClick={() => setOpen(false)}>Done</Button></DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Invite to AI interview</DialogTitle>
                <DialogDescription>The candidate receives a secure link to a personalized video interview.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {!jobId && jobs && (
                  <div className="space-y-1.5">
                    <Label htmlFor="inv-job" required>Job</Label>
                    <select id="inv-job" className={selectClass} value={selectedJob} onChange={(e) => setSelectedJob(e.target.value)}>
                      {jobs.length === 0 && <option value="">No active jobs</option>}
                      {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
                    </select>
                  </div>
                )}
                {!candidateId && (
                  <>
                    <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
                      {(["new", "existing"] as const).map((m) => (
                        <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md py-1.5 font-medium ${mode === m ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
                          {m === "new" ? "New candidate" : "Existing candidate"}
                        </button>
                      ))}
                    </div>
                    {mode === "new" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5"><Label htmlFor="inv-name" required>Full name</Label><Input id="inv-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                        <div className="space-y-1.5"><Label htmlFor="inv-email" required>Email</Label><Input id="inv-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                        <div className="space-y-1.5"><Label htmlFor="inv-phone">Phone <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="inv-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                        <div className="space-y-1.5">
                          <Label htmlFor="inv-file">Resume <span className="font-normal text-muted-foreground">(optional · PDF/DOCX)</span></Label>
                          <label htmlFor="inv-file" className="flex h-9 cursor-pointer items-center gap-2 truncate rounded-lg border border-dashed px-2.5 text-sm text-muted-foreground hover:bg-muted">
                            <Upload className="size-4 shrink-0" /> <span className="truncate">{file ? file.name : "Choose file"}</span>
                          </label>
                          <input id="inv-file" type="file" accept=".pdf,.docx,.txt" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Input placeholder="Search candidates…" value={search} onChange={(e) => setSearch(e.target.value)} />
                        <div className="max-h-48 overflow-y-auto rounded-lg border">
                          {candidates.length === 0 && <p className="p-3 text-center text-sm text-muted-foreground">No candidates found.</p>}
                          {candidates.map((c) => (
                            <button key={c.id} type="button" onClick={() => setSelectedCandidate(c.id)}
                              className={`flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-0 ${selectedCandidate === c.id ? "bg-accent" : "hover:bg-muted"}`}>
                              <span className="font-medium">{c.label}</span><span className="text-xs text-muted-foreground">{c.sub}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {questions && (
                  <details open className="rounded-lg border px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium">Candidate&apos;s answers <span className="font-normal text-muted-foreground">(from your call or their email)</span></summary>
                    <div className="mt-3"><QuestionFields form={questions} values={answers} onChange={(v) => { setAnswerErrors((e) => pruneErrors(e, answers, v)); setAnswers(v); }} errors={answerErrors} idPrefix="inv-q" /></div>
                  </details>
                )}
                {selectedJob && (
                  <RoundPicker
                    jobId={selectedJob}
                    candidateId={candidateId ?? (mode === "existing" && selectedCandidate ? selectedCandidate : null)}
                    candidateName={candidateName ?? (mode === "new" ? form.name : candidates.find((c) => c.id === selectedCandidate)?.label)}
                    onChange={(c, b) => { setChoice(c); setBlocked(b); }}
                  />
                )}
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={sendInvite} onCheckedChange={(c) => setSendInvite(!!c)} /> Email the invitation to the candidate now
                </label>
                {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
                <Button onClick={submit} disabled={busy || blocked}>{busy && <Loader2 className="animate-spin" />}{sendInvite ? "Send invitation" : "Create interview"}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
