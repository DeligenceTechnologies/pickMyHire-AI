"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PayHint } from "./pay-input";
import {
  NOTICE_LABEL, NOTICE_OPTIONS, STANDARD_LABEL, WORK_MODE_LABEL, WORK_MODES, payLabel,
  type ApplicationForm, type StandardKey,
} from "@/lib/application-form";

export type AnswerValues = Record<string, unknown> & { custom: Record<string, unknown> };
export const emptyValues = (): AnswerValues => ({ custom: {} });

const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Answers as stored → form values (numbers and booleans become the strings the inputs use). */
export function valuesFromAnswers(a: Record<string, unknown> | null | undefined): AnswerValues {
  const v: AnswerValues = { custom: { ...((a?.custom as Record<string, unknown>) ?? {}) } };
  for (const [k, x] of Object.entries(a ?? {})) {
    if (k === "custom" || x == null) continue;
    v[k] = typeof x === "boolean" ? (x ? "yes" : "no") : typeof x === "number" ? String(x) : x;
  }
  return v;
}

function Field({ id, label, required, error, children, hint }: { id: string; label: string; required: boolean; error?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} required={required}>{label}{!required && <span className="font-normal text-muted-foreground"> (optional)</span>}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * The job's application questions, each with the right input for its format.
 * Used on the public apply page, in the invite dialog and to edit answers.
 */
export function QuestionFields({ form, values, onChange, errors = {}, idPrefix = "q" }: {
  form: ApplicationForm; values: AnswerValues; onChange: (v: AnswerValues) => void; errors?: Record<string, string>; idPrefix?: string;
}) {
  const s = form.standard;
  const set = (k: string, x: unknown) => onChange({ ...values, [k]: x });
  const setCustom = (k: string, x: unknown) => onChange({ ...values, custom: { ...values.custom, [k]: x } });
  const id = (k: string) => `${idPrefix}-${k.replace(".", "-")}`;
  const str = (x: unknown) => (x == null ? "" : String(x));
  const on = (k: StandardKey) => s[k].enabled;
  const pay = payLabel(form.currency, form.pay_unit);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {(["expected_ctc", "current_ctc"] as const).filter(on).map((k) => (
          <Field key={k} id={id(k)} label={`${STANDARD_LABEL[k]} (${pay})`} required={s[k].required} error={errors[k]}>
            <Input id={id(k)} inputMode="decimal" placeholder={form.pay_unit === "lpa" ? "e.g. 12.5" : form.pay_unit === "year" ? "e.g. 90,000" : "e.g. 7,500"} value={str(values[k])}
              onChange={(e) => set(k, e.target.value.replace(/[^\d.,]/g, ""))} aria-invalid={!!errors[k]} aria-describedby={`${id(k)}-hint`} />
            {!errors[k] && <PayHint id={`${id(k)}-hint`} text={str(values[k])} unit={form.pay_unit} currency={form.currency} />}
          </Field>
        ))}
        {on("notice_period") && (
          <Field id={id("notice_period")} label={STANDARD_LABEL.notice_period} required={s.notice_period.required} error={errors.notice_period}>
            <select id={id("notice_period")} className={selectClass} value={str(values.notice_period)} onChange={(e) => set("notice_period", e.target.value)} aria-invalid={!!errors.notice_period}>
              <option value="">Select…</option>
              {NOTICE_OPTIONS.map((o) => <option key={o} value={o}>{NOTICE_LABEL[o]}</option>)}
            </select>
          </Field>
        )}
        {on("notice_period") && values.notice_period === "serving" && (
          <Field id={id("last_working_day")} label="Last working day" required error={errors.last_working_day}>
            <Input id={id("last_working_day")} type="date" value={str(values.last_working_day)} onChange={(e) => set("last_working_day", e.target.value)} aria-invalid={!!errors.last_working_day} />
          </Field>
        )}
        {on("joining_date") && (
          <Field id={id("joining_date")} label={STANDARD_LABEL.joining_date} required={s.joining_date.required} error={errors.joining_date}>
            <Input id={id("joining_date")} type="date" value={str(values.joining_date)} onChange={(e) => set("joining_date", e.target.value)} aria-invalid={!!errors.joining_date} />
          </Field>
        )}
        {on("current_location") && (
          <Field id={id("current_location")} label={STANDARD_LABEL.current_location} required={s.current_location.required} error={errors.current_location}>
            <Input id={id("current_location")} maxLength={120} placeholder="City, country" value={str(values.current_location)} onChange={(e) => set("current_location", e.target.value)} aria-invalid={!!errors.current_location} />
          </Field>
        )}
        {on("relocation") && (
          <Field id={id("relocation")} label={STANDARD_LABEL.relocation} required={s.relocation.required} error={errors.relocation}>
            <select id={id("relocation")} className={selectClass} value={str(values.relocation)} onChange={(e) => set("relocation", e.target.value)} aria-invalid={!!errors.relocation}>
              <option value="">Select…</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </Field>
        )}
        {on("work_mode") && (
          <Field id={id("work_mode")} label={STANDARD_LABEL.work_mode} required={s.work_mode.required} error={errors.work_mode}>
            <select id={id("work_mode")} className={selectClass} value={str(values.work_mode)} onChange={(e) => set("work_mode", e.target.value)} aria-invalid={!!errors.work_mode}>
              <option value="">Select…</option>
              {WORK_MODES.map((m) => <option key={m} value={m}>{WORK_MODE_LABEL[m]}</option>)}
            </select>
          </Field>
        )}
      </div>
      {form.custom.map((q) => {
        const k = `custom.${q.id}`;
        const v = values.custom[q.id];
        return (
          <Field key={q.id} id={id(k)} label={q.label} required={q.required} error={errors[k]}>
            {q.type === "short_text" && <Input id={id(k)} maxLength={300} value={str(v)} onChange={(e) => setCustom(q.id, e.target.value)} aria-invalid={!!errors[k]} />}
            {q.type === "long_text" && <Textarea id={id(k)} rows={3} maxLength={3000} value={str(v)} onChange={(e) => setCustom(q.id, e.target.value)} aria-invalid={!!errors[k]} />}
            {q.type === "number" && <Input id={id(k)} inputMode="decimal" value={str(v)} onChange={(e) => setCustom(q.id, e.target.value.replace(/[^\d.,-]/g, ""))} aria-invalid={!!errors[k]} />}
            {q.type === "date" && <Input id={id(k)} type="date" value={str(v)} onChange={(e) => setCustom(q.id, e.target.value)} aria-invalid={!!errors[k]} />}
            {(q.type === "yes_no" || q.type === "single_choice") && (
              <select id={id(k)} className={selectClass} value={str(v)} onChange={(e) => setCustom(q.id, e.target.value)} aria-invalid={!!errors[k]}>
                <option value="">Select…</option>
                {(q.type === "yes_no" ? [["yes", "Yes"], ["no", "No"]] : q.options.map((o) => [o, o])).map(([val, l]) => <option key={val} value={val}>{l}</option>)}
              </select>
            )}
            {q.type === "multi_choice" && (
              <div id={id(k)} role="group" aria-label={q.label} className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-input px-3 py-2">
                {q.options.map((o) => {
                  const list = Array.isArray(v) ? (v as string[]) : [];
                  return (
                    <label key={o} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4 accent-primary" checked={list.includes(o)}
                        onChange={(e) => setCustom(q.id, e.target.checked ? [...list, o] : list.filter((x) => x !== o))} />{o}
                    </label>
                  );
                })}
              </div>
            )}
          </Field>
        );
      })}
    </div>
  );
}

/** Drop the error of every answer that changed, so a message disappears as soon as it's fixed. */
export function pruneErrors(errors: Record<string, string>, prev: AnswerValues, next: AnswerValues) {
  const out: Record<string, string> = {};
  for (const [k, msg] of Object.entries(errors)) {
    const pick = (v: AnswerValues) => (k.startsWith("custom.") ? v.custom[k.slice(7)] : v[k]);
    if (JSON.stringify(pick(prev)) === JSON.stringify(pick(next))) out[k] = msg;
  }
  return out;
}
