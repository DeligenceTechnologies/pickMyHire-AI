import Link from "next/link";
import { Suspense } from "react";
import { Archive, LayoutGrid, List, Loader2, Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { SearchBar } from "@/components/common/search-bar";
import { EmptyState } from "@/components/common/states";
import { CandidateBoard, CandidateRow, STAGE_STYLE } from "@/components/candidates/candidate-list";
import { JobPicker, type JobChoice } from "@/components/candidates/job-picker";
import { NewCandidateDialog } from "@/components/candidates/new-candidate-dialog";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { listCandidatePage, SORTS, STAGE_GROUP_LABEL, STAGE_GROUPS, type CandidateSort } from "@/lib/services/candidate-list";
import { listJobs } from "@/lib/services/jobs";
import { queueMissingMatches } from "@/lib/services/candidate-match";
import { AutoRefresh } from "@/components/common/auto-refresh";
import { cn } from "@/lib/utils";

export const metadata = { title: "Candidates" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function CandidatesPage(props: PageProps<"/candidates">) {
  const auth = await requireAuth("candidate:view");
  const sp = await props.searchParams;
  const q = one(sp.q);
  const jobId = one(sp.job) && /^[0-9a-f-]{36}$/i.test(one(sp.job)!) ? one(sp.job) : undefined;
  const stage = STAGE_GROUPS.find((s) => s === one(sp.stage));
  const sort = SORTS.find((s) => s === one(sp.sort)) ?? "new";
  const archived = one(sp.archived) === "1";
  const board = one(sp.view) === "board";
  const page = Number(one(sp.page) ?? 1) || 1;
  const canEdit = can(auth.role, "candidate:write");
  const [data, activeJobs] = await Promise.all([
    listCandidatePage(auth.orgId, { q, jobId, stage, sort, archived, page, board }),
    canEdit ? listJobs(auth.orgId, { status: "active" }) : Promise.resolve([]),
  ]);

  // People shown in a job without a resume check yet (e.g. invited before it existed) are checked in the background.
  const missing = data.rows.filter((r) => r.job_id && r.has_resume && !r.match_status).map((r) => ({ candidateId: r.id, jobId: r.job_id! }));
  const queued = canEdit ? await queueMissingMatches(auth.orgId, missing) : 0;
  const checking = queued > 0 || data.rows.some((r) => r.match_status === "pending" || r.match_status === "processing");

  // Links keep the other choices; changing job, stage or view starts from page 1.
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | undefined> = { q, job: jobId, stage, sort: sort === "new" ? undefined : sort, archived: archived ? "1" : undefined, view: board ? "board" : undefined };
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/candidates${s ? `?${s}` : ""}`;
  };
  const jobTitle = data.jobs.find((j) => j.id === jobId)?.title;
  const filtered = !!(q || jobId || stage);

  const allJobs: JobChoice[] = [
    { id: null, title: "All jobs", n: archived ? data.archivedCount : data.activeCount, stages: data.allStages, href: href({ job: undefined, stage: undefined }) },
    ...data.jobs.map((j) => ({ id: j.id, title: j.title, n: j.n, stages: j.stages, closed: j.status === "closed", href: href({ job: j.id, stage: undefined }) })),
  ];

  return (
    <>
      <AutoRefresh active={checking} />
      <PageHeader title="Candidates"
        description={archived ? "People you've set aside. Nothing is deleted; restore anyone anytime." : "Everyone you've added or invited, by job and interview stage."}
        actions={canEdit && !archived && <Suspense><NewCandidateDialog jobs={activeJobs.map((j) => ({ id: j.id, label: j.title }))} /></Suspense>} />

      {/* Active or archived: the two lists, always visible */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border bg-muted/50 p-1" role="tablist" aria-label="Candidate lists">
          <Link href={href({ archived: undefined, stage: undefined })} role="tab" aria-selected={!archived}
            className={cn("inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-all", !archived ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>
            <Users className="size-4" aria-hidden />Active
            <span className={cn("rounded-full px-1.5 text-xs tabular", !archived ? "bg-primary text-primary-foreground" : "bg-muted")}>{data.activeCount}</span>
          </Link>
          <Link href={href({ archived: "1", stage: undefined })} role="tab" aria-selected={archived}
            className={cn("inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-all", archived ? "bg-card text-amber-800 shadow-sm ring-1 ring-amber-200 dark:text-amber-300 dark:ring-amber-900" : "text-muted-foreground hover:text-foreground")}>
            <Archive className="size-4" aria-hidden />Archived
            <span className={cn("rounded-full px-1.5 text-xs tabular", archived ? "bg-amber-500 text-white" : "bg-muted")}>{data.archivedCount}</span>
          </Link>
        </div>
        {checking && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden />Checking resumes against jobs…</span>}
      </div>

      {archived && (
        <section className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50/70 px-5 py-4 dark:border-amber-900 dark:bg-amber-950/30">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"><Archive className="size-5" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-amber-950 dark:text-amber-100">{data.archivedCount} archived {data.archivedCount === 1 ? "candidate" : "candidates"}</h2>
            <p className="text-sm text-amber-900/80 dark:text-amber-200/80">Set aside with a reason, or rejected or withdrawn in every job. Inviting someone again brings them back.</p>
          </div>
          {data.reasons.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Reasons">
              {data.reasons.map((r) => <span key={r.reason} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800">{r.reason} <span className="tabular opacity-70">{r.n}</span></span>)}
            </div>
          )}
        </section>
      )}

      {/* Jobs: a scrolling row of cards with where each job's candidates are, plus "Find a job" */}
      <div className="mb-4"><JobPicker jobs={allJobs} selected={jobId ?? null} /></div>

      {/* Interview stages: compact chips; click to filter, click again to show everyone */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {STAGE_GROUPS.map((s) => {
          const st = STAGE_STYLE[s];
          const Icon = st.icon;
          const on = stage === s;
          const n = data.byStage[s];
          return (
            <Link key={s} href={href({ stage: on ? undefined : s })} aria-current={on ? "true" : undefined} title={st.hint}
              className={cn("group relative flex items-center gap-2.5 overflow-hidden rounded-xl border px-3 py-2 transition-all duration-200",
                on ? cn("border-transparent shadow-md ring-2", st.ring, st.soft, st.glow) : "border-border/70 bg-card shadow-sm hover:-translate-y-0.5 hover:shadow-md")}>
              {/* the stage's colour as a thin strip on the left */}
              <span className={cn("absolute inset-y-0 left-0 w-1 transition-all", st.bar, on ? "opacity-100" : "opacity-60 group-hover:opacity-100")} aria-hidden />
              <span className={cn("ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ring-black/5 dark:ring-white/10", on ? "bg-card shadow-sm" : st.soft, st.text)}><Icon className="size-3.5" aria-hidden /></span>
              <span className={cn("min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight", on ? "text-foreground" : "text-foreground/75 group-hover:text-foreground")}>{STAGE_GROUP_LABEL[s]}</span>
              <span className={cn("text-xl font-bold tracking-tight tabular", n || on ? st.text : "text-muted-foreground/50")}>{n}</span>
            </Link>
          );
        })}
      </div>

      {/* Search, sort, view */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="min-w-56 flex-1">
          <Suspense><SearchBar placeholder="Search by name, email or skill…" filters={[{ name: "sort", label: "Newest first", options: [{ value: "match", label: "Best resume match" }, { value: "experience", label: "Most experience" }] satisfies { value: CandidateSort; label: string }[] }]} /></Suspense>
        </div>
        {filtered && <Link href={href({ q: undefined, job: undefined, stage: undefined })} className="text-sm font-medium text-primary hover:underline">Clear filters</Link>}
        <div className="inline-flex rounded-xl border bg-muted/50 p-1" role="group" aria-label="View">
          <Link href={href({ view: undefined })} aria-current={!board ? "true" : undefined} className={cn("flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm", !board ? "bg-card font-medium shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}><List className="size-4" aria-hidden />List</Link>
          <Link href={href({ view: "board" })} aria-current={board ? "true" : undefined} className={cn("flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm", board ? "bg-card font-medium shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}><LayoutGrid className="size-4" aria-hidden />Board</Link>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <EmptyState icon={archived ? Archive : Users}
          title={filtered ? "No one matches these filters" : archived ? "No archived candidates" : "No candidates yet"}
          description={filtered ? "Try another job or stage, or clear the filters." : archived ? "Candidates you archive, or who are rejected or withdrawn in every job, appear here." : "Add a candidate or invite one from a job."} />
      ) : board ? (
        <CandidateBoard rows={data.rows} canEdit={canEdit} />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <div className="hidden items-center gap-4 border-b bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground sm:flex">
            <span className="flex-1 pl-14">{jobTitle ? `${data.total} ${data.total === 1 ? "candidate" : "candidates"} for ${jobTitle}` : `${data.total} ${data.total === 1 ? "candidate" : "candidates"}`}{stage ? ` · ${STAGE_GROUP_LABEL[stage]}` : ""}</span>
            <span className="hidden w-32 md:block">Resume match</span>
            <span className="w-24">Experience</span>
            <span className="w-32 text-right">Interview</span>
            <span className="hidden w-24 text-right lg:block">Added</span>
            {canEdit && <span className={archived ? "w-24" : "w-8"} />}
          </div>
          <ul className="divide-y">{data.rows.map((r) => <CandidateRow key={r.id} r={r} canEdit={canEdit} />)}</ul>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/candidates"
            params={{ q, job: jobId, stage, sort: sort === "new" ? undefined : sort, archived: archived ? "1" : undefined }} />
        </div>
      )}
    </>
  );
}
