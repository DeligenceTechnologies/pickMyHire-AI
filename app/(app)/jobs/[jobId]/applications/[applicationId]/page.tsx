import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleDashed, CircleMinus, Download, Info, Link2, Mail, Phone, Sparkles } from "lucide-react";
import { AutoRefresh } from "@/components/common/auto-refresh";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { ApplicationActions } from "@/components/applications/application-actions";
import { APPLICATION_STATUS, MatchBadge } from "@/components/applications/match-badge";
import { CandidateProfile } from "@/components/candidates/candidate-profile";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { getApplication } from "@/lib/services/applications";
import { getHrPanel } from "@/lib/services/candidate-notes";
import { HrPanel } from "@/components/candidates/hr-panel";
import { matchLevelLabel } from "@/lib/validation/ai-schemas";

export const metadata = { title: "Application" };

const REQ_ICON = {
  met: <CheckCircle2 className="size-4 text-emerald-600" />,
  partially_met: <CircleDashed className="size-4 text-amber-600" />,
  not_evident: <CircleMinus className="size-4 text-muted-foreground" />,
};
const REQ_LABEL = { met: "Met", partially_met: "Partially met", not_evident: "Not evident in resume" };

export default async function ApplicationPage(props: PageProps<"/jobs/[jobId]/applications/[applicationId]">) {
  const auth = await requireAuth("candidate:view");
  const { jobId, applicationId } = await props.params;
  if (!isUuid(jobId) || !isUuid(applicationId)) notFound();
  const a = await getApplication(auth.orgId, applicationId);
  if (!a || a.job_id !== jobId) notFound();
  const hr = await getHrPanel(auth.orgId, a.candidate_id);
  const s = a.screening;
  const busy = a.screening_status === "pending" || a.screening_status === "processing";
  const capped = s && s.ai_match_level !== a.match_level;
  return (
    <>
      <AutoRefresh active={busy} />
      <PageHeader
        back={{ href: `/jobs/${jobId}`, label: a.job_title }}
        title={<span className="flex flex-wrap items-center gap-3">{a.candidate_name} <MatchBadge level={a.match_level} screeningStatus={a.screening_status} className="text-sm" /></span>}
        meta={<>
          <span>Applied {formatDate(a.created_at, true)}</span>
          <span>{APPLICATION_STATUS[a.status]}{a.reviewer_name ? ` · by ${a.reviewer_name}` : ""}</span>
          {a.interview_status && <StatusBadge status={a.interview_status} />}
        </>}
        actions={<ApplicationActions id={a.id} status={a.status} interviewId={a.interview_id} canWrite={can(auth.role, "candidate:write")} canInvite={can(auth.role, "interview:write")}
          jobId={a.job_id} candidateId={a.candidate_id} candidateName={a.candidate_name} />}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" /> AI screening</h2>
              {a.requirements_total ? <span className="text-sm text-muted-foreground tabular">{a.requirements_met}/{a.requirements_total} requirements met</span> : null}
            </div>
            <div className="space-y-5 p-5">
              {busy && <p className="text-sm text-muted-foreground">Reading the resume and comparing it with the job requirements…</p>}
              {a.screening_status === "failed" && <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertTriangle className="size-4" />{a.screening_error}</p>}
              {s && (
                <>
                  <p className="text-sm leading-relaxed">{s.summary}</p>
                  {capped && (
                    <p className="text-xs text-muted-foreground">The AI suggested “{matchLevelLabel[s.ai_match_level]}”; the tag was adjusted to “{matchLevelLabel[a.match_level!]}” to match the number of requirements evidenced in the resume.</p>
                  )}
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Requirement</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Evidence from resume</th></tr></thead>
                      <tbody className="divide-y">
                        {s.requirements.map((r, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2.5 align-top"><p className="font-medium">{r.requirement}</p><p className="text-xs capitalize text-muted-foreground">{r.importance}</p></td>
                            <td className="px-3 py-2.5 align-top"><span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">{REQ_ICON[r.status]}{REQ_LABEL[r.status]}</span></td>
                            <td className="px-3 py-2.5 align-top text-muted-foreground">{r.evidence ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Strengths</p>
                      {s.strengths.length ? <ul className="list-disc space-y-1 pl-4 text-sm">{s.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-sm text-muted-foreground">—</p>}
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Gaps to verify</p>
                      {s.gaps.length ? <ul className="list-disc space-y-1 pl-4 text-sm">{s.gaps.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-sm text-muted-foreground">—</p>}
                    </div>
                  </div>
                  {s.experience_evidence && <p className="text-sm"><span className="text-muted-foreground">Experience: </span>{s.experience_evidence}</p>}
                  {s.suggested_interview_focus.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested interview focus</p>
                      <div className="flex flex-wrap gap-1.5">{s.suggested_interview_focus.map((x, i) => <span key={i} className="rounded-md bg-muted px-2 py-0.5 text-xs">{x}</span>)}</div>
                    </div>
                  )}
                  <p className="flex gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    <span>AI screening compares the resume with this job&apos;s requirements to help you prioritise. “Not evident” means the resume doesn&apos;t mention it — not that the applicant lacks it. Your team makes every decision.
                      {s.source === "mock" && <strong className="ml-1 text-amber-700 dark:text-amber-400">Demo mode: skill-overlap heuristic only.</strong>}</span>
                  </p>
                </>
              )}
            </div>
          </section>
          {a.parsed_profile && (
            <section className="rounded-xl border bg-card p-5">
              <h2 className="mb-4 font-semibold">Extracted profile</h2>
              <CandidateProfile profile={a.parsed_profile} />
            </section>
          )}
        </div>
        <div className="space-y-6">
          <section className="space-y-3 rounded-xl border bg-card p-5 text-sm">
            <h2 className="font-semibold">Applicant</h2>
            <p className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" />{a.candidate_email}</p>
            {a.candidate_phone && <p className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" />{a.candidate_phone}</p>}
            {a.linkedin_url && <a href={a.linkedin_url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 text-primary hover:underline"><Link2 className="size-4" />LinkedIn profile</a>}
            {a.has_resume && <a href={`/api/candidates/${a.candidate_id}/resume`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline"><Download className="size-4" />Download resume</a>}
            <a href={`/candidates/${a.candidate_id}`} className="block text-xs text-muted-foreground hover:text-foreground">Open candidate profile →</a>
            <p className="border-t pt-3 text-xs text-muted-foreground">Consent to AI screening given {formatDate(a.consent_timestamp, true)}</p>
          </section>
          {a.cover_note && (
            <section className="rounded-xl border bg-card p-5">
              <h2 className="mb-2 font-semibold">Note from applicant</h2>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{a.cover_note}</p>
            </section>
          )}
          <HrPanel candidateId={a.candidate_id} data={hr} currentUserId={auth.userId} canEdit={can(auth.role, "candidate:write")} jobId={a.job_id} jobTitle={a.job_title} />
        </div>
      </div>
    </>
  );
}
