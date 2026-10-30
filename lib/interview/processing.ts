import "server-only";
// Post-interview pipeline: finalize recording → evaluate sections → report.
// Every step is idempotent and records its status so it can be retried.

import { json, withOrg } from "@/lib/database/db";
import { audit, notify } from "@/lib/audit";
import { evaluateSection, EVALUATOR_VERSION, type EvalSegment } from "@/lib/ai/section-evaluator";
import { generateReport, REPORT_VERSION } from "@/lib/ai/report-generator";
import { log } from "@/lib/logger";
import { assessmentScore, type Assessment, type FinalReport, type SectionEvaluation } from "@/lib/validation/ai-schemas";
import { runInBackground } from "@/lib/background";
import { finalizeAllParts } from "./recording";
import { sendCandidateFollowup } from "./candidate-followup";

type SegmentRow = { id: string; section_id: string | null; speaker: string; text: string; start_time_ms: number; end_time_ms: number };

async function loadSegments(orgId: string, interviewId: string) {
  const rows = await withOrg(orgId, (tx) => tx<SegmentRow[]>`
    select id, section_id, speaker::text, text, start_time_ms, end_time_ms from transcript_segments
    where interview_id = ${interviewId} order by start_time_ms, sequence_number`);
  // Stable interview-wide refs (S1, S2, ...) shared by evaluations and the report.
  return rows.map((r, i) => ({ ...r, ref: `S${i + 1}` }));
}

function toEvalSegments(rows: (SegmentRow & { ref: string })[]): EvalSegment[] {
  return rows.map((r) => ({ ref: r.ref, speaker: r.speaker, text: r.text, start: r.start_time_ms, end: r.end_time_ms }));
}

export async function evaluateInterviewSection(orgId: string, interviewId: string, sectionId: string) {
  const [ctx] = await withOrg(orgId, (tx) => tx<{ name: string; objective: string; config: { evaluation_criteria?: string[]; scoring_enabled?: boolean }; job_title: string; status: string }[]>`
    select s.name, s.objective, s.config, j.title as job_title, s.status from interview_sections s
    join interviews i on i.id = s.interview_id join jobs j on j.id = i.job_id
    where s.id = ${sectionId} and s.interview_id = ${interviewId}`);
  if (!ctx) return;
  await withOrg(orgId, (tx) => tx`update interview_sections set evaluation_status = 'processing' where id = ${sectionId}`);

  const all = await loadSegments(orgId, interviewId);
  const segments = all.filter((s) => s.section_id === sectionId);
  try {
    const { evaluation, source } = await evaluateSection({
      orgId,
      jobTitle: ctx.job_title,
      sectionName: ctx.name,
      objective: ctx.objective,
      criteria: ctx.config.evaluation_criteria ?? [],
      segments: toEvalSegments(segments),
    });
    const byRef = new Map(all.map((s) => [s.ref, s]));
    const score = ctx.config.scoring_enabled ? assessmentScore[evaluation.assessment] : null;

    await withOrg(orgId, async (tx) => {
      await tx`delete from section_evaluations where section_id = ${sectionId}`;
      const [ev] = await tx<{ id: string }[]>`
        insert into section_evaluations (organization_id, interview_id, section_id, assessment, score, summary, strengths, concerns, prompt_version)
        values (${orgId}, ${interviewId}, ${sectionId}, ${evaluation.assessment}, ${score}, ${evaluation.summary},
          ${json(evaluation.strengths)}, ${json(evaluation.concerns)}, ${source === "openai" ? EVALUATOR_VERSION : "demo-heuristic"})
        returning id`;
      for (const e of evaluation.evidence) {
        // Prefer the real segment's timestamps over model-reported ones.
        const seg = e.segment_ref ? byRef.get(e.segment_ref) : undefined;
        await tx`insert into evaluation_evidence (organization_id, evaluation_id, transcript_segment_id, timestamp_start_ms, timestamp_end_ms, evidence_text)
          values (${orgId}, ${ev.id}, ${seg?.id ?? null}, ${seg?.start_time_ms ?? Math.max(0, e.timestamp_start_ms)},
            ${seg?.end_time_ms ?? Math.max(0, e.timestamp_end_ms)}, ${`${e.quote_or_paraphrase}${e.supports ? ` — ${e.supports}` : ""}`})`;
      }
      await tx`update interview_sections set evaluation = ${json({ ...evaluation, source })}, summary = ${evaluation.summary},
        evaluation_status = 'completed' where id = ${sectionId}`;
      await audit(tx, { orgId, actorType: "system", action: "interview.evaluation_generated", entityType: "interview_section", entityId: sectionId, metadata: { source } });
    });
  } catch (err) {
    log.warn("evaluation.failed", { interviewId, sectionId, err });
    await withOrg(orgId, (tx) => tx`update interview_sections set evaluation_status = 'failed' where id = ${sectionId}`);
    throw err;
  }
}

