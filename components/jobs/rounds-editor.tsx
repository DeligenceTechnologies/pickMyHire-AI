"use client";

import { ArrowDown, ArrowUp, Bot, Plus, Trash2, UserRound } from "lucide-react";
import { TagInput } from "@/components/common/tag-input";
import { InfoTip } from "@/components/common/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_CRITERIA } from "@/lib/hiring";
import { cn } from "@/lib/utils";

export type RoundValue = { id?: string; key: string; name: string; kind: "ai" | "human"; template_id: string; criteria: string[]; guide: string };
type Template = { id: string; name: string; total_minutes: number };

const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const SUGGESTED = ["Screening", "Technical", "Culture fit", "Final round"];

export const newRoundKey = () => Math.random().toString(36).slice(2, 10);

/** Ordered interview rounds for a job: AI interviews (with a template) or human interviews (with a scorecard). */
export function RoundsEditor({ value, onChange, templates, error }: { value: RoundValue[]; onChange: (v: RoundValue[]) => void; templates: Template[]; error?: string }) {
  const update = (i: number, patch: Partial<RoundValue>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const add = () => {
    const used = new Set(value.map((r) => r.name));
    const name = SUGGESTED.find((s) => !used.has(s)) ?? `Round ${value.length + 1}`;
    onChange([...value, { key: newRoundKey(), name, kind: "ai", template_id: templates[0]?.id ?? "", criteria: [], guide: "" }]);
  };
  const setKind = (i: number, kind: "ai" | "human") =>
    update(i, kind === "human" ? { kind, criteria: value[i].criteria.length ? value[i].criteria : DEFAULT_CRITERIA } : { kind, template_id: value[i].template_id || templates[0]?.id || "" });
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {value.map((r, i) => (
          <li key={r.key} className="space-y-2 rounded-lg border bg-background p-2">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[auto_minmax(0,0.8fr)_auto_minmax(0,1.2fr)_auto]">
              <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{i + 1}</span>
              <Input aria-label={`Round ${i + 1} name`} required value={r.name} maxLength={80} onChange={(e) => update(i, { name: e.target.value })} placeholder="e.g. Screening" />
              <div className="col-span-3 flex rounded-lg border p-0.5 text-xs sm:col-span-1" role="radiogroup" aria-label={`Round ${i + 1} type`}>
                {([["ai", "AI interview", Bot], ["human", "Human interview", UserRound]] as const).map(([k, label, Icon]) => (
                  <button key={k} type="button" role="radio" aria-checked={r.kind === k} onClick={() => setKind(i, k)}
                    className={cn("flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 whitespace-nowrap", r.kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
                    <Icon className="size-3.5" /> {label}
                  </button>
                ))}
              </div>
              {r.kind === "ai" ? (
                <select aria-label={`Round ${i + 1} template`} required className={`${selectClass} col-span-3 sm:col-span-1`} value={r.template_id} onChange={(e) => update(i, { template_id: e.target.value })}>
                  <option value="">Select a template…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.total_minutes} min</option>)}
                </select>
              ) : <p className="col-span-3 text-xs text-muted-foreground sm:col-span-1">Scheduled with your team; interviewers fill in a scorecard.</p>}
              <div className="col-start-3 row-start-1 flex sm:col-start-auto sm:row-start-auto">
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move round ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move round ${i + 1} down`} disabled={i === value.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove round ${i + 1}`} disabled={value.length === 1} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            </div>
            {r.kind === "human" && (
              <div className="grid gap-2 border-t pt-2 sm:pl-8">
                <div className="space-y-1">
                  <p className="flex items-center gap-1 text-xs font-medium">Skills to rate (1–5)<span aria-hidden="true" className="text-destructive">*</span><InfoTip>Your interviewer rates each one from 1 to 5 after the call.</InfoTip></p>
                  <TagInput id={`round-${r.key}-criteria`} value={r.criteria} onChange={(c) => update(i, { criteria: c.slice(0, 12) })} placeholder="Add a skill and press Enter" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium">Interviewer guide <span className="font-normal text-muted-foreground">(optional)</span></p>
                  <Textarea aria-label={`Round ${i + 1} interviewer guide`} rows={2} maxLength={4000} value={r.guide} onChange={(e) => update(i, { guide: e.target.value })} placeholder="Questions to cover and what good looks like. Only your team sees this." />
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="button" variant="outline" size="sm" onClick={add} disabled={value.length >= 10}><Plus /> Add round</Button>
      <p className="text-xs text-muted-foreground">Candidates go through the rounds in order. Removing a round keeps the interviews already done in it.</p>
    </div>
  );
}
