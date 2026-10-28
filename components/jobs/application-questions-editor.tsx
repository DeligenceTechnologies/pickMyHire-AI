"use client";

import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PayInput } from "@/components/applications/pay-input";
import {
  CURRENCIES, PAY_UNIT_LABEL, PAY_UNITS, QUESTION_TYPE_LABEL, QUESTION_TYPES, STANDARD_LABEL, STANDARD_QUESTIONS, WORK_MODE_LABEL, WORK_MODES,
  newQuestionId, payLabel, type ApplicationForm, type CustomQuestion, type HiringLimits, type QuestionType,
} from "@/lib/application-form";

const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const HINT: Partial<Record<(typeof STANDARD_QUESTIONS)[number], string>> = {
  current_ctc: "Asking about current pay isn't allowed in some places (e.g. parts of the US).",
};

/** The job's application questions: standard ones switched on/off, plus the team's own. */
export function ApplicationQuestionsEditor({ value, onChange, error }: { value: ApplicationForm; onChange: (v: ApplicationForm) => void; error?: string }) {
  const setStd = (k: (typeof STANDARD_QUESTIONS)[number], patch: Partial<{ enabled: boolean; required: boolean }>) => {
    const next = { ...value.standard[k], ...patch };
    if (!next.enabled) next.required = false;
    onChange({ ...value, standard: { ...value.standard, [k]: next } });
  };
  const setCustom = (i: number, patch: Partial<CustomQuestion>) => onChange({ ...value, custom: value.custom.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  const move = (i: number, d: -1 | 1) => {
    const c = [...value.custom]; [c[i], c[i + d]] = [c[i + d], c[i]]; onChange({ ...value, custom: c });
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="af-currency">Pay currency</Label>
          <select id="af-currency" className={selectClass} value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value as ApplicationForm["currency"] })}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="af-unit">Pay is entered as</Label>
          <select id="af-unit" className={selectClass} value={value.pay_unit} onChange={(e) => onChange({ ...value, pay_unit: e.target.value as ApplicationForm["pay_unit"] })}>
            {PAY_UNITS.map((u) => <option key={u} value={u}>{PAY_UNIT_LABEL[u]}</option>)}
          </select>
        </div>
      </div>

      <div className="divide-y rounded-lg border">
        {STANDARD_QUESTIONS.map((k) => (
          <div key={k} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <Switch checked={value.standard[k].enabled} onCheckedChange={(c) => setStd(k, { enabled: c })} aria-label={`Ask: ${STANDARD_LABEL[k]}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{STANDARD_LABEL[k]}</p>
              {HINT[k] && <p className="text-xs text-muted-foreground">{HINT[k]}</p>}
            </div>
            <label className={`flex items-center gap-2 text-xs ${value.standard[k].enabled ? "" : "opacity-50"}`}>
              <input type="checkbox" className="size-4 accent-primary" disabled={!value.standard[k].enabled} checked={value.standard[k].required}
                onChange={(e) => setStd(k, { required: e.target.checked })} aria-label={`${STANDARD_LABEL[k]} required`} />
              Required
            </label>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Your own questions</p>
        {value.custom.map((q, i) => {
          const choice = q.type === "single_choice" || q.type === "multi_choice";
          return (
            <div key={q.id} className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-start gap-2">
                <Input aria-label={`Question ${i + 1}`} placeholder="e.g. Do you have a valid work permit for India?" maxLength={200} value={q.label}
                  onChange={(e) => setCustom(i, { label: e.target.value })} className="min-w-0 flex-1" />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move question ${i + 1} down`} disabled={i === value.custom.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove question ${i + 1}`} onClick={() => onChange({ ...value, custom: value.custom.filter((_, j) => j !== i) })}><Trash2 /></Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`cq-type-${q.id}`}>Answer format</Label>
                  <select id={`cq-type-${q.id}`} className={selectClass} value={q.type}
                    onChange={(e) => setCustom(i, { type: e.target.value as QuestionType, expected: null, options: q.options })}>
                    {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
                {(q.type === "yes_no" || q.type === "single_choice") && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`cq-exp-${q.id}`}>Expected answer <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <select id={`cq-exp-${q.id}`} className={selectClass} value={q.expected ?? ""} onChange={(e) => setCustom(i, { expected: e.target.value || null })}>
                      <option value="">Any answer</option>
                      {(q.type === "yes_no" ? [["yes", "Yes"], ["no", "No"]] : q.options.map((o) => [o, o])).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                )}
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={q.required} onChange={(e) => setCustom(i, { required: e.target.checked })} /> Required
                </label>
              </div>
              {choice && (
                <div className="space-y-1.5">
                  <Label htmlFor={`cq-opt-${q.id}`}>Options <span className="font-normal text-muted-foreground">(one per line)</span></Label>
                  <textarea id={`cq-opt-${q.id}`} rows={3} className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring"
                    value={q.options.join("\n")} onChange={(e) => setCustom(i, { options: e.target.value.split("\n").map((o) => o.slice(0, 80)).slice(0, 20), expected: null })} />
                </div>
              )}
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" disabled={value.custom.length >= 20}
          onClick={() => onChange({ ...value, custom: [...value.custom, { id: newQuestionId(), label: "", type: "short_text", required: false, options: [], expected: null }] })}>
          <Plus /> Add question
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Internal limits for the fit check: never shown to candidates. */
export function HiringLimitsEditor({ value, onChange, form, error }: { value: HiringLimits; onChange: (v: HiringLimits) => void; form: ApplicationForm; error?: string }) {
  const num = (s: string) => (s.trim() === "" ? null : Math.max(0, Number(s.replace(/,/g, ""))));
  const pay = payLabel(form.currency, form.pay_unit);
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="size-3.5" /> Internal: candidates never see these.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="hl-min">Budget from ({pay})</Label>
          <PayInput key={`min-${form.pay_unit}`} id="hl-min" value={value.budget_min} onValue={(n) => onChange({ ...value, budget_min: n })} unit={form.pay_unit} currency={form.currency} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hl-max">Budget up to ({pay})</Label>
          <PayInput key={`max-${form.pay_unit}`} id="hl-max" value={value.budget_max} onValue={(n) => onChange({ ...value, budget_max: n })} unit={form.pay_unit} currency={form.currency} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hl-notice">Maximum notice period (days)</Label>
          <Input id="hl-notice" inputMode="numeric" value={value.max_notice_days ?? ""} onChange={(e) => { const n = num(e.target.value); onChange({ ...value, max_notice_days: n == null ? null : Math.min(365, Math.round(n)) }); }} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hl-join">Latest joining date</Label>
          <Input id="hl-join" type="date" value={value.latest_joining_date ?? ""} onChange={(e) => onChange({ ...value, latest_joining_date: e.target.value || null })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hl-mode">Work mode</Label>
          <select id="hl-mode" className={selectClass} value={value.work_mode ?? ""} onChange={(e) => onChange({ ...value, work_mode: (e.target.value || null) as HiringLimits["work_mode"] })}>
            <option value="">Not set</option>
            {WORK_MODES.map((m) => <option key={m} value={m}>{WORK_MODE_LABEL[m]}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={value.relocation_required} onChange={(e) => onChange({ ...value, relocation_required: e.target.checked })} /> Relocation required
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Answers are compared with these limits automatically. Up to 15% over budget is marked to check; anything outside is flagged, never rejected.</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
