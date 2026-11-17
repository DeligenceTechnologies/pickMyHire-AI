"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Clock, GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { TagInput } from "@/components/common/tag-input";
import { api, ClientApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { SECTION_TEXT_LIMITS } from "@/types/interview";

export type SectionDraft = {
  key: string;
  name: string;
  description: string;
  objective: string;
  instructions: string;
  duration_minutes: number;
  min_questions: number;
  max_questions: number;
  max_followups: number;
  evaluation_criteria: string[];
  scoring_enabled: boolean;
  enabled: boolean;
};

const blank = (): SectionDraft => ({
  key: crypto.randomUUID(), name: "New section", description: "", objective: "", instructions: "",
  duration_minutes: 5, min_questions: 1, max_questions: 3, max_followups: 2, evaluation_criteria: [], scoring_enabled: true, enabled: true,
});

function NumberField({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))} className="tabular" />
    </div>
  );
}

function SectionEditor({ s, index, count, onChange, onMove, onRemove }: {
  s: SectionDraft; index: number; count: number;
  onChange: (patch: Partial<SectionDraft>) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-xl border bg-card ${s.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <GripVertical className="size-4 text-muted-foreground" aria-hidden />
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular">{index + 1}</span>
        <button type="button" onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left">
          <p className="truncate font-medium">{s.name || "Untitled section"}</p>
          <p className="truncate text-xs text-muted-foreground">{s.objective || "No objective set"}</p>
        </button>
        <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex"><Clock className="size-3" />{s.duration_minutes} min · {s.min_questions}–{s.max_questions} Qs</span>
        <Switch checked={s.enabled} onCheckedChange={(c) => onChange({ enabled: !!c })} aria-label="Section enabled" />
        <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up"><ArrowUp /></Button>
        <Button type="button" variant="ghost" size="icon-sm" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down"><ArrowDown /></Button>
        <Button type="button" variant="ghost" size="icon-sm" disabled={count <= 1} onClick={onRemove} aria-label="Remove section"><Trash2 /></Button>
      </div>
      {open && (
        <div className="grid gap-4 border-t px-4 py-4 md:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor={`n-${s.key}`} required>Section name</Label><Input id={`n-${s.key}`} value={s.name} onChange={(e) => onChange({ name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor={`o-${s.key}`}>Objective</Label><Input id={`o-${s.key}`} value={s.objective} onChange={(e) => onChange({ objective: e.target.value })} placeholder="Validate hands-on ownership and technical depth" /></div>
          <div className="grid grid-cols-2 gap-3 md:col-span-2 md:grid-cols-4">
            <NumberField id={`d-${s.key}`} label="Duration (min)" value={s.duration_minutes} min={1} max={60} onChange={(n) => onChange({ duration_minutes: n })} />
            <NumberField id={`mi-${s.key}`} label="Min questions" value={s.min_questions} min={0} max={10} onChange={(n) => onChange({ min_questions: n })} />
            <NumberField id={`ma-${s.key}`} label="Max questions" value={s.max_questions} min={1} max={12} onChange={(n) => onChange({ max_questions: n })} />
            <NumberField id={`f-${s.key}`} label="Follow-ups / question" value={s.max_followups} min={0} max={5} onChange={(n) => onChange({ max_followups: n })} />
          </div>
          <div className="space-y-1.5 md:col-span-2"><Label htmlFor={`c-${s.key}`}>Evaluation criteria</Label><TagInput id={`c-${s.key}`} value={s.evaluation_criteria} onChange={(v) => onChange({ evaluation_criteria: v })} placeholder="e.g. Ownership, Technical depth" /></div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor={`i-${s.key}`}>Interviewer instructions <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id={`i-${s.key}`} rows={s.instructions.length > 300 ? 6 : 2} value={s.instructions} onChange={(e) => onChange({ instructions: e.target.value })} placeholder="Probe personal contribution versus team contribution." aria-invalid={s.instructions.length > SECTION_TEXT_LIMITS.instructions} />
            <p className={cn("text-right text-xs tabular", s.instructions.length > SECTION_TEXT_LIMITS.instructions ? "font-medium text-destructive" : "text-muted-foreground")}>
              {s.instructions.length > SECTION_TEXT_LIMITS.instructions && "Too long, please shorten. "}{s.instructions.length.toLocaleString("en-US")}/{SECTION_TEXT_LIMITS.instructions.toLocaleString("en-US")}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <Switch checked={s.scoring_enabled} onCheckedChange={(c) => onChange({ scoring_enabled: !!c })} /> Show a 1–5 assessment score for this section (always backed by evidence)
          </label>
        </div>
      )}
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = { name: "Section name", description: "Description", objective: "Objective", instructions: "Interviewer instructions", evaluation_criteria: "Evaluation criteria" };

/** "Section 2 (Technical SEO)": how a section is named in messages. */
function sectionLabel(sections: SectionDraft[], i: number) {
  const name = sections[i]?.name?.trim();
  return `Section ${i + 1}${name ? ` (${name})` : ""}`;
}

/** A clear message for the first section text over its limit, or null. */
function textTooLong(sections: SectionDraft[]): string | null {
  for (const [i, s] of sections.entries()) {
    for (const f of ["instructions", "objective", "description"] as const) {
      const max = SECTION_TEXT_LIMITS[f];
      if ((s[f] ?? "").length > max) return `${sectionLabel(sections, i)}: ${FIELD_LABEL[f]} is ${(s[f] ?? "").length.toLocaleString("en-US")} characters. The limit is ${max.toLocaleString("en-US")}, please shorten it.`;
    }
  }
  return null;
}

/** Turn a server error like "sections.1.instructions: Too big" into "Section 2 (Technical SEO), Interviewer instructions: …". */
function friendlyIssue(issue: { path: string; message: string }, sections: SectionDraft[]) {
  const m = issue.path.match(/^sections\.(\d+)\.(\w+)/);
  if (!m) return issue.path ? `${issue.path}: ${issue.message}` : issue.message;
  return `${sectionLabel(sections, Number(m[1]))}, ${FIELD_LABEL[m[2]] ?? m[2]}: ${issue.message}`;
}

export function TemplateEditor({ templateId, initial, canWrite }: { templateId?: string; initial?: { name: string; description: string; sections: SectionDraft[] }; canWrite: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sections, setSections] = useState<SectionDraft[]>(initial?.sections ?? [blank()]);
  const [busy, setBusy] = useState(false);
  const total = sections.filter((s) => s.enabled).reduce((a, s) => a + s.duration_minutes, 0);

  const update = (i: number, patch: Partial<SectionDraft>) => setSections((p) => p.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) => setSections((p) => { const n = [...p]; [n[i], n[i + dir]] = [n[i + dir], n[i]]; return n; });

  const save = async () => {
    const over = textTooLong(sections);
    if (over) { toast.error(over); return; }
    setBusy(true);
    try {
      const body = { name, description, sections: sections.map(({ key: _k, ...s }) => s) };
      const res = await api<{ id?: string }>(templateId ? `/api/templates/${templateId}` : "/api/templates", { method: templateId ? "PUT" : "POST", body });
      toast.success("Template saved");
      if (!templateId && res.id) router.push(`/templates/${res.id}`);
      router.refresh();
    } catch (err) {
      const ce = err as ClientApiError;
      toast.error(ce.issues?.[0] ? friendlyIssue(ce.issues[0], sections) : ce.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-3">
        <div className="space-y-1.5"><Label htmlFor="t-name" required>Template name</Label><Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} /></div>
        <div className="space-y-1.5 md:col-span-2"><Label htmlFor="t-desc">Description</Label><Input id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canWrite} /></div>
      </div>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Sections <span className="ml-1 text-sm font-normal text-muted-foreground">{sections.filter((s) => s.enabled).length} enabled · {total} min total</span></h2>
        {canWrite && <Button variant="outline" onClick={() => setSections((p) => [...p, blank()])}><Plus /> Add section</Button>}
      </div>
      <p className="-mt-3 text-sm text-muted-foreground">Click a section to edit it. Questions are generated per candidate from these settings; the interview engine enforces timing and follow-up limits.</p>
      <div className="space-y-2">
        {sections.map((s, i) => (
          <SectionEditor key={s.key} s={s} index={i} count={sections.length} onChange={(p) => update(i, p)} onMove={(d) => move(i, d)} onRemove={() => setSections((p) => p.filter((_, j) => j !== i))} />
        ))}
      </div>
      {canWrite && (
        <div className="flex justify-between">
          {templateId ? (
            <ConfirmDialog title="Delete template?" description="Templates used by open jobs can't be deleted." destructive confirmLabel="Delete"
              onConfirm={async () => { try { await api(`/api/templates/${templateId}`, { method: "DELETE" }); toast.success("Template deleted"); router.push("/templates"); } catch (e) { toast.error((e as Error).message); } }}
              trigger={(o) => <Button variant="ghost" className="text-destructive" onClick={o}><Trash2 /> Delete template</Button>} />
          ) : <span />}
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="animate-spin" />}Save template</Button>
        </div>
      )}
    </div>
  );
}
