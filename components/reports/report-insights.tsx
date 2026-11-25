"use client";

import { CheckCircle2, CircleDashed, MinusCircle, PlayCircle, XCircle, type LucideIcon } from "lucide-react";
import { AssessmentBadge } from "@/components/common/status-badge";
import { formatClock } from "@/lib/format";
import type { AnswerAccuracy, FinalReportV2, QuestionResult, RequirementCoverage, ResumeCheckStatus } from "@/lib/validation/ai-schemas";
import type { AnswerQuality } from "@/lib/ai/report-generator";
import { cn } from "@/lib/utils";

// Report v2 blocks: the job's requirements, the resume check, how the answers went, and each answer
// against its question. Reports made before v2 don't have these, so every block handles "nothing to show".

type Refs = Record<string, { segment_id: string; start_ms: number; end_ms: number }>;
type Jump = (ms: number, id?: string | null) => void;

const COVERAGE: Record<RequirementCoverage, { label: string; icon: LucideIcon; cls: string }> = {
  demonstrated: { label: "Shown", icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/30" },
  partial: { label: "Partly", icon: CircleDashed, cls: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/30" },
  not_demonstrated: { label: "Weak", icon: XCircle, cls: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300 dark:ring-red-400/30" },
  not_covered: { label: "Not covered", icon: MinusCircle, cls: "bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/30" },
};
const RESUME: Record<ResumeCheckStatus, { label: string; icon: LucideIcon; cls: string }> = {
  supported: { label: "Backed up", icon: CheckCircle2, cls: COVERAGE.demonstrated.cls },
  partly: { label: "Partly", icon: CircleDashed, cls: COVERAGE.partial.cls },
  not_discussed: { label: "Not discussed", icon: MinusCircle, cls: COVERAGE.not_covered.cls },
  contradicted: { label: "Doesn't match", icon: XCircle, cls: COVERAGE.not_demonstrated.cls },
};
const ANSWERED: Record<QuestionResult["answered"], string> = { yes: "Answered", partly: "Partly answered", no: "Not answered", skipped: "Skipped (said they don't know)" };
const RELEVANCE: Record<QuestionResult["relevance"], string> = { high: "On topic", medium: "Mostly on topic", low: "Loosely on topic", off_topic: "Off topic" };
/** "Not a fact question" shows no pill: there was nothing to be right or wrong about. */
const ACCURACY: Record<AnswerAccuracy, { label: string; cls: string } | null> = {
  correct: { label: "Correct", cls: COVERAGE.demonstrated.cls },
  mostly_correct: { label: "Mostly correct", cls: COVERAGE.partial.cls },
  incorrect: { label: "Wrong", cls: COVERAGE.not_demonstrated.cls },
  unclear: { label: "Can't tell if correct", cls: COVERAGE.not_covered.cls },
  not_applicable: null,
};
const DEPTH: Record<QuestionResult["depth"], string> = { strong: "Specific, first-hand", solid: "Some specifics", basic: "General", none: "No real content" };

function Pill({ cls, icon: Icon, children }: { cls: string; icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", cls)}>
      {Icon && <Icon className="size-3" aria-hidden />}{children}
    </span>
  );
}

function EvidenceLinks({ ids, refs, jump }: { ids: string[]; refs: Refs; jump: Jump }) {
  const found = ids.filter((r) => refs[r]).slice(0, 3);
  if (!found.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {found.map((r) => (
        <button key={r} type="button" onClick={() => jump(refs[r].start_ms, refs[r].segment_id)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/10">
          <PlayCircle className="size-3.5" aria-hidden />{formatClock(refs[r].start_ms)}
        </button>
      ))}
    </span>
  );
}

/** "Must-haves: 4 shown · 2 partly · 1 not covered" for the overview. */
export function coverageLine(items: FinalReportV2["requirements"] | undefined) {
  const must = (items ?? []).filter((r) => r.importance === "must");
  if (!must.length) return null;
  const n = (s: RequirementCoverage) => must.filter((r) => r.status === s).length;
  return [`${n("demonstrated")} of ${must.length} must-haves shown`, n("partial") && `${n("partial")} partly`, n("not_demonstrated") && `${n("not_demonstrated")} weak`, n("not_covered") && `${n("not_covered")} not covered`]
    .filter(Boolean).join(" · ");
}

export function OverallLine({ overall }: { overall: FinalReportV2["overall"] | undefined }) {
  if (!overall) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Evidence overall</span>
      <AssessmentBadge assessment={overall.assessment} />
      <span className="text-muted-foreground">{overall.reason}</span>
    </div>
  );
}

export function AnswerQualityStrip({ q }: { q: AnswerQuality | undefined }) {
  if (!q?.total) return null;
  const items: [string, number, string][] = [
    ["Answered fully", q.answered, "text-emerald-700 dark:text-emerald-300"],
    ["Partly", q.partly, "text-amber-700 dark:text-amber-300"],
    ["Not answered", q.not_answered, q.not_answered ? "text-red-700 dark:text-red-300" : ""],
    ...(q.skipped ? [["Skipped", q.skipped, ""] as [string, number, string]] : []),
    ["Off topic", q.off_topic, q.off_topic ? "text-red-700 dark:text-red-300" : ""],
    ...(q.incorrect != null ? [["Wrong", q.incorrect, q.incorrect ? "text-red-700 dark:text-red-300" : ""] as [string, number, string]] : []),
    ["Specific, first-hand", q.strong, "text-primary"],
  ];
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Answers ({q.total} questions)</p>
      <dl className={cn("grid grid-cols-2 gap-2", items.length > 6 ? "sm:grid-cols-4 lg:grid-cols-7" : items.length > 5 ? "sm:grid-cols-6" : "sm:grid-cols-5")}>
        {items.map(([k, v, cls]) => (
          <div key={k} className="rounded-lg border px-3 py-2">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className={cn("text-lg font-semibold tabular", cls)}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function RequirementCoverageTable({ items, refs, jump }: { items: FinalReportV2["requirements"] | undefined; refs: Refs; jump: Jump }) {
  if (!items?.length) return null;
  const rows = [...items].sort((a, b) => (a.importance === b.importance ? 0 : a.importance === "must" ? -1 : 1));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr><th className="py-2 pr-3 font-medium">Requirement</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">What the answers showed</th><th className="py-2 pl-3 font-medium"><span className="sr-only">Evidence</span></th></tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => {
            const c = COVERAGE[r.status];
            return (
              <tr key={i} className="align-top">
                <td className="py-2.5 pr-3">
                  <p className="font-medium">{r.requirement}</p>
                  <p className="text-xs text-muted-foreground">{r.importance === "must" ? "Must-have" : "Nice to have"}</p>
                </td>
                <td className="px-3 py-2.5"><Pill cls={c.cls} icon={c.icon}>{c.label}</Pill></td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.note}</td>
                <td className="py-2.5 pl-3"><EvidenceLinks ids={r.evidence_refs} refs={refs} jump={jump} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ResumeCheckList({ items, refs, jump }: { items: FinalReportV2["resume_check"] | undefined; refs: Refs; jump: Jump }) {
  if (!items?.length) return null;
  return (
    <ul className="divide-y">
      {items.map((r, i) => {
        const c = RESUME[r.status];
        return (
          <li key={i} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{r.claim}</p>
              <p className="text-sm text-muted-foreground">{r.note}</p>
            </div>
            <Pill cls={c.cls} icon={c.icon}>{c.label}</Pill>
            <EvidenceLinks ids={r.evidence_refs} refs={refs} jump={jump} />
          </li>
        );
      })}
    </ul>
  );
}

/** How one answer measured up after the interview: answered, right or wrong, on topic, depth, and what it showed or lacked. */
export function AnswerVerdict({ r }: { r: QuestionResult }) {
  const acc = r.accuracy ? ACCURACY[r.accuracy] : null;
  const weak = r.answered === "no" || r.relevance === "off_topic" || r.accuracy === "incorrect";
  return (
    <>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Pill cls={r.answered === "yes" ? COVERAGE.demonstrated.cls : r.answered === "partly" ? COVERAGE.partial.cls : r.answered === "skipped" ? COVERAGE.not_covered.cls : COVERAGE.not_demonstrated.cls}>{ANSWERED[r.answered]}</Pill>
        {acc && <Pill cls={acc.cls}>{acc.label}</Pill>}
        {r.answered !== "skipped" && <Pill cls={r.relevance === "high" ? COVERAGE.demonstrated.cls : r.relevance === "off_topic" ? COVERAGE.not_demonstrated.cls : COVERAGE.not_covered.cls}>{RELEVANCE[r.relevance]}</Pill>}
        {r.answered !== "skipped" && <Pill cls={r.depth === "strong" ? COVERAGE.demonstrated.cls : r.depth === "none" ? COVERAGE.not_demonstrated.cls : COVERAGE.not_covered.cls}>{DEPTH[r.depth]}</Pill>}
      </div>
      <p className={cn("mt-1.5 text-sm", weak ? "text-red-700 dark:text-red-300" : "text-muted-foreground")}>{r.note}</p>
      {r.accuracy_note && (r.accuracy === "incorrect" || r.accuracy === "mostly_correct") && (
        <p className="mt-1 text-xs"><span className={cn("font-medium", r.accuracy === "incorrect" ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300")}>What was wrong: </span>{r.accuracy_note}</p>
      )}
      {(r.shown.length > 0 || r.missing.length > 0) && (
        <div className="mt-1.5 grid gap-1 text-xs sm:grid-cols-2">
          {r.shown.length > 0 && <p><span className="font-medium text-emerald-700 dark:text-emerald-300">Showed: </span>{r.shown.join("; ")}</p>}
          {r.missing.length > 0 && <p><span className="font-medium text-amber-700 dark:text-amber-300">Missing: </span>{r.missing.join("; ")}</p>}
        </div>
      )}
    </>
  );
}

/** Each answer against its question: answered, relevance, depth, what it showed and what was missing. */
export function QuestionResults({ results, askedAt, refs, jump }: {
  results: QuestionResult[] | undefined; askedAt: Map<string, number | null>; refs: Refs | null; jump: Jump;
}) {
  if (!results?.length) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Answer by answer</p>
      <ol className="space-y-2.5">
        {results.map((r, i) => {
          const at = r.question_id ? askedAt.get(r.question_id) ?? null : null;
          return (
            <li key={i} className={cn("rounded-lg border p-3", r.is_followup && "ml-5 border-dashed")}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">
                  {r.is_followup && <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 uppercase dark:bg-amber-950 dark:text-amber-300">Follow-up</span>}
                  {r.question_text ?? r.question_ref}
                </p>
                {at != null && (
                  <button type="button" onClick={() => jump(at)} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/10">
                    <PlayCircle className="size-3.5" aria-hidden />{formatClock(at)}
                  </button>
                )}
              </div>
              <AnswerVerdict r={r} />
              {refs && <div className="mt-1"><EvidenceLinks ids={r.evidence_refs} refs={refs} jump={jump} /></div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

