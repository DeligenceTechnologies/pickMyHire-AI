import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, Download, Loader2, Mail, Phone, Sparkles, Upload } from "lucide-react";
import { ArchiveButton } from "@/components/candidates/archive-button";
import { buttonVariants } from "@/components/ui/button";
import { AutoRefresh } from "@/components/common/auto-refresh";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { CandidateActions } from "@/components/candidates/candidate-actions";
import { CandidateProfile } from "@/components/candidates/candidate-profile";
import { ReparseButton } from "@/components/candidates/reparse-button";
import { ResumeUploader } from "@/components/candidates/resume-uploader";
import { InviteDialog } from "@/components/interview/invite-dialog";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { roundLabel } from "@/components/interviews/interview-table";
import { formatDate } from "@/lib/format";
import { formatInZone } from "@/lib/hiring";
import { isUuid } from "@/lib/ids";
import { getCandidate } from "@/lib/services/candidates";
import { getJob, listJobs } from "@/lib/services/jobs";
import { CandidatePipelines } from "@/components/hiring/candidate-pipeline";
import { env } from "@/lib/env";
import { listPanelCandidates } from "@/lib/services/human-interviews";
import { getCandidatePipelines } from "@/lib/services/pipeline";
import { jobListNav } from "@/lib/services/job-candidates";
import { ApplicationNav } from "@/components/applications/application-nav";
import { summariesForPipelines } from "@/lib/services/candidate-summary";
import { getHrPanel, visibleHrPanel } from "@/lib/services/candidate-notes";
import { candidateJobsInScope } from "@/lib/auth/job-scope";
import { HrPanel } from "@/components/candidates/hr-panel";
import { AnswersCard } from "@/components/applications/answers-card";
import { answersForCandidate } from "@/lib/services/application-answers";

