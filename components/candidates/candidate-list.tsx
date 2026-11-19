import Link from "next/link";
import { AlertTriangle, Archive, BriefcaseBusiness, Loader2 } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { ArchiveButton } from "@/components/candidates/archive-button";
import { initials, timeAgo } from "@/lib/format";
import { shortExperience } from "@/lib/resume/experience";
import { STAGE_GROUP_LABEL, STAGE_GROUPS, STAGE_STYLE, type StageGroup } from "@/lib/candidates/stages";
import type { CandidateListRow } from "@/lib/services/candidate-list";
export { STAGE_STYLE } from "@/lib/candidates/stages";
import { cn } from "@/lib/utils";


const MATCH: Record<string, { label: string; pill: string; dot: string; rank: number }> = {
  strong_match: { label: "Strong", pill: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900", dot: "bg-emerald-500", rank: 5 },
  good_match: { label: "Good", pill: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900", dot: "bg-sky-500", rank: 4 },
  partial_match: { label: "Partial", pill: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900", dot: "bg-amber-500", rank: 3 },
  low_match: { label: "Low", pill: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900", dot: "bg-rose-500", rank: 1 },
  insufficient_information: { label: "Unclear", pill: "bg-muted text-muted-foreground ring-border", dot: "bg-muted-foreground/50", rank: 1 },
};
const AVATAR = [
  "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200", "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200", "bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200",
  "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200", "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
];
export const avatarTone = (id: string) => AVATAR[parseInt(id.slice(0, 2), 16) % AVATAR.length];

/** Resume vs job as a coloured pill: level, and requirements met when known. */
export function MatchCell({ r }: { r: Pick<CandidateListRow, "job_id" | "match_level" | "match_status" | "match_met" | "match_total"> }) {
  if (!r.job_id) return <span className="text-xs text-muted-foreground">—</span>;
  if (!r.match_level) {
    if (r.match_status === "pending" || r.match_status === "processing") {
      return <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden />Checking</span>;
    }
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const m = MATCH[r.match_level] ?? MATCH.insufficient_information;
  const title = r.match_total ? `${m.label} match: ${r.match_met} of ${r.match_total} requirements met` : `${m.label} match`;
  return (
    <span title={title} className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", m.pill)}>
      <span className={cn("size-1.5 rounded-full", m.dot)} aria-hidden />{m.label}
      {r.match_total ? <span className="font-normal opacity-75 tabular">{r.match_met}/{r.match_total}</span> : null}
      <span className="sr-only">{title}</span>
    </span>
  );
}

/** Total experience from the resume dates, with a warning icon when some dates need a look. */
export function ExperienceCell({ r }: { r: Pick<CandidateListRow, "experience_months" | "experience_approximate" | "experience_flags" | "has_resume" | "parse_status"> }) {
  const flags = r.experience_flags ?? [];
  if (r.experience_months === null && !flags.length) {
    return <span className="text-xs text-muted-foreground">{r.has_resume ? (r.parse_status === "completed" ? "—" : "Reading…") : "No resume"}</span>;
  }
  const tip = flags.map((f) => f.message).join("\n");
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs tabular", flags.length ? "text-amber-800 dark:text-amber-300" : "text-foreground")} title={tip || undefined}>
      <BriefcaseBusiness className="size-3.5 text-muted-foreground" aria-hidden />
      {r.experience_months === null ? "Unclear" : `${r.experience_approximate ? "~" : ""}${shortExperience(r.experience_months)}`}
      {flags.length > 0 && <AlertTriangle className="size-3.5 text-amber-500" aria-label={`Check: ${tip}`} />}
    </span>
  );
}

function Status({ r }: { r: CandidateListRow }) {
  return r.interview_status && r.interview_status !== "cancelled"
    ? <StatusBadge status={r.interview_status} />
    : <StatusBadge status="created" label={r.interview_status === "cancelled" ? "Invite cancelled" : "Not invited"} />;
}

function Avatar({ r, size = "size-10 text-sm" }: { r: CandidateListRow; size?: string }) {
  return <span className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold", size, avatarTone(r.id))}>{initials(r.name)}</span>;
}

function JobTag({ r }: { r: CandidateListRow }) {
  if (!r.job_title) return <span className="truncate">{r.email}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="truncate">{r.job_title}</span>
      {r.other_jobs > 0 && <span className="shrink-0 rounded-full bg-accent px-1.5 text-[11px] font-medium text-accent-foreground" title={`In ${r.other_jobs + 1} jobs`}>+{r.other_jobs}</span>}
    </span>
  );
}

/** Why and when someone was archived. */
function ArchivedTag({ r }: { r: CandidateListRow }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900">
      <Archive className="size-3" aria-hidden />{r.archived_reason ?? "Archived"}{r.archived_at && <span className="font-normal opacity-75">· {timeAgo(r.archived_at)}</span>}
    </span>
  );
}

/** One person in the list view. The whole row opens the candidate. */
export function CandidateRow({ r, canEdit }: { r: CandidateListRow; canEdit: boolean }) {
  const lowMatch = r.match_level === "low_match" && !r.archived_at;
  return (
    <li className={cn("group relative flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/50 sm:gap-4", r.archived_at && "bg-amber-50/30 dark:bg-amber-950/10")}>
      <Avatar r={r} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <Link href={`/candidates/${r.id}`} className="block truncate font-semibold after:absolute after:inset-0 group-hover:text-primary">{r.name}</Link>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <JobTag r={r} />
          {r.archived_at && <ArchivedTag r={r} />}
          {lowMatch && <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400"><AlertTriangle className="size-3" aria-hidden />Resume doesn&apos;t fit this job</span>}
        </div>
      </div>
      <div className="hidden w-32 md:block"><MatchCell r={r} /></div>
      <div className="hidden w-24 sm:block"><ExperienceCell r={r} /></div>
      <div className="w-32 text-right"><Status r={r} /></div>
      <div className="hidden w-24 text-right text-xs whitespace-nowrap text-muted-foreground lg:block">{timeAgo(r.created_at)}</div>
      {canEdit && <div className={cn("text-right", r.archived_at ? "w-24" : "w-8")}><ArchiveButton id={r.id} name={r.name} archived={!!r.archived_at} compact /></div>}
    </li>
  );
}

/** Board view: one column per interview stage, each in its stage colour. */
export function CandidateBoard({ rows, canEdit }: { rows: CandidateListRow[]; canEdit: boolean }) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[1000px] grid-cols-5 gap-3">
        {STAGE_GROUPS.map((s: StageGroup) => {
          const col = rows.filter((r) => r.stage === s);
          const st = STAGE_STYLE[s];
          const Icon = st.icon;
          return (
            <section key={s} aria-label={STAGE_GROUP_LABEL[s]} className="flex flex-col rounded-2xl border bg-muted/30 p-2">
              <h3 className="mb-2 flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-semibold">
                <span className={cn("flex size-6 items-center justify-center rounded-lg", st.soft, st.text)}><Icon className="size-3.5" aria-hidden /></span>
                {STAGE_GROUP_LABEL[s]}
                <span className="ml-auto rounded-full bg-background px-2 text-xs font-medium text-muted-foreground tabular ring-1 ring-border">{col.length}</span>
              </h3>
              <ul className="space-y-2">
                {col.map((r) => (
                  <li key={r.id} className="group relative overflow-hidden rounded-xl border bg-card p-3 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
                    <span className={cn("absolute inset-y-0 left-0 w-1", st.bar)} aria-hidden />
                    <div className="flex items-start gap-2.5">
                      <Avatar r={r} size="size-8 text-xs" />
                      <div className="min-w-0 flex-1">
                        <Link href={`/candidates/${r.id}`} className="block truncate text-sm font-semibold after:absolute after:inset-0 group-hover:text-primary">{r.name}</Link>
                        <p className="truncate text-xs text-muted-foreground"><JobTag r={r} /></p>
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5"><MatchCell r={r} /><ExperienceCell r={r} /></div>
                    <div className="mt-2 flex items-center justify-between border-t pt-2 text-[11px] text-muted-foreground">
                      <span>{r.interview_status && r.interview_status !== "cancelled" ? <StatusBadge status={r.interview_status} /> : "Added"}</span>
                      <span className="flex items-center gap-1">{timeAgo(r.created_at)}{canEdit && <span className="relative z-10 -my-1"><ArchiveButton id={r.id} name={r.name} archived={!!r.archived_at} compact /></span>}</span>
                    </div>
                  </li>
                ))}
                {!col.length && (
                  <li className="flex flex-col items-center gap-1 rounded-xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                    <Icon className="size-4 opacity-50" aria-hidden />No one here
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
