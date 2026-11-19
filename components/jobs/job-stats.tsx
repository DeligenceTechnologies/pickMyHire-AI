"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ClipboardCheck, Star, UserPlus, Users, Video, type LucideIcon } from "lucide-react";
import { parseJobListFilters } from "@/lib/jobs/job-list";
import { inStageGroup, stageGroup, type StageGroup } from "@/lib/jobs/job-stages";
import type { JobCandidateRow } from "@/lib/services/job-candidates";
import { cn } from "@/lib/utils";

const CARDS: { group: StageGroup | ""; icon: LucideIcon; tone: string }[] = [
  { group: "", icon: Users, tone: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300" },
  { group: "to_invite", icon: UserPlus, tone: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  { group: "interview", icon: Video, tone: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300" },
  { group: "review", icon: ClipboardCheck, tone: "bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-300" },
  { group: "shortlisted", icon: Star, tone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300" },
  { group: "hired", icon: CheckCircle2, tone: "bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-300" },
];

/**
 * The job at a glance, above the pipeline, in hiring order. Each card opens that part of the list and
 * counts exactly what it opens; the five stages add up to Candidates (everyone not rejected). The card for
 * the list's current stage is highlighted.
 */
export function JobStats({ jobId, rows }: { jobId: string; rows: Pick<JobCandidateRow, "stage">[] }) {
  const current = parseJobListFilters(useSearchParams()).stage;
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {CARDS.map((c) => {
        const g = c.group ? stageGroup(c.group) : null;
        const value = rows.filter((r) => (c.group ? inStageGroup(c.group, r.stage) : r.stage !== "rejected")).length;
        const label = g?.label ?? "Candidates";
        const hint = g?.hint ?? "Everyone active in this job";
        return (
          <Link key={label} href={c.group ? `/jobs/${jobId}?stage=${c.group}` : `/jobs/${jobId}`} scroll={false}
            aria-current={current === c.group ? "true" : undefined}
            className={cn("group min-w-0 rounded-2xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
              current === c.group && "border-primary/50 ring-1 ring-primary/30")}>
            <span className="flex items-center gap-3">
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", c.tone)}><c.icon className="size-[18px]" aria-hidden /></span>
              <span className="text-2xl font-semibold tracking-tight tabular">{value}</span>
            </span>
            <span className="mt-2.5 block text-sm font-medium group-hover:text-foreground">{label}</span>
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{hint}</span>
          </Link>
        );
      })}
    </div>
  );
}