export type StoredReport = {
  version: 1;
  generated_by: "openai" | "mock";
  prompt_version: string;
  final: FinalReport;
  sections: {
    section_id: string;
    name: string;
    objective: string;
    status: string;
    assessment: Assessment | null;
    score: number | null;
    summary: string | null;
  }[];
  refs: Record<string, { segment_id: string; start_ms: number; end_ms: number }>;
};

export async function generateInterviewReport(orgId: string, interviewId: string) {
  const data = await withOrg(orgId, async (tx) => {
    await tx`insert into interview_reports (organization_id, interview_id, status) values (${orgId}, ${interviewId}, 'processing')
      on conflict (interview_id) do update set status = 'processing', error = null, attempts = interview_reports.attempts + 1`;
    const [iv] = await tx<{ job_title: string; parsed_requirements: unknown; interview_plan: unknown }[]>`
      select j.title as job_title, j.parsed_requirements, i.interview_plan from interviews i join jobs j on j.id = i.job_id where i.id = ${interviewId}`;
    const sections = await tx<{ id: string; name: string; objective: string; status: string; evaluation: (SectionEvaluation & { source?: string }) | null }[]>`
      select id, name, objective, status, evaluation from interview_sections where interview_id = ${interviewId} order by sort_order`;
    const evals = await tx<{ section_id: string; assessment: Assessment; score: number | null }[]>`
      select section_id, assessment, score from section_evaluations where interview_id = ${interviewId}`;
    return { iv, sections, evals };
  });
  const all = await loadSegments(orgId, interviewId);

  const evaluated = data.sections.filter((s) => s.evaluation);
  const { report, source } = await generateReport({
    orgId,
    jobTitle: data.iv.job_title,
    requirements: data.iv.parsed_requirements,
    sections: evaluated.map((s) => ({
      name: s.name,
      objective: s.objective,
      assessment: s.evaluation!.assessment,
      summary: s.evaluation!.summary,
      strengths: s.evaluation!.strengths,
      concerns: s.evaluation!.concerns,
      evidence: s.evaluation!.evidence,
    })),
  });

  const refs: StoredReport["refs"] = {};
  for (const s of all) refs[s.ref] = { segment_id: s.id, start_ms: s.start_time_ms, end_ms: s.end_time_ms };
  // Correct any model-reported timestamps using the real segment refs.
  report.key_evidence = report.key_evidence.map((e) => {
    const r = e.segment_ref ? refs[e.segment_ref] : undefined;
    return r ? { ...e, timestamp_start_ms: r.start_ms, timestamp_end_ms: r.end_ms } : e;
  });

  const stored: StoredReport = {
    version: 1,
    generated_by: source,
    prompt_version: source === "openai" ? REPORT_VERSION : "demo-heuristic",
    final: report,
    sections: data.sections.map((s) => {
      const ev = data.evals.find((e) => e.section_id === s.id);
      return { section_id: s.id, name: s.name, objective: s.objective, status: s.status, assessment: ev?.assessment ?? null, score: ev?.score ?? null, summary: s.evaluation?.summary ?? null };
    }),
    refs,
  };

  await withOrg(orgId, async (tx) => {
    await tx`update interview_reports set status = 'completed', summary = ${report.summary}, report_json = ${json(stored)}, generated_at = now(), error = null
      where interview_id = ${interviewId}`;
    await tx`update interviews set status = 'report_ready', processing_error = null where id = ${interviewId}`;
    await audit(tx, { orgId, actorType: "system", action: "interview.report_generated", entityType: "interview", entityId: interviewId, metadata: { source } });
    const [info] = await tx<{ candidate: string; job: string }[]>`select c.name as candidate, j.title as job from interviews i
      join candidates c on c.id = i.candidate_id join jobs j on j.id = i.job_id where i.id = ${interviewId}`;
    await notify(tx, { orgId, type: "report.ready", payload: { interview_id: interviewId, candidate: info.candidate, job: info.job } });
  });
}

