"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/common/tag-input";
import { api, ClientApiError } from "@/lib/client/api";
import { newRoundKey, type RoundValue, RoundsEditor } from "./rounds-editor";
import { ApplicationQuestionsEditor, HiringLimitsEditor } from "./application-questions-editor";
import { DEFAULT_FORM, NO_LIMITS, type ApplicationForm, type HiringLimits } from "@/lib/application-form";

export type JobFormValue = {
  title: string;
  description: string;
  location: string | null;
  employment_type: string | null;
  experience_min: number | null;
  experience_max: number | null;
  required_skills: string[];
  preferred_skills: string[];
  responsibilities: string[];
  rounds: RoundValue[];
  status: "draft" | "active" | "paused" | "closed";
  face_verification: boolean;
  application_form: ApplicationForm;
  hiring_limits: HiringLimits;
};

const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function Section({ title, description, children, required }: { title: string; description: string; children: React.ReactNode; required?: boolean }) {
  return (
    <section className="grid gap-6 border-b py-8 first:pt-0 last:border-0 md:grid-cols-3">
      <div>
        <h2 className="font-semibold">{title}{required && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-4 md:col-span-2">{children}</div>
    </section>
  );
}

export function JobForm({ initial, jobId, templates }: { initial?: JobFormValue; jobId?: string; templates: { id: string; name: string; total_minutes: number; is_default: boolean }[] }) {
  const router = useRouter();
  const [v, setV] = useState<JobFormValue>(initial ?? {
    title: "", description: "", location: "", employment_type: "full_time", experience_min: null, experience_max: null,
    required_skills: [], preferred_skills: [], responsibilities: [],
    rounds: [{ key: newRoundKey(), name: "Screening", kind: "ai", template_id: templates.find((t) => t.is_default)?.id ?? templates[0]?.id ?? "", criteria: [], guide: "" }], status: "active", face_verification: true,
    application_form: DEFAULT_FORM, hiring_limits: NO_LIMITS,
  });
  const [respText, setRespText] = useState((initial?.responsibilities ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof JobFormValue>(k: K, val: JobFormValue[K]) => setV((p) => ({ ...p, [k]: val }));
  const num = (s: string) => (s === "" ? null : Math.max(0, Math.min(50, Number(s))));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const payload = {
      ...v, location: v.location || null, responsibilities: respText.split("\n").map((s) => s.replace(/^[-*•]\s*/, "").trim()).filter(Boolean),
      application_form: { ...v.application_form, custom: v.application_form.custom.map((q) => ({ ...q, label: q.label.trim(), options: q.options.map((o) => o.trim()).filter(Boolean) })) },
      rounds: v.rounds.map(({ id, name, kind, template_id, criteria, guide }) => ({
        ...(id ? { id } : {}), name: name.trim(), kind,
        ...(kind === "human" ? { template_id: null, criteria, guide: guide.trim() || null } : { template_id }),
      })),
    };
    try {
      const res = await api<{ id?: string }>(jobId ? `/api/jobs/${jobId}` : "/api/jobs", { method: jobId ? "PUT" : "POST", body: payload });
      toast.success(jobId ? "Job updated" : "Job created — analyzing the description with AI");
      router.push(`/jobs/${jobId ?? res.id}`);
      router.refresh();
    } catch (err) {
      const ce = err as ClientApiError;
      setErrors(Object.fromEntries((ce.issues ?? []).map((i) => [i.path, i.message])));
      toast.error(ce.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-xl border bg-card px-6 py-8">
      <p className="-mt-2 mb-6 text-xs text-muted-foreground">Fields marked <span className="text-destructive">*</span> are required.</p>
      <Section title="Basics" description="How the role appears to your team and in candidate invitations.">
        <div className="space-y-1.5">
          <Label htmlFor="title" required>Job title</Label>
          <Input id="title" value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="Senior Full Stack Engineer" aria-invalid={!!errors.title} />
          {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" value={v.location ?? ""} onChange={(e) => set("location", e.target.value)} placeholder="Remote · US" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="type">Employment type</Label>
            <select id="type" className={selectClass} value={v.employment_type ?? ""} onChange={(e) => set("employment_type", e.target.value || null)}>
              <option value="full_time">Full-time</option><option value="part_time">Part-time</option><option value="contract">Contract</option>
              <option value="internship">Internship</option><option value="temporary">Temporary</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emin">Minimum experience (years)</Label>
            <Input id="emin" type="number" min={0} max={50} value={v.experience_min ?? ""} onChange={(e) => set("experience_min", num(e.target.value))} aria-invalid={!!errors.experience_min} />
            {errors.experience_min && <p className="text-xs text-destructive">{errors.experience_min}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emax">Maximum experience (years)</Label>
            <Input id="emax" type="number" min={0} max={50} value={v.experience_max ?? ""} onChange={(e) => set("experience_max", num(e.target.value))} />
          </div>
        </div>
      </Section>
      <Section title="Description & requirements" description="AI parses the description into structured requirements used to personalize every interview.">
        <div className="space-y-1.5">
          <Label htmlFor="desc">Job description</Label>
          <Textarea id="desc" rows={10} value={v.description} onChange={(e) => set("description", e.target.value)} placeholder="Paste the full job description…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="req">Required skills</Label>
          <TagInput id="req" value={v.required_skills} onChange={(t) => set("required_skills", t)} placeholder="Type a skill and press Enter" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pref">Preferred skills</Label>
          <TagInput id="pref" value={v.preferred_skills} onChange={(t) => set("preferred_skills", t)} placeholder="Nice-to-have skills" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="resp">Key responsibilities <span className="font-normal text-muted-foreground">(one per line, optional)</span></Label>
          <Textarea id="resp" rows={4} value={respText} onChange={(e) => setRespText(e.target.value)} />
        </div>
      </Section>
      <Section title="Interview rounds" required description="The interviews candidates go through for this job, in order. An AI round uses a template (sections, timing, questions and follow-ups); a human round is scheduled with your team, who rate the candidate on a scorecard.">
        <RoundsEditor value={v.rounds} onChange={(r) => set("rounds", r)} templates={templates}
          error={Object.entries(errors).find(([k]) => k.startsWith("rounds"))?.[1]} />
        <div className="space-y-1.5">
          <Label htmlFor="status" required>Status</Label>
          <select id="status" className={selectClass} value={v.status} onChange={(e) => set("status", e.target.value as JobFormValue["status"])}>
            <option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="closed">Closed</option>
          </select>
        </div>
      </Section>
      <Section title="Application questions" description="Asked on the apply page, and filled in by your team when you invite someone directly. Answers go into the candidate's HR details.">
        <ApplicationQuestionsEditor value={v.application_form} onChange={(f) => set("application_form", f)}
          error={Object.entries(errors).find(([k]) => k.startsWith("application_form"))?.[1]} />
      </Section>
      <Section title="Hiring limits" description="Budget, notice period and other limits for this role. Answers are checked against them, so HR only needs to call about the exceptions.">
        <HiringLimitsEditor value={v.hiring_limits} onChange={(l) => set("hiring_limits", l)} form={v.application_form}
          error={Object.entries(errors).find(([k]) => k.startsWith("hiring_limits"))?.[1]} />
      </Section>
      <Section title="Identity check" description="Confirm the person interviewing is the same person throughout. The candidate's photo is taken at the setup check and compared with their face during the AI interview.">
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={v.face_verification} onCheckedChange={(c) => set("face_verification", c)} className="mt-0.5" aria-describedby="face-help" />
          <span>
            <span className="font-medium">Face verification</span>
            <span id="face-help" className="mt-0.5 block text-muted-foreground">Flags a different face, another person in view, or the candidate leaving the frame, with photos for your team to review. Candidates are told and give consent first. It never ends or rejects an interview.</span>
          </span>
        </label>
      </Section>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{jobId ? "Save changes" : "Create job"}</Button>
      </div>
    </form>
  );
}
