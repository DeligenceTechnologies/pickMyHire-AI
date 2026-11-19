"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FileText, Loader2, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/client/api";

/** Add a candidate with their resume, optionally for a job (their resume is then checked against it). */
export function NewCandidateDialog({ jobs = [] }: { jobs?: { id: string; label: string }[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState(sp.get("new") === "1");
  const [v, setV] = useState({ name: "", email: "", phone: "" });
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus /> Add candidate</Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add candidate</DialogTitle>
            <DialogDescription>A resume is required: the AI interview is planned from it.</DialogDescription>
          </DialogHeader>
          <form id="new-cand" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            if (!file) { setErrors({ file: "A resume is required." }); return; }
            setBusy(true);
            setErrors({});
            try {
              const fd = new FormData();
              fd.append("name", v.name);
              fd.append("email", v.email);
              fd.append("phone", v.phone);
              fd.append("file", file);
              if (jobId) fd.append("jobId", jobId);
              const { id } = await api<{ id: string }>("/api/candidates", { body: fd });
              toast.success("Candidate added");
              router.push(`/candidates/${id}`);
            } catch (err) {
              const ce = err as ClientApiError;
              setErrors(Object.fromEntries((ce.issues ?? []).map((i) => [i.path, i.message])));
              if (!ce.issues) { if (ce.status === 413 || ce.status === 422) setErrors({ file: ce.message }); else toast.error(ce.message); }
              setBusy(false);
            }
          }}>
            {(["name", "email", "phone"] as const).map((k) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={`c-${k}`} required={k !== "phone"}>{k === "name" ? "Full name" : k === "email" ? "Email" : <>Phone <span className="font-normal text-muted-foreground">(optional)</span></>}</Label>
                <Input id={`c-${k}`} type={k === "email" ? "email" : "text"} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-invalid={!!errors[k]} />
                {errors[k] && <p className="text-xs text-destructive">{errors[k]}</p>}
              </div>
            ))}
            {jobs.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="c-job">For job <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <select id="c-job" value={jobId} onChange={(e) => setJobId(e.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                  <option value="">No job yet</option>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">Their resume is checked against this job, and you see the match before inviting.</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="c-file" required>Resume <span className="font-normal text-muted-foreground">(PDF, DOCX or TXT, up to 10 MB)</span></Label>
              <label htmlFor="c-file" className={`flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 text-sm hover:bg-muted ${errors.file ? "border-destructive" : ""} ${file ? "text-foreground" : "text-muted-foreground"}`}>
                {file ? <FileText className="size-4 shrink-0 text-primary" aria-hidden /> : <Upload className="size-4 shrink-0" aria-hidden />}
                <span className="truncate">{file ? file.name : "Choose the resume file"}</span>
              </label>
              <input id="c-file" type="file" accept=".pdf,.docx,.txt" className="sr-only" aria-invalid={!!errors.file} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErrors(({ file: _f, ...rest }) => rest); }} />
              {errors.file && <p className="text-xs text-destructive">{errors.file}</p>}
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" form="new-cand" disabled={busy}>{busy && <Loader2 className="animate-spin" />}Add candidate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
