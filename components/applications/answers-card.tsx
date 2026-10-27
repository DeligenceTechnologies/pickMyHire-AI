"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Loader2, Pencil, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAction } from "@/lib/client/use-action";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { describeAnswers, FIT_LABEL, validateAnswers, type Fit, type FitLevel } from "@/lib/application-form";
import type { JobAnswers } from "@/lib/services/application-answers";
import { pruneErrors, QuestionFields, valuesFromAnswers, type AnswerValues } from "./question-fields";

const TONE: Record<Fit["level"], string> = {
  ok: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900",
  warn: "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-900",
  fail: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900",
  none: "bg-muted text-muted-foreground ring-border",
};
const ICON: Record<FitLevel, React.ReactNode> = {
  ok: <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />,
  warn: <AlertTriangle className="size-4 shrink-0 text-amber-600" />,
  fail: <XCircle className="size-4 shrink-0 text-red-600" />,
};

export function FitBadge({ fit, className }: { fit: Pick<Fit, "level">; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", TONE[fit.level], className)}>{FIT_LABEL[fit.level]}</span>;
}

/** A candidate's answers to a job's questions, the fit check against the job's limits, and editing. */
export function AnswersCard({ candidateId, items, canEdit, showJob }: { candidateId: string; items: JobAnswers[]; canEdit: boolean; showJob?: boolean }) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState<JobAnswers | null>(null);
  const [values, setValues] = useState<AnswerValues>({ custom: {} });
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!items.length) return null;
  return (
    <section className="rounded-xl border bg-card" aria-labelledby="answers-title">
      <div className="flex items-center gap-2 border-b px-5 py-3.5">
        <h2 id="answers-title" className="flex items-center gap-2 font-semibold"><ClipboardList className="size-4 text-primary" /> Answers and fit</h2>
      </div>
      <div className="divide-y">
        {items.map((it) => {
          const rows = describeAnswers(it.form, it.answers);
          return (
            <div key={it.job_id} className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {showJob && <p className="text-sm font-semibold">{it.job_title}</p>}
                  <FitBadge fit={it.fit} />
                </div>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => { setValues(valuesFromAnswers(it.answers as Record<string, unknown>)); setErrors({}); setEditing(it); }}>
                    <Pencil /> Edit answers
                  </Button>
                )}
              </div>
              {it.fit.items.length > 0 && (
                <ul className="space-y-1.5 text-sm">
                  {it.fit.items.map((f) => <li key={f.key} className="flex gap-2">{ICON[f.level]}<span><span className="font-medium">{f.label}{/[?:]$/.test(f.label) ? "" : ":"}</span> {f.detail}</span></li>)}
                </ul>
              )}
              {rows.length > 0 ? (
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {rows.map((r) => <div key={r.label}><dt className="text-xs text-muted-foreground">{r.label}</dt><dd className="mt-0.5 whitespace-pre-wrap">{r.value}</dd></div>)}
                </dl>
              ) : <p className="text-sm text-muted-foreground">No answers yet.</p>}
              <p className="text-xs text-muted-foreground">{it.answered_by_name ? `Filled in by ${it.answered_by_name}` : "Answered by the candidate"} · {formatDate(it.updated_at, true)}</p>
            </div>
          );
        })}
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && !pending && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit answers{editing && showJob ? `: ${editing.job_title}` : ""}</DialogTitle>
            <DialogDescription>Update what the candidate told you. The fit check and HR details update too.</DialogDescription>
          </DialogHeader>
          {editing && <QuestionFields form={editing.form} values={values} onChange={(v) => { setErrors((e) => pruneErrors(e, values, v)); setValues(v); }} errors={errors} idPrefix="edit-q" />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={!!pending}>Cancel</Button>
            <Button disabled={!!pending} onClick={async () => {
              if (!editing) return;
              const checked = validateAnswers(editing.form, values);
              if (Object.keys(checked.errors).length) return setErrors(checked.errors);
              const ok = await run("answers", `/api/candidates/${candidateId}/jobs/${editing.job_id}/answers`, { method: "PUT", body: { answers: values }, success: "Answers saved" });
              if (ok) setEditing(null);
            }}>{pending === "answers" && <Loader2 className="animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
