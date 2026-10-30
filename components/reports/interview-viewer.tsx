"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Info, Loader2, Mail, MessageSquareHeart, PlayCircle, RefreshCw, Sparkles, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssessmentBadge, StatusBadge } from "@/components/common/status-badge";
import { TranscriptViewer, type Segment } from "@/components/transcript/transcript-viewer";
import { api } from "@/lib/client/api";
import { formatClock, formatDate, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InterviewDetail } from "@/lib/services/interviews";
import type { InterviewFeedbackRow } from "@/lib/services/feedback";
import { ISSUE_CATEGORIES } from "@/lib/feedback";
import type { StoredReport } from "@/lib/interview/processing";
import type { AnswerAnalysis } from "@/lib/validation/ai-schemas";
import { DownloadMenu } from "./download-menu";
import { FaceVerificationCard, type FaceVerification } from "./face-verification-card";
import { OutcomeAlert, OutcomeCard, useOutcome } from "@/components/interviews/outcome-card";
import type { OutcomeInput } from "@/lib/interview/outcome";
import { InterviewTimeline } from "./interview-timeline";
import { VideoPlayer, type RecordingPart, type VideoPlayerHandle } from "./video-player";

export type ViewerTab = "overview" | "report" | "transcript" | "recording" | "questions" | "evaluation";
const TABS: { id: ViewerTab; label: string; path: string }[] = [
  { id: "overview", label: "Overview", path: "" },
  { id: "report", label: "Report", path: "/report" },
  { id: "transcript", label: "Transcript", path: "/transcript" },
  { id: "recording", label: "Recording", path: "/recording" },
  { id: "questions", label: "Questions", path: "/questions" },
  { id: "evaluation", label: "Evaluation", path: "/evaluation" },
];

type Detail = NonNullable<InterviewDetail>;