/** Full pipeline. Section failures don't block the report; the report notes missing evaluations. */
export async function processInterview(orgId: string, interviewId: string) {
  // An interview left in "completing" (candidate closed the tab after the closing
  // line, or the final save never finished) is closed out here so it can be reviewed.
  await withOrg(orgId, async (tx) => {
    const [iv] = await tx<{ status: string }[]>`select status from interviews where id = ${interviewId} for update`;
    if (iv?.status !== "completing") return;
    const [{ last_ms }] = await tx<{ last_ms: number | null }[]>`select max(end_time_ms) as last_ms from transcript_segments where interview_id = ${interviewId}`;
    await tx`update interviews set status = 'completed', completed_at = coalesce(completed_at, now()),
      duration_seconds = coalesce(duration_seconds, ${last_ms != null ? Math.round(last_ms / 1000) : null}) where id = ${interviewId}`;
    await tx`update interview_sections set status = 'completed', completed_at = coalesce(completed_at, now()),
      end_ms = coalesce(end_ms, ${last_ms}) where interview_id = ${interviewId} and status = 'in_progress'`;
    await tx`update interview_sections set status = 'skipped' where interview_id = ${interviewId} and status = 'pending'`;
    await audit(tx, { orgId, actorType: "system", action: "interview.completed", entityType: "interview", entityId: interviewId, metadata: { reason: "closed_by_processing" } });
  });
  await withOrg(orgId, (tx) => tx`update interviews set status = 'processing', processing_error = null where id = ${interviewId} and status in ('completed','failed','report_ready')`);
  await finalizeAllParts(orgId, interviewId);
  const sections = await withOrg(orgId, (tx) => tx<{ id: string; evaluation_status: string | null }[]>`
    select id, evaluation_status from interview_sections where interview_id = ${interviewId} and status = 'completed' order by sort_order`);
  let failures = 0;
  for (const s of sections) {
    if (s.evaluation_status === "completed") continue;
    try {
      await evaluateInterviewSection(orgId, interviewId, s.id);
    } catch {
      failures++;
    }
  }
  try {
    await generateInterviewReport(orgId, interviewId);
    if (failures) {
      await withOrg(orgId, (tx) => tx`update interviews set processing_error = ${`${failures} section evaluation(s) failed — retry to complete the report.`} where id = ${interviewId}`);
    }
  } catch (err) {
    log.error("report.failed", { interviewId, err });
    await withOrg(orgId, async (tx) => {
      await tx`update interview_reports set status = 'failed', error = ${"We couldn't generate the report yet. The interview data is safe."} where interview_id = ${interviewId}`;
      await tx`update interviews set status = 'completed', processing_error = ${"Report generation failed. The interview data is safe — retry."} where id = ${interviewId}`;
    });
  }
  // The candidate's confirmation (with AI feedback when the report allows it). Sent once.
  await sendCandidateFollowup(orgId, interviewId);
}

/**
 * A candidate who leaves after the closing line (or whose final save failed)
 * leaves the interview in "completing". After 10 minutes, close it out and
 * generate the report without waiting for a manual retry.
 */
export function recoverIfStale(orgId: string, interview: { id: string; status: string; updated_at: Date }) {
  if (interview.status !== "completing" || Date.now() - interview.updated_at.getTime() < 10 * 60_000) return;
  runInBackground("interview.recover", () => processInterview(orgId, interview.id));
}
