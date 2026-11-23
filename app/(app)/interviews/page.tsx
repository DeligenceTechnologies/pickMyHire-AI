import Link from "next/link";
import { Suspense } from "react";
import { UserRound, Video, X } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SearchBar } from "@/components/common/search-bar";
import { EmptyState } from "@/components/common/states";
import { CandidatePager } from "@/components/candidates/candidate-pager";
import { HumanInterviewTable } from "@/components/hiring/human-table";
import { InterviewList } from "@/components/interviews/interview-list";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { PAGE_SIZES } from "@/lib/jobs/job-list";
import { HUMAN_TABS, listHumanInterviews } from "@/lib/services/human-interviews";
import { INTERVIEW_TABS, listInterviews } from "@/lib/services/interviews";
import { listJobs } from "@/lib/services/jobs";
import { cn } from "@/lib/utils";

export const metadata = { title: "Interviews" };

const AI_TABS: Record<(typeof INTERVIEW_TABS)[number], { label: string; hint: string }> = {
  pending: { label: "Not started", hint: "Invited, the candidate hasn't begun" },
  in_progress: { label: "In progress", hint: "Taking the interview right now" },
  review: { label: "To review", hint: "Finished, waiting for your decision" },
  reviewed: { label: "Reviewed", hint: "Finished and decided" },
  closed: { label: "Cancelled / expired", hint: "Cancelled, link expired, or failed" },
};
const HUMAN_TAB: Record<(typeof HUMAN_TABS)[number], { label: string; hint: string }> = {
  scheduled: { label: "Scheduled", hint: "Booked, not marked done yet" },
  completed: { label: "Completed", hint: "Took place" },
  no_show: { label: "No-show", hint: "The candidate didn't come" },
  cancelled: { label: "Cancelled", hint: "Called off" },
};
const PERIODS = [["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]] as const;
const SORTS = [["waiting", "Waiting longest first"]] as const;

export default async function InterviewsPage(props: PageProps<"/interviews">) {
  const auth = await requireAuth("interview:view");
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const human = str("type") === "human";
  const page = Number(str("page") ?? 1) || 1;
  const size = PAGE_SIZES.find((n) => String(n) === str("size")) ?? 5;
  const days = PERIODS.find(([v]) => v === str("period"))?.[0];
  const sort = str("sort") === "waiting" ? "waiting" as const : "recent" as const;
  const jobId = str("jobId") && /^[0-9a-f-]{36}$/i.test(str("jobId")!) ? str("jobId") : undefined;
  // "completed" (all finished) is kept for older links.
  const status = str("status");
  const q = str("q");
  const opts = { q, status, jobId, page, size, days: days ? Number(days) : undefined, sort, counts: true };
  const [ai, people, jobs] = await Promise.all([
    human ? null : listInterviews(auth.orgId, opts),
    human ? listHumanInterviews(auth.orgId, auth, opts) : null,
    listJobs(auth.orgId),
  ]);
  const counts = (human ? people!.counts : ai!.counts)!;
  const tabs: { id: string; label: string; hint: string; n: number }[] = [
    { id: "", label: "All", hint: "Every interview", n: counts.all },
    ...(human
      ? HUMAN_TABS.map((t) => ({ id: t, ...HUMAN_TAB[t], n: (counts as Record<string, number>)[t] }))
      : INTERVIEW_TABS.map((t) => ({ id: t, ...AI_TABS[t], n: (counts as Record<string, number>)[t] }))),
  ];

  // Links keep the other choices; a new tab or filter starts from page 1.
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const cur = { type: human ? "human" : undefined, q, status, jobId, period: days, sort: sort === "waiting" ? "waiting" : undefined, size: size !== 5 ? String(size) : undefined };
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/interviews${s ? `?${s}` : ""}`;
  };
  const chips = [
    q && { key: "q", label: `“${q}”` },
    jobId && { key: "jobId", label: jobs.find((j) => j.id === jobId)?.title ?? "One job" },
    days && { key: "period", label: PERIODS.find(([v]) => v === days)![1] },
    sort === "waiting" && { key: "sort", label: "Waiting longest first" },
  ].filter((c): c is { key: string; label: string } => !!c);
  const total = human ? people!.total : ai!.total;
  const tabCls = (active: boolean) => cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap", active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground");

  return (
    <>
      <PageHeader title="Interviews" description="Every AI and human interview across your jobs. Pick a tab to see what needs you." />
      <nav className="mb-4 flex gap-1 border-b" aria-label="Interview type">
        <Link href="/interviews" className={tabCls(!human)} aria-current={!human ? "page" : undefined}><Video className="size-4" /> AI interviews</Link>
        <Link href="/interviews?type=human" className={tabCls(human)} aria-current={human ? "page" : undefined}><UserRound className="size-4" /> Human interviews</Link>
      </nav>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        {/* Status tabs with counts */}
        <nav aria-label="Status" className="flex gap-1 overflow-x-auto border-b px-3 pt-2">
          {tabs.map((t) => {
            const active = (status ?? "") === t.id;
            return (
              <Link key={t.id} href={href({ status: t.id || undefined })} title={t.hint} aria-current={active ? "page" : undefined}
                className={cn("-mb-px flex shrink-0 items-center gap-2 border-b-2 px-2.5 py-2.5 text-sm whitespace-nowrap transition-colors",
                  active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t.label}
                <span className={cn("rounded-full px-1.5 py-px text-xs tabular", active ? "bg-primary text-primary-foreground" : t.id === "review" && t.n ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" : "bg-muted text-muted-foreground")}>{t.n}</span>
              </Link>
            );
          })}
        </nav>
        {status && tabs.find((t) => t.id === status) && <p className="border-b bg-muted/30 px-5 py-2 text-xs text-muted-foreground">{tabs.find((t) => t.id === status)!.hint}.</p>}

        {/* Search and filters */}
        <div className="space-y-2.5 border-b px-5 py-3.5">
          <Suspense>
            <SearchBar key={human ? "human" : "ai"} placeholder="Search candidate, email or job…" filters={[
              { name: "jobId", label: "All jobs", options: jobs.map((j) => ({ value: j.id, label: j.title })) },
              { name: "period", label: "Any time", options: PERIODS.map(([value, label]) => ({ value, label })) },
              { name: "sort", label: "Latest activity first", options: SORTS.map(([value, label]) => ({ value, label })) },
            ]} />
          </Suspense>
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Filtered by:</span>
              {chips.map((c) => (
                <Link key={c.key} href={href({ [c.key]: undefined })} className="inline-flex items-center gap-1 rounded-full border bg-accent px-2.5 py-1 font-medium text-accent-foreground hover:bg-accent/70" aria-label={`Remove filter ${c.label}`}>
                  {c.label}<X className="size-3" aria-hidden />
                </Link>
              ))}
              <Link href={href({ q: undefined, jobId: undefined, period: undefined, sort: undefined })} className="font-medium text-primary hover:underline">Clear all</Link>
            </div>
          )}
        </div>

        {total === 0 ? (
          <div className="p-5">
            {human
              ? <EmptyState icon={UserRound} title={chips.length || status ? "No matching human interviews" : "No human interviews yet"} description={chips.length || status ? "Try another tab or clear the filters." : "Add a human round to a job, then schedule it from a candidate's profile."} />
              : <EmptyState icon={Video} title={chips.length || status ? "No matching interviews" : "No interviews yet"} description={chips.length || status ? "Try another tab or clear the filters." : "Invite a candidate from a job page to start."} />}
          </div>
        ) : human ? (
          <HumanInterviewTable rows={people!.rows} showEmail={can(auth.role, "candidate:view")} />
        ) : (
          <InterviewList rows={ai!.rows} canWrite={can(auth.role, "interview:write")} canSeeCandidates={can(auth.role, "candidate:view")} />
        )}
        <Suspense><CandidatePager page={page} pageSize={size} total={total} /></Suspense>
      </div>
    </>
  );
}