function WatchButton({ ms, onClick, label = "Watch evidence" }: { ms: number; onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-accent">
      <PlayCircle className="size-3.5" /> <span className="font-mono tabular">{formatClock(ms)}</span> <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}

function Card({ title, children, className, action }: { title?: React.ReactNode; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {title && <div className="flex items-center justify-between gap-2 border-b px-5 py-3.5"><h3 className="font-semibold">{title}</h3>{action}</div>}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function InterviewViewer({ detail, initialTab, showScores, canViewRecording, canRegenerate, canViewCandidates, feedback = [], face = null, outcome = null }: {
  detail: Detail;
  face?: FaceVerification | null;
  outcome?: OutcomeInput | null;
  feedback?: InterviewFeedbackRow[];
  initialTab: ViewerTab;
  showScores: boolean;
  canViewRecording: boolean;
  canRegenerate: boolean;
  canViewCandidates: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<ViewerTab>(initialTab);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [parts, setParts] = useState<RecordingPart[] | null>(null);
  const [voice, setVoice] = useState<RecordingPart[] | null>(null);
  const [recError, setRecError] = useState<string | null>(canViewRecording ? null : "You don't have access to recordings.");
  const [currentMs, setCurrentMs] = useState(0);
  const [focused, setFocused] = useState<string | null>(null);
  const player = useRef<VideoPlayerHandle>(null);
  const lastAudit = useRef(0);
  const base = `/interviews/${detail.id}`;
  const started = !!detail.started_at;
  const report = detail.report?.report_json as StoredReport | null | undefined;

  useEffect(() => {
    if (!started) return;
    api<{ segments: Segment[] }>(`/api/interviews/${detail.id}/transcript`).then((r) => setSegments(r.segments)).catch(() => setSegments([]));
    if (canViewRecording) {
      api<{ parts: RecordingPart[]; voice?: RecordingPart[] }>(`/api/interviews/${detail.id}/recording`).then((r) => { setParts(r.parts); setVoice(r.voice ?? []); }).catch((e) => setRecError((e as Error).message));
    }
  }, [detail.id, started, canViewRecording, detail.segment_count]);

  useEffect(() => {
    if (report) api(`/api/interviews/${detail.id}/audit`, { body: { action: "report_viewed" } }).catch(() => {});
  }, [detail.id, report]);

  const switchTab = (t: ViewerTab) => {
    setTab(t);
    const path = TABS.find((x) => x.id === t)!.path;
    if (pathname !== base + path) window.history.replaceState(null, "", base + path);
  };

  const jump = useCallback((ms: number, segmentId?: string | null) => {
    player.current?.seek(ms);
    setCurrentMs(ms);
    let id = segmentId ?? null;
    if (!id && segments) {
      for (const s of segments) if (s.start_time_ms <= ms + 500) id = s.id;
    }
    setFocused(id);
    setTimeout(() => setFocused(null), 4000);
    if (Date.now() - lastAudit.current > 10_000) {
      lastAudit.current = Date.now();
      api(`/api/interviews/${detail.id}/audit`, { body: { action: "evidence_viewed", ms: Math.round(ms) } }).catch(() => {});
    }
  }, [segments, detail.id]);

  // Links such as /interviews/{id}/recording?t=754000 open the video at that moment.
  const startAt = useRef<number | null>(null);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (t && /^\d+$/.test(t)) startAt.current = Number(t);
  }, []);
  useEffect(() => {
    if (!parts?.length || startAt.current == null) return;
    const ms = startAt.current;
    startAt.current = null;
    requestAnimationFrame(() => jump(ms));
  }, [parts, jump]);

  const totalMs = useMemo(() => {
    const segEnd = segments?.length ? segments[segments.length - 1].end_time_ms : 0;
    return Math.max((detail.duration_seconds ?? 0) * 1000, segEnd, ...detail.sections.map((s) => s.end_ms ?? 0));
  }, [segments, detail]);

  const sectionsForTimeline = detail.sections.map((s) => ({ id: s.id, name: s.name, start_ms: s.start_ms, end_ms: s.end_ms }));
  const processing = ["completed", "processing"].includes(detail.status) && detail.report?.status !== "completed" && !detail.processing_error;

  const media = (compact: boolean) => (
    <div className={cn("space-y-3", compact && "lg:sticky lg:top-20")}>
      <VideoPlayer ref={player} parts={parts} voice={voice} error={recError} onTime={setCurrentMs} />
      <InterviewTimeline sections={sectionsForTimeline} totalMs={totalMs} currentMs={currentMs} onSeek={(ms) => jump(ms)} />
      {!compact && (
        <div className="flex justify-end">
          <DownloadMenu interviewId={detail.id} name={`${detail.candidate_name} - ${detail.job_title}`} parts={canViewRecording ? parts : null} voice={canViewRecording ? voice : null} />
        </div>
      )}
      {compact && (
        <TranscriptViewer className="h-[42vh]" segments={segments} currentMs={currentMs} focusedId={focused} onSeek={(ms, id) => jump(ms, id)} sections={detail.sections} />
      )}
    </div>
  );

  return (
    <div>
      <div className="mb-6 flex gap-1 overflow-x-auto border-b" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => switchTab(t.id)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors", tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>

      {processing && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <Loader2 className="size-4 animate-spin" /> Evaluating sections and generating the report. This page updates automatically.
        </div>
      )}
      {detail.processing_error && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <AlertTriangle className="size-4" /> <span className="flex-1">{detail.processing_error}</span>
          {canRegenerate && <Button size="sm" variant="outline" onClick={() => api(`/api/interviews/${detail.id}/report`, { body: {} }).then(() => router.refresh())}><RefreshCw /> Retry</Button>}
        </div>
      )}

      {!started ? (
        <NotStarted detail={detail} tab={tab} />
      ) : tab === "recording" || tab === "transcript" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div>{media(false)}</div>
          <TranscriptViewer className="h-[70vh]" segments={segments} currentMs={currentMs} focusedId={focused} onSeek={(ms, id) => jump(ms, id)} sections={detail.sections} />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-6">
            {tab === "overview" && <Overview detail={detail} report={report} showScores={showScores} jump={jump} onOpenReport={() => switchTab("report")} canViewCandidates={canViewCandidates} feedback={feedback} face={face} canViewPhotos={canViewRecording} outcomeInput={outcome} />}
            {tab === "report" && <ReportView detail={detail} report={report} showScores={showScores} jump={jump} />}
            {tab === "questions" && <QuestionsView detail={detail} jump={jump} />}
            {tab === "evaluation" && <EvaluationView detail={detail} showScores={showScores} jump={jump} />}
          </div>
          <div>{media(true)}</div>
        </div>
      )}
    </div>
  );
}

