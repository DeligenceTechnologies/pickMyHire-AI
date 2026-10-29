import { notFound } from "next/navigation";
import Link from "next/link";
import { AutoRefresh } from "@/components/common/auto-refresh";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { InterviewActions } from "@/components/interviews/interview-actions";
import { roundLabel } from "@/components/interviews/interview-table";
import { InterviewViewer, type ViewerTab } from "@/components/reports/interview-viewer";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { formatDate, formatDuration } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { getInterviewDetail } from "@/lib/services/interviews";
import { listInterviewFeedback } from "@/lib/services/feedback";
import { getSettings } from "@/lib/services/workspace";
import { recoverIfStale } from "@/lib/interview/processing";
import { getFaceVerification } from "@/lib/interview/face";
import { getOutcomeInput } from "@/lib/interview/outcome-data";
import { DecisionControl } from "@/components/hiring/decision-control";

/** Shared server page for /interviews/[id] and its tab sub-routes. */
export async function InterviewPage({ params, tab }: { params: Promise<{ interviewId: string }>; tab: ViewerTab }) {
  const auth = await requireAuth("interview:view");
  const { interviewId } = await params;
  if (!isUuid(interviewId)) notFound();
  const [detail, { settings }, feedback, face, outcome] = await Promise.all([getInterviewDetail(auth.orgId, interviewId), getSettings(auth.orgId), listInterviewFeedback(auth.orgId, interviewId), getFaceVerification(auth.orgId, interviewId), tab === "overview" ? getOutcomeInput(auth.orgId, interviewId) : null]);
  if (!detail) notFound();
  recoverIfStale(auth.orgId, detail);
  const live = ["in_progress", "completing", "processing"].includes(detail.status)
    || (detail.status === "completed" && !detail.processing_error)
    || detail.plan_status === "processing" || detail.plan_status === "pending"
    || detail.sections.some((s) => s.evaluation_status === "processing");
  return (
    <>
      <AutoRefresh active={live} intervalMs={5000} />
      <PageHeader
        back={{ href: "/interviews", label: "Interviews" }}
        title={<span className="flex flex-wrap items-center gap-3">{detail.candidate_name} <StatusBadge status={detail.status} /></span>}
        meta={<>
          <Link href={`/jobs/${detail.job_id}`} className="hover:text-foreground">{detail.job_title}</Link>
          {roundLabel(detail) && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">{roundLabel(detail)}</span>}
          <span>{detail.started_at ? formatDate(detail.started_at, true) : `Created ${formatDate(detail.created_at)}`}</span>
          {detail.duration_seconds != null && <span>{formatDuration(detail.duration_seconds)}</span>}
        </>}
        actions={<InterviewActions id={detail.id} status={detail.status} canWrite={can(auth.role, "interview:write")} canDelete={can(auth.role, "data:delete")} canRegenerate={can(auth.role, "report:regenerate")} />}
      />
      {["completed", "processing", "report_ready"].includes(detail.status) && (can(auth.role, "decision:write") || detail.decision) && (
        <section className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card px-5 py-4" aria-label="Round decision">
          <div className="max-w-md">
            <h2 className="font-semibold">Round decision{detail.round_name ? `: ${detail.round_name}` : ""}</h2>
            <p className="text-xs text-muted-foreground">The AI report is advice. Your team decides whether the candidate moves on.</p>
          </div>
          <div className="min-w-0 sm:max-w-md">
            <DecisionControl endpoint={`/api/interviews/${detail.id}/decision`} decision={detail.decision} note={detail.decision_note} decidedBy={detail.decided_by_name}
              decidedOn={detail.decided_at ? formatDate(detail.decided_at) : null} canEdit={can(auth.role, "decision:write")} />
          </div>
        </section>
      )}
      <InterviewViewer detail={detail} initialTab={tab} showScores={settings.show_scores} canViewRecording={can(auth.role, "recording:view")} canRegenerate={can(auth.role, "report:regenerate")} canViewCandidates={can(auth.role, "candidate:view")} feedback={feedback} face={face} outcome={outcome} />
    </>
  );
}