export default async function CandidatePage(props: PageProps<"/candidates/[candidateId]">) {
  const auth = await requireAuth("candidate:view");
  const { candidateId } = await props.params;
  if (!isUuid(candidateId)) notFound();
  const c = await getCandidate(auth.orgId, candidateId);
  if (!c) notFound();
  // Interviewers see a candidate only through their own jobs, and only those jobs' parts of the profile.
  const scope = await candidateJobsInScope(auth, candidateId);
  if (scope && !scope.length) notFound();
  const inScope = (jobId: string) => !scope || scope.includes(jobId);
  const salary = can(auth.role, "candidate:salary");
  const canSchedule = can(auth.role, "interview:write");
  const [jobs, allPipelines, members, hrAll, allAnswers] = await Promise.all([
    canSchedule ? listJobs(auth.orgId, { status: "active" }) : Promise.resolve([]),
    getCandidatePipelines(auth.orgId, candidateId),
    canSchedule ? listPanelCandidates(auth.orgId) : Promise.resolve([]),
    getHrPanel(auth.orgId, candidateId),
    // Application answers hold pay and notice period: salary details.
    salary ? answersForCandidate(auth.orgId, candidateId) : Promise.resolve([]),
  ]);
  const pipelines = allPipelines.filter((p) => inScope(p.job_id));
  const answers = allAnswers.filter((a) => inScope(a.job_id));
  const hr = visibleHrPanel(hrAll, salary, scope);
  const interviews = c.interviews.filter((i) => inScope(i.job_id));
  const summaryRows = await summariesForPipelines(auth.orgId, candidateId, pipelines);
  const summaries = Object.fromEntries([...summaryRows].map(([jobId, r]) => [jobId, { status: r.status, summary: r.summary, source: "source" in r ? r.source : null }]));
  const parsing = c.parse_status === "pending" || c.parse_status === "processing";
  const canWrite = can(auth.role, "candidate:write");
  // Opened from a job's candidate list: Previous / Next through that list, and Back to it.
  const sp = await props.searchParams;
  const fromJob = typeof sp.job === "string" && isUuid(sp.job) && inScope(sp.job) ? sp.job : null;
  const nav = fromJob ? await jobListNav(auth.orgId, fromJob, sp, candidateId) : null;
  const fromJobTitle = nav ? pipelines.find((p) => p.job_id === fromJob)?.job_title ?? (await getJob(auth.orgId, fromJob!))?.title ?? "Job" : null;
  return (
    <>
      <AutoRefresh active={parsing || [...summaryRows.values()].some((r) => r.status === "processing")} />
      <PageHeader
        back={nav ? { href: nav.listHref, label: fromJobTitle! }
          : scope ? { href: `/jobs/${scope[0]}`, label: pipelines.find((p) => p.job_id === scope[0])?.job_title ?? "Job" }
          : { href: "/candidates", label: "Candidates" }}
        title={c.name}
        meta={<>
          <span className="inline-flex items-center gap-1"><Mail className="size-3.5" />{c.email}</span>
          {c.phone && <span className="inline-flex items-center gap-1"><Phone className="size-3.5" />{c.phone}</span>}
          <span>Added {formatDate(c.created_at)}</span>
        </>}
        actions={<>
          <CandidateActions candidate={{ id: c.id, name: c.name, email: c.email, phone: c.phone }} canEdit={canWrite} canDelete={can(auth.role, "data:delete")} />
          {canWrite && <ArchiveButton id={c.id} name={c.name} archived={!!c.archived_at} />}
          {jobs.length > 0 && (c.resume_file_path
            ? <InviteDialog candidateId={c.id} candidateName={c.name} jobs={jobs.map((j) => ({ id: j.id, label: j.title }))} triggerLabel="Invite to interview" />
            : <a href="#resume" title="The interview is planned from the resume" className={buttonVariants({ variant: "outline" })}><Upload /> Upload resume to invite</a>)}
        </>}
      />
      {nav && (nav.prevHref || nav.nextHref) && <ApplicationNav {...nav} noun={["candidate", "candidates"]} />}
      {c.archived_at && (
        <p className="mb-6 flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
          <Archive className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span><b>Archived</b>{c.archived_reason ? `: ${c.archived_reason}` : ""}. {c.name.split(" ")[0]} isn&apos;t in the active candidate list. Restore them, or invite them again, to bring them back.</span>
        </p>
      )}
      {pipelines.length > 0 && (
        <div className="mb-6 space-y-3">
          <h2 className="font-semibold">Hiring progress</h2>
          <CandidatePipelines pipelines={pipelines} candidateId={c.id} candidateName={c.name} canDecide={can(auth.role, "decision:write")} canSchedule={canSchedule}
            members={members.map((m) => ({ user_id: m.user_id, name: m.name, role: m.role }))} emailLive={env().EMAIL_PROVIDER !== "log"} summaries={summaries} />
        </div>
      )}
      {answers.length > 0 && <div className="mb-6"><AnswersCard candidateId={c.id} items={answers} canEdit={canWrite} showJob /></div>}
      <div className="mb-6"><HrPanel candidateId={c.id} data={hr} currentUserId={auth.userId} canEdit={canWrite && salary} canNote={can(auth.role, "note:write")} showDetails={salary}
        jobId={scope ? fromJob ?? scope[0] : undefined} jobTitle={scope ? pipelines.find((p) => p.job_id === (fromJob ?? scope[0]))?.job_title : undefined} /></div>
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border bg-card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" /> Extracted profile</h2>
            {parsing ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Analyzing resume</span>
              : c.resume_file_path && canWrite && <ReparseButton candidateId={c.id} />}
          </div>
          {c.parse_status === "failed" && <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{c.parse_error}</p>}
          {c.parsed_profile ? <CandidateProfile profile={c.parsed_profile} /> : !parsing && (
            <p className="text-sm text-muted-foreground">Upload a resume to extract experience, skills and projects. The AI only extracts what&apos;s explicitly written — nothing is inferred.</p>
          )}
        </section>
        <div className="space-y-6">
          <section id="resume" className="scroll-mt-24 rounded-xl border bg-card p-5">
            <h2 className="mb-3 font-semibold">Resume</h2>
            {!c.resume_file_path && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">Required to invite {c.name.split(" ")[0]} to an interview: the interview is planned from it.</p>}
            {c.documents[0] && (
              <a href={`/api/candidates/${c.id}/resume`} target="_blank" rel="noreferrer" className="mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
                <Download className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate">{c.documents[0].file_name}</span>
                <span className="text-xs text-muted-foreground">{Math.round(c.documents[0].file_size / 1024)} KB</span>
              </a>
            )}
            {canWrite && <ResumeUploader candidateId={c.id} hasResume={!!c.documents.length} />}
          </section>
          <section className="rounded-xl border bg-card">
            <h2 className="border-b px-5 py-4 font-semibold">Interviews</h2>
            {interviews.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">Not invited to any interviews yet.</p> : (
              <ul className="divide-y">
                {interviews.map((i) => (
                  <li key={i.id}>
                    <Link href={i.kind === "human" ? `/interviews/human/${i.id}` : `/interviews/${i.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{i.job_title}</p>
                        <p className="text-xs text-muted-foreground">{[i.kind === "human" ? "Human" : "AI", roundLabel(i), i.kind === "human" && i.scheduled_at && i.timezone ? formatInZone(i.scheduled_at, i.timezone) : formatDate(i.created_at)].filter(Boolean).join(" · ")}</p>
                      </div>
                      <StatusBadge status={i.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
