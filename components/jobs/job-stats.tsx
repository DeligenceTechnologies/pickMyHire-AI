import Link from "next/link";
import { CalendarDays, CheckCircle2, ClipboardCheck, Star, Users, type LucideIcon } from "lucide-react";
import type { JobCandidateRow } from "@/lib/services/job-candidates";
import { cn } from "@/lib/utils";

/** The job at a glance, above the pipeline. Each card opens the matching part of the list. */
export function JobStats({ jobId, rows, interviews }: { jobId: string; rows: Pick<JobCandidateRow, "stage">[]; interviews: number }) {
  const n = (s: JobCandidateRow["stage"]) => rows.filter((r) => r.stage === s).length;
  const cards: { label: string; value: number; href: string; icon: LucideIcon; tone: string; hint: string }[] = [
    { label: "Candidates", value: rows.length, href: `/jobs/${jobId}`, icon: Users, tone: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300", hint: "Everyone who applied or was added" },
    { label: "To review", value: n("review"), href: `/jobs/${jobId}?stage=review`, icon: ClipboardCheck, tone: "bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-300", hint: "A round is done and needs your decision" },
    { label: "Shortlisted", value: n("shortlisted"), href: `/jobs/${jobId}?stage=shortlisted`, icon: Star, tone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300", hint: "Shortlisted for this job" },
    { label: "Interviews", value: interviews, href: `/interviews?jobId=${jobId}`, icon: CalendarDays, tone: "bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-300", hint: "AI interviews sent for this job" },
    { label: "Hired", value: n("hired"), href: `/jobs/${jobId}?stage=hired`, icon: CheckCircle2, tone: "bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-300", hint: "Hired for this job" },
  ];
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <Link key={c.label} href={c.href} scroll={false}
          className="group flex items-center gap-3.5 rounded-2xl border bg-card px-4 py-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", c.tone)}><c.icon className="size-5" aria-hidden /></span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-muted-foreground group-hover:text-foreground">{c.label}</span>
            <span className="block text-2xl font-semibold tracking-tight tabular">{c.value}</span>
            <span className="sr-only">{c.hint}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
