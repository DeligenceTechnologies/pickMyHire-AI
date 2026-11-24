import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, ChevronDown, FileText, Loader2, MapPin, Sparkles, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { AutoRefresh } from "@/components/common/auto-refresh";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/states";
import { InterviewTable } from "@/components/interviews/interview-table";
import { JobActions } from "@/components/jobs/job-actions";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { employmentTypeLabel, formatDate } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { countCompletedInterviews, listInterviews } from "@/lib/services/interviews";
import { getJob } from "@/lib/services/jobs";
import { listRounds } from "@/lib/services/rounds";
import { applyUrl } from "@/lib/services/applications";
import { ApplyLinkCard } from "@/components/applications/apply-link-card";
import { fitForJob } from "@/lib/services/application-answers";
import { JobCandidates } from "@/components/jobs/job-candidates";
import { JobStats } from "@/components/jobs/job-stats";
import { listJobCandidates } from "@/lib/services/job-candidates";
import type { Fit } from "@/lib/application-form";
import { requireJobAccess } from "@/lib/auth/job-scope";
import { listJobTeam } from "@/lib/services/job-team";
import { HiringTeamCard } from "@/components/jobs/hiring-team-card";

export default async function JobPage(props: PageProps<"/jobs/[jobId]">) {
  const auth = await requireAuth();
  const { jobId } = await props.params;
  if (!isUuid(jobId)) notFound();
  const job = await getJob(auth.orgId, jobId);
  if (!job) notFound();
  await requireJobAccess(auth, jobId);
  const canSeeCandidates = can(auth.role, "candidate:view");
  const [interviews, completedCount, rounds, people, team] = await Promise.all([
    canSeeCandidates ? Promise.resolve({ rows: [], total: 0 }) : listInterviews(auth.orgId, { jobId }),
    countCompletedInterviews(auth.orgId, jobId),
    listRounds(auth.orgId, jobId),
    canSeeCandidates ? listJobCandidates(auth.orgId, jobId) : Promise.resolve(null),
    listJobTeam(auth.orgId, jobId),
  ]);
  // The fit check compares pay with the budget, so only people who see salary details get it.
  const fits = canSeeCandidates && can(auth.role, "candidate:salary") ? await fitForJob(auth.orgId, jobId) : new Map<string, Fit>();
  const screening = !!people?.rows.some((r) => r.match_status === "pending" || r.match_status === "processing");
  const req = job.parsed_requirements;
  const parsing = job.parse_status === "pending" || job.parse_status === "processing";
  return (
    <>
      <AutoRefresh active={parsing || screening} />
      <PageHeader
        back={{ href: "/jobs", label: "Jobs" }}
        title={<span className="flex items-center gap-3">{job.title} <StatusBadge status={job.status} /></span>}
        meta={<>
          {job.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{job.location}</span>}
          {job.employment_type && <span>{employmentTypeLabel[job.employment_type]}</span>}
          {job.experience_min != null && <span>{job.experience_min}{job.experience_max != null ? `–${job.experience_max}` : "+"} years</span>}
          <span>Created {formatDate(job.created_at)}</span>
        </>}
        actions={can(auth.role, "job:write") && <JobActions jobId={job.id} status={job.status} />}
      />
      {people && <JobStats jobId={job.id} rows={people.rows} />}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {canSeeCandidates ? (
            <JobCandidates jobId={job.id} completedCount={completedCount} canInvite={can(auth.role, "interview:write") && job.status !== "closed"}
              rows={people!.rows.map((r) => ({
                ...r, added_at: r.added_at.toISOString(), last_activity: r.last_activity.toISOString(), fit: fits.get(r.id)?.level ?? "none",
                results: r.results.map((x) => ({ ...x, entry: x.entry && { kind: x.entry.kind, id: x.entry.id, status: x.entry.status } })),
              }))} />
          ) : (
            <section className="rounded-xl border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
                <h2 className="font-semibold">AI interviews <span className="ml-1 text-sm font-normal text-muted-foreground">{interviews.total}</span></h2>
                {completedCount > 1 && <Link href={`/jobs/${job.id}/compare`} className={buttonVariants({ variant: "outline" })}><BarChart3 /> Compare</Link>}
              </div>
              {interviews.rows.length ? <InterviewTable rows={interviews.rows} hideJob showRound /> : (
                <div className="p-5"><EmptyState icon={Users} title="No interviews yet" description="Interviews for this job will show here." /></div>
              )}
            </section>
          )}
          <details className="group rounded-2xl border bg-card shadow-sm" open={!canSeeCandidates}>
            <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
              <FileText className="size-4.5 text-muted-foreground" aria-hidden />
              <h2 className="font-semibold">Job description</h2>
              <span className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
                <span className="group-open:hidden">View full description</span><span className="hidden group-open:inline">Hide description</span>
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
              </span>
            </summary>
            <div className="border-t px-5 py-4">
              {job.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{job.description}</p> : <p className="text-sm text-muted-foreground">No description added.</p>}
            </div>
          </details>
        </div>
        <div className="min-w-0 space-y-6">
          <HiringTeamCard jobId={job.id} team={team} canEdit={can(auth.role, "job:write")} />
          {canSeeCandidates && <ApplyLinkCard jobId={job.id} enabled={job.apply_enabled} url={job.apply_slug ? applyUrl(job.apply_slug) : null} jobActive={job.status === "active"} canEdit={can(auth.role, "job:write")} />}
          {/* Folded like the job description: hidden until opened. */}
          <details className="group rounded-xl border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 [&::-webkit-details-marker]:hidden">
              <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" /> Parsed requirements</h2>
              {parsing && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Analyzing</span>}
              <span className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
                <span className="group-open:hidden">View</span><span className="hidden group-open:inline">Hide</span>
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
              </span>
            </summary>
            <div className="border-t px-5 py-4">
            {job.parse_status === "failed" && <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{job.parse_error}</p>}
            {req ? (
              <div className="space-y-4 text-sm">
                <p className="text-muted-foreground">{req.summary}</p>
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Required</p>
                  <div className="flex flex-wrap gap-1.5">{req.skills.filter((s) => s.importance === "required").map((s) => <span key={s.name} className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">{s.name}</span>)}</div>
                </div>
                {req.skills.some((s) => s.importance === "preferred") && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Preferred</p>
                    <div className="flex flex-wrap gap-1.5">{req.skills.filter((s) => s.importance === "preferred").map((s) => <span key={s.name} className="rounded-md bg-muted px-2 py-0.5 text-xs">{s.name}</span>)}</div>
                  </div>
                )}
                {req.experience.minimum_years != null && <p><span className="text-muted-foreground">Experience:</span> {req.experience.minimum_years}+ years</p>}
                {req.seniority !== "unknown" && <p><span className="text-muted-foreground">Seniority:</span> <span className="capitalize">{req.seniority}</span></p>}
                {req.responsibilities.length > 0 && (
                  <ul className="list-disc space-y-1 pl-4 text-muted-foreground">{req.responsibilities.slice(0, 6).map((r) => <li key={r}>{r}</li>)}</ul>
                )}
              </div>
            ) : !parsing && <p className="text-sm text-muted-foreground">Add a job description to extract structured requirements.</p>}
            </div>
          </details>
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Interview rounds</h2>
              {can(auth.role, "job:write") && <Link href={`/jobs/${job.id}/edit`} className="text-xs text-primary hover:underline">Edit rounds</Link>}
            </div>
            {rounds.length ? (
              <ol className="space-y-3">
                {rounds.map((r, i) => (
                  <li key={r.id} className="flex gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{i + 1}</span>
                    <div className="min-w-0 text-sm">
                      <p className="font-medium"><span>{r.name}</span> <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">{r.kind === "human" ? "Human" : "AI"}</span></p>
                      {r.kind === "human"
                        ? <p className="text-xs text-muted-foreground">Assess: {r.criteria.join(", ")}</p>
                        : r.template_id
                        ? <Link href={`/templates/${r.template_id}`} className="text-xs text-primary hover:underline">{r.template_name} · {r.minutes} min</Link>
                        : <p className="text-xs text-destructive">No template: edit the job to choose one</p>}
                      <p className="text-xs text-muted-foreground">{r.completed} completed · {r.interviews} invited</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-muted-foreground">No interview rounds yet. Edit the job to add one.</p>}
          </section>
        </div>
      </div>
    </>
  );
}