function Disclaimer({ source }: { source?: string }) {
  return (
    <p className="flex gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>
        AI-generated summary of interview evidence to support your review. It is not a hiring recommendation — verify evidence in the recording and transcript before making decisions.
        {source === "mock" && <strong className="ml-1 text-amber-700 dark:text-amber-400">Generated in demo mode (no OpenAI key): heuristic only.</strong>}
      </span>
    </p>
  );
}

function Overview({ detail, report, showScores, jump, onOpenReport, canViewCandidates, feedback, face, canViewPhotos, outcomeInput }: { detail: Detail; report: StoredReport | null | undefined; showScores: boolean; jump: (ms: number, id?: string | null) => void; onOpenReport: () => void; canViewCandidates: boolean; feedback: InterviewFeedbackRow[]; face: FaceVerification | null; canViewPhotos: boolean; outcomeInput: OutcomeInput | null }) {
  const completedSections = detail.sections.filter((s) => s.status === "completed").length;
  const outcome = useOutcome(outcomeInput);
  return (
    <>
      {outcome && <OutcomeAlert outcome={outcome} />}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Duration", formatDuration(detail.duration_seconds)],
          ["Sections completed", `${completedSections}/${detail.sections.length}`],
          ["Questions asked", `${detail.questions.length} (${detail.questions.filter((q) => q.is_followup).length} follow-ups)`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 text-lg font-semibold tabular">{v}</p></div>
        ))}
      </div>
      {face && <FaceVerificationCard interviewId={detail.id} face={face} canViewPhotos={canViewPhotos} onJump={(ms) => jump(ms)} />}
      {report ? (
        <Card title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Summary</span>} action={<Button size="sm" variant="ghost" onClick={onOpenReport}>Full report</Button>}>
          <p className="text-sm leading-relaxed">{report.final.summary}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Strengths</p>
              {report.final.strengths.length ? <ul className="space-y-1.5 text-sm">{report.final.strengths.map((s, i) => <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />{s.point}</li>)}</ul> : <p className="text-sm text-muted-foreground">None identified with sufficient evidence.</p>}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Areas to explore</p>
              {report.final.areas_to_explore.length ? <ul className="space-y-1.5 text-sm">{report.final.areas_to_explore.map((s, i) => <li key={i} className="flex gap-2"><CircleDashed className="mt-0.5 size-3.5 shrink-0 text-amber-600" />{s.point}</li>)}</ul> : <p className="text-sm text-muted-foreground">None noted.</p>}
            </div>
          </div>
          <div className="mt-4"><Disclaimer source={report.generated_by} /></div>
        </Card>
      ) : null}
      <Card title="Section assessments">
        <ul className="divide-y">
          {detail.sections.map((s) => {
            const ev = detail.evaluations.find((e) => e.section_id === s.id);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{s.objective}</p>
                </div>
                {s.start_ms != null && <WatchButton ms={s.start_ms} onClick={() => jump(s.start_ms!)} label="Jump" />}
                {s.status === "completed"
                  ? s.evaluation_status === "processing" || (!ev && s.evaluation_status !== "failed") ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Evaluating</span>
                  : s.evaluation_status === "failed" ? <span className="text-xs text-destructive">Evaluation failed</span>
                  : <AssessmentBadge assessment={ev?.assessment} score={ev?.score} showScore={showScores && s.config.scoring_enabled} />
                  : <StatusBadge status={s.status} />}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="Interview details">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {[
            ["Candidate", canViewCandidates ? <Link key="c" href={`/candidates/${detail.candidate_id}`} className="text-primary hover:underline">{detail.candidate_name}</Link> : detail.candidate_name],
            ["Job", <Link key="j" href={`/jobs/${detail.job_id}`} className="text-primary hover:underline">{detail.job_title}</Link>],
            ["Template", detail.template_name ?? "—"],
            ["Started", formatDate(detail.started_at, true)],
            ["Completed", formatDate(detail.completed_at, true)],
            ["Consent", detail.consent_given ? `Given ${formatDate(detail.consent_timestamp, true)} (v${detail.consent_version})` : "Not given"],
            ["Recording", detail.recordings.length ? `${detail.recordings.filter((r) => r.status === "stored").length}/${detail.recordings.length} part(s) stored` : "None"],
            ["Plan", detail.interview_plan ? `${detail.interview_plan.generated_by === "mock" ? "Demo-mode" : "AI"} plan · ${detail.interview_plan.prompt_version}` : "—"],
          ].map(([k, v]) => <div key={String(k)}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-0.5">{v}</dd></div>)}
        </dl>
      </Card>
      {outcome && <OutcomeCard outcome={outcome} />}
      {detail.candidate_email_sent_at && <CandidateEmailCard sentAt={detail.candidate_email_sent_at} feedback={detail.candidate_feedback} />}
      {feedback.length > 0 && <CandidateFeedbackCard items={feedback} />}
    </>
  );
}

/** What the candidate was emailed after the interview: a confirmation, and the AI feedback when it was included. */
function CandidateEmailCard({ sentAt, feedback }: { sentAt: Date | string; feedback: string | null }) {
  return (
    <Card title={<span className="flex items-center gap-2"><Mail className="size-4 text-primary" /> Email sent to the candidate</span>}>
      <p className="text-sm text-muted-foreground">
        Sent {formatDate(sentAt, true)}: a confirmation that their interview was received{feedback ? ", with this AI feedback" : ", without AI feedback"}.
      </p>
      {feedback ? (
        <>
          <blockquote className="mt-3 border-l-2 border-primary/40 pl-3 text-sm leading-relaxed">{feedback}</blockquote>
          <p className="mt-3 text-xs text-muted-foreground">Labelled in the email as AI-generated feedback from their answers, not a hiring decision. Turn it off in Settings → Interview.</p>
        </>
      ) : null}
    </Card>
  );
}

function CandidateFeedbackCard({ items }: { items: InterviewFeedbackRow[] }) {
  const issues = items.filter((f) => f.kind === "issue").length;
  return (
    <Card
      className={issues ? "border-amber-300 dark:border-amber-800" : undefined}
      title={<span className="flex items-center gap-2">
        {issues ? <AlertTriangle className="size-4 text-amber-600" /> : <MessageSquareHeart className="size-4 text-primary" />}
        Candidate feedback
        {issues > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">{issues} issue{issues > 1 ? "s" : ""} reported</span>}
      </span>}
    >
      <ul className="divide-y">
        {items.map((f) => (
          <li key={f.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              {f.kind === "issue" ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="size-3.5" /> Issue: {ISSUE_CATEGORIES[f.category as keyof typeof ISSUE_CATEGORIES] ?? f.category}
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5" aria-label={`${f.rating} out of 5 stars`}>
                  {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cn("size-4", n <= (f.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} />)}
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">{formatDate(f.created_at, true)}</span>
            </div>
            {f.message ? <p className="mt-1.5 text-sm whitespace-pre-wrap">{f.message}</p> : f.kind === "feedback" ? <p className="mt-1 text-xs text-muted-foreground">No comment left.</p> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReportView({ detail, report, showScores, jump }: { detail: Detail; report: StoredReport | null | undefined; showScores: boolean; jump: (ms: number, id?: string | null) => void }) {
  if (!report) {
    return <Card><p className="py-8 text-center text-sm text-muted-foreground">{detail.report?.status === "failed" ? "We couldn't generate the report yet. The interview data is safe — use Retry above." : "The report will appear here once the interview has been processed."}</p></Card>;
  }
  const refJump = (ref: string) => {
    const r = report.refs[ref];
    if (r) jump(r.start_ms, r.segment_id);
  };
  return (
    <>
      <Card title="Candidate interview report">
        <div className="mb-4 grid gap-3 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">Candidate</p><p className="font-medium">{detail.candidate_name}</p></div>
          <div><p className="text-xs text-muted-foreground">Role</p><p className="font-medium">{detail.job_title}</p></div>
          <div><p className="text-xs text-muted-foreground">Date</p><p className="font-medium">{formatDate(detail.started_at)}</p></div>
          <div><p className="text-xs text-muted-foreground">Duration · Sections</p><p className="font-medium">{formatDuration(detail.duration_seconds)} · {detail.sections.filter((s) => s.status === "completed").length}/{detail.sections.length}</p></div>
        </div>
        <p className="text-sm leading-relaxed">{report.final.summary}</p>
        <p className="mt-3 text-xs text-muted-foreground">{report.final.fact_vs_interpretation_note}</p>
        <div className="mt-4"><Disclaimer source={report.generated_by} /></div>
      </Card>
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Strengths">
          {report.final.strengths.length ? (
            <ul className="space-y-3 text-sm">
              {report.final.strengths.map((s, i) => (
                <li key={i}>
                  <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />{s.point}</p>
                  <div className="mt-1 flex flex-wrap gap-1 pl-6">{s.evidence_refs.filter((r) => report.refs[r]).map((r) => <WatchButton key={r} ms={report.refs[r].start_ms} onClick={() => refJump(r)} label="Evidence" />)}</div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No strengths identified with sufficient evidence.</p>}
        </Card>
        <Card title="Areas to explore">
          {report.final.areas_to_explore.length ? (
            <ul className="space-y-3 text-sm">{report.final.areas_to_explore.map((a, i) => <li key={i}><p className="font-medium">{a.point}</p><p className="text-muted-foreground">{a.reason}</p></li>)}</ul>
          ) : <p className="text-sm text-muted-foreground">None noted.</p>}
          {report.final.missing_evidence.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Not covered in the interview</p>
              <ul className="list-disc pl-4 text-sm text-muted-foreground">{report.final.missing_evidence.map((m, i) => <li key={i}>{m}</li>)}</ul>
            </div>
          )}
        </Card>
      </div>
      <Card title="Key evidence">
        {report.final.key_evidence.length ? (
          <ul className="space-y-3">
            {report.final.key_evidence.map((e, i) => (
              <li key={i} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{e.claim}</p>
                  <WatchButton ms={e.timestamp_start_ms} onClick={() => e.segment_ref ? refJump(e.segment_ref) : jump(e.timestamp_start_ms)} />
                </div>
                <blockquote className="mt-1.5 border-l-2 pl-3 text-sm text-muted-foreground italic">“{e.quote_or_paraphrase}”</blockquote>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">No key evidence recorded.</p>}
      </Card>
      <EvaluationView detail={detail} showScores={showScores} jump={jump} />
    </>
  );
}

function EvaluationView({ detail, showScores, jump }: { detail: Detail; showScores: boolean; jump: (ms: number, id?: string | null) => void }) {
  return (
    <>
      {detail.sections.map((s) => {
        const ev = detail.evaluations.find((e) => e.section_id === s.id);
        const evidence = ev ? detail.evidence.filter((x) => x.evaluation_id === ev.id) : [];
        const full = s.evaluation;
        return (
          <Card key={s.id} title={s.name} action={s.status === "completed" ? <AssessmentBadge assessment={ev?.assessment} score={ev?.score} showScore={showScores && s.config.scoring_enabled} /> : <StatusBadge status={s.status} />}>
            <p className="mb-3 text-xs text-muted-foreground"><span className="font-medium">Objective:</span> {s.objective || "—"}</p>
            {!ev ? <p className="text-sm text-muted-foreground">{s.status === "skipped" ? "This section was not reached." : s.evaluation_status === "failed" ? "Evaluation failed — use Regenerate report." : "Not evaluated yet."}</p> : (
              <div className="space-y-4 text-sm">
                <p className="leading-relaxed">{ev.summary}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Strengths</p>
                    {ev.strengths.length ? <ul className="list-disc space-y-0.5 pl-4">{ev.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-muted-foreground">—</p>}
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Concerns</p>
                    {ev.concerns.length ? <ul className="list-disc space-y-0.5 pl-4">{ev.concerns.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-muted-foreground">—</p>}
                  </div>
                </div>
                {full?.criteria && full.criteria.length > 0 && (
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                      <tbody className="divide-y">
                        {full.criteria.map((c, i) => (
                          <tr key={i}><td className="px-3 py-2 font-medium">{c.criterion}</td><td className="px-3 py-2"><AssessmentBadge assessment={c.assessment} /></td><td className="px-3 py-2 text-muted-foreground">{c.note}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {evidence.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</p>
                    <ul className="space-y-2">
                      {evidence.map((e) => (
                        <li key={e.id} className="flex items-start gap-2 rounded-lg bg-muted/50 p-2.5">
                          <WatchButton ms={e.timestamp_start_ms} onClick={() => jump(e.timestamp_start_ms, e.transcript_segment_id)} label="" />
                          <p className="text-sm text-muted-foreground">{e.evidence_text}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}

function QuestionsView({ detail, jump }: { detail: Detail; jump: (ms: number, id?: string | null) => void }) {
  return (
    <>
      {detail.sections.map((s) => {
        const qs = detail.questions.filter((q) => q.section_id === s.id);
        if (!qs.length) return null;
        return (
          <Card key={s.id} title={s.name}>
            <ol className="space-y-4">
              {qs.map((q) => {
                const a = q.analysis as AnswerAnalysis | null;
                const d = q.decision as { action: string; reason: string; overridden?: boolean } | null;
                return (
                  <li key={q.id} className={cn("space-y-2", q.is_followup && "ml-6 border-l-2 pl-4")}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium"><span className={cn("mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", q.is_followup ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-accent text-accent-foreground")}>{q.is_followup ? "Follow-up" : "Question"}</span>{q.question_text}</p>
                      {q.asked_at_ms != null && <WatchButton ms={q.asked_at_ms} onClick={() => jump(q.asked_at_ms!)} label="" />}
                    </div>
                    {q.answer_text ? <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{q.answer_text}</p> : <p className="text-xs text-muted-foreground">No answer recorded.</p>}
                    {a && (
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded bg-muted px-1.5 py-0.5">Relevance: {a.relevance}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5">Completeness: {a.completeness}</span>
                        {a.missing_evidence.length > 0 && <span className="rounded bg-muted px-1.5 py-0.5">Gaps: {a.missing_evidence.join(", ")}</span>}
                      </div>
                    )}
                    {q.is_followup && d && <p className="text-xs text-muted-foreground">Why this follow-up: {d.reason}</p>}
                  </li>
                );
              })}
            </ol>
          </Card>
        );
      })}
      {detail.questions.length === 0 && <Card><p className="text-center text-sm text-muted-foreground">No questions asked yet.</p></Card>}
    </>
  );
}

function NotStarted({ detail, tab }: { detail: Detail; tab: ViewerTab }) {
  const plan = detail.interview_plan;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Status" className="lg:col-span-1">
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Interview</span><StatusBadge status={detail.status} /></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Question plan</span><StatusBadge status={detail.plan_status} label={detail.plan_status === "completed" ? "Ready" : undefined} /></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Invited</span><span>{formatDate(detail.invited_at, true)}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Link expires</span><span>{formatDate(detail.token_expires_at, true)}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Consent</span><span>{detail.consent_given ? "Given" : "Not yet"}</span></div>
          {detail.plan_error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{detail.plan_error}</p>}
        </div>
      </Card>
      <Card title={`Personalized question plan${tab === "questions" ? "" : " (preview)"}`} className="lg:col-span-2">
        {!plan ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">{detail.plan_status === "failed" ? "Plan generation failed — use “Regenerate question plan”." : <><Loader2 className="size-4 animate-spin" /> Generating a plan from the job requirements and resume…</>}</p>
        ) : (
          <div className="space-y-5">
            <p className="text-xs text-muted-foreground">Visible to your team only. The interviewer asks these in order and adds follow-ups when answers leave specific gaps.</p>
            {plan.sections.map((s) => (
              <div key={s.section_id}>
                <p className="text-sm font-semibold">{s.name} <span className="font-normal text-muted-foreground">· {s.duration_minutes} min · up to {s.max_followups} follow-ups/question</span></p>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">{s.questions.map((q) => <li key={q.key}>{q.question}</li>)}</ol>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
