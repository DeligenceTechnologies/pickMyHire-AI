import "server-only";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { json, withOrg, type Tx } from "@/lib/database/db";
import type { Decision, Stage } from "@/lib/hiring";
import { syncAutoArchive } from "./candidate-archive";

// A candidate's progress in a job: each round (AI or human interview) is
// marked Qualified / Not qualified / On hold by the team, and the overall
// outcome moves In progress → Shortlisted → Hired (or Rejected / Withdrawn).
// The AI report is advice only; people make every decision here.

/** Add a candidate to a job's pipeline (first invite or schedule). */
export async function ensurePipeline(tx: Tx, orgId: string, jobId: string, candidateId: string) {
  await tx`insert into job_candidates (organization_id, job_id, candidate_id) values (${orgId}, ${jobId}, ${candidateId})
    on conflict (job_id, candidate_id) do nothing`;
}

/** The stage note used when a declined application puts the candidate in Rejected (so reopening can undo it). */
export const DECLINED_NOTE = "Application declined";

/**
 * Move a candidate to Rejected for a job, inside the caller's transaction. Used when a round is marked
 * Not qualified (if the team ticks the option) and when an application is declined. Hired and withdrawn
 * candidates are left as they are. Returns whether the stage changed.
 */
export async function rejectInJob(tx: Tx, orgId: string, userId: string, jobId: string, candidateId: string, note: string, via: string): Promise<boolean> {
  await ensurePipeline(tx, orgId, jobId, candidateId);
  const [row] = await tx<{ stage: string }[]>`
    update job_candidates set stage = 'rejected', stage_note = ${note.slice(0, 1000)}, stage_changed_by = ${userId}, stage_changed_at = now()
    where job_id = ${jobId} and candidate_id = ${candidateId} and organization_id = ${orgId} and stage in ('in_progress', 'shortlisted') returning stage`;
  if (!row) return false;
  await audit(tx, { orgId, userId, action: "candidate.stage_changed", entityType: "candidate", entityId: candidateId, metadata: { job_id: jobId, stage: "rejected", note: note.slice(0, 300), via } });
  await syncAutoArchive(tx, orgId, candidateId, userId);
  return true;
}

/**
 * Undo the Rejected stage that declining an application set (the application was reopened, or the applicant
 * invited after all). A candidate with no interviews for the job leaves the pipeline again; otherwise they go
 * back to In progress. A stage the team changed since then is left alone.
 */
export async function undoDeclinedReject(tx: Tx, orgId: string, userId: string, jobId: string, candidateId: string) {
  const [row] = await tx<{ stage: string; stage_note: string | null; rounds: number }[]>`
    select jc.stage, jc.stage_note,
      (select count(*) from interviews i where i.job_id = jc.job_id and i.candidate_id = jc.candidate_id)::int
        + (select count(*) from human_interviews h where h.job_id = jc.job_id and h.candidate_id = jc.candidate_id)::int as rounds
    from job_candidates jc where jc.job_id = ${jobId} and jc.candidate_id = ${candidateId} and jc.organization_id = ${orgId}`;
  if (!row || row.stage !== "rejected" || row.stage_note !== DECLINED_NOTE) return;
  if (row.rounds === 0) {
    await tx`delete from job_candidates where job_id = ${jobId} and candidate_id = ${candidateId} and organization_id = ${orgId}`;
  } else {
    await tx`update job_candidates set stage = 'in_progress', stage_note = null, stage_changed_by = ${userId}, stage_changed_at = now()
      where job_id = ${jobId} and candidate_id = ${candidateId} and organization_id = ${orgId}`;
  }
  await audit(tx, { orgId, userId, action: "candidate.stage_changed", entityType: "candidate", entityId: candidateId, metadata: { job_id: jobId, stage: "in_progress", via: "application_reopened" } });
  await syncAutoArchive(tx, orgId, candidateId, userId);
}

export type RoundEntry = {
  kind: "ai" | "human"; id: string; job_id: string; candidate_id: string; round_id: string | null; round_name: string; attempt: number;
  status: string; created_at: Date; at: Date | null; timezone: string | null;
  decision: Decision | null; decision_note: string | null; decided_at: Date | null; decided_by_name: string | null;
};
export type PipelineRound = { id: string; job_id: string; name: string; kind: "ai" | "human"; sort_order: number };
/** Where a candidate stands in one round: the latest decision, or what's happening. */
export type RoundResult = { round: PipelineRound; decision: Decision | null; state: "none" | "waiting" | "done"; entry: RoundEntry | null };

const AI_DONE = ["completed", "processing", "report_ready"];

export function entriesSql(tx: Tx, where: ReturnType<Tx>) {
  return tx<RoundEntry[]>`
    select * from (
      select 'ai' as kind, i.id, i.job_id, i.candidate_id, i.round_id, coalesce(i.round_name, 'Interview') as round_name, i.attempt,
        i.status::text as status, i.created_at, i.completed_at as at, null::text as timezone,
        i.decision, i.decision_note, i.decided_at, u.name as decided_by_name
      from interviews i left join users u on u.id = i.decided_by
      union all
      select 'human', h.id, h.job_id, h.candidate_id, h.round_id, h.round_name, h.attempt,
        h.status, h.created_at, h.scheduled_at, h.timezone,
        h.decision, h.decision_note, h.decided_at, u.name
      from human_interviews h left join users u on u.id = h.decided_by
    ) e where ${where}
    order by e.created_at`;
}

/** The latest decision in a round wins (a retake replaces an earlier result). */
export function roundResults(rounds: PipelineRound[], entries: RoundEntry[]): RoundResult[] {
  return rounds.map((round) => {
    const mine = entries.filter((e) => e.round_id === round.id && e.status !== "cancelled" && e.status !== "expired");
    const decided = mine.filter((e) => e.decision).sort((a, b) => b.decided_at!.getTime() - a.decided_at!.getTime())[0];
    const latest = mine[mine.length - 1] ?? null;
    if (decided) return { round, decision: decided.decision, state: "done", entry: decided };
    if (!latest) return { round, decision: null, state: "none", entry: null };
    const done = latest.kind === "ai" ? AI_DONE.includes(latest.status) : latest.status === "completed" || latest.status === "no_show";
    return { round, decision: null, state: done ? "done" : "waiting", entry: latest };
  });
}

export const allQualified = (results: RoundResult[]) => results.length > 0 && results.every((r) => r.decision === "qualified");

/** Identifies the set of round decisions an overall summary is built from (changes when any is redone). */
export const summaryFingerprint = (results: RoundResult[]) =>
  results.map((r) => `${r.round.id}:${r.entry?.id ?? "-"}:${r.entry?.decided_at?.toISOString() ?? "-"}`).join("|");

export type CandidatePipeline = {
  job_id: string; job_title: string; job_status: string; stage: Stage; stage_note: string | null; stage_changed_at: Date | null; stage_by: string | null;
  results: RoundResult[]; extras: RoundEntry[]; entries: RoundEntry[]; allQualified: boolean;
};

/** Every job a candidate is in, with round-by-round results. */
export async function getCandidatePipelines(orgId: string, candidateId: string): Promise<CandidatePipeline[]> {
  return withOrg(orgId, async (tx) => {
    const jobs = await tx<{ job_id: string; job_title: string; job_status: string; stage: Stage; stage_note: string | null; stage_changed_at: Date | null; stage_by: string | null }[]>`
      select jc.job_id, j.title as job_title, j.status::text as job_status, jc.stage, jc.stage_note, jc.stage_changed_at, u.name as stage_by
      from job_candidates jc join jobs j on j.id = jc.job_id left join users u on u.id = jc.stage_changed_by
      where jc.candidate_id = ${candidateId} and jc.organization_id = ${orgId}
      order by jc.created_at desc`;
    if (!jobs.length) return [];
    const ids = jobs.map((j) => j.job_id);
    const rounds = await tx<PipelineRound[]>`select id, job_id, name, kind, sort_order from job_rounds where job_id = any(${ids}) order by sort_order, created_at`;
    const entries = await entriesSql(tx, tx`e.candidate_id = ${candidateId} and e.job_id = any(${ids})`);
    return jobs.map((j) => {
      const mine = entries.filter((e) => e.job_id === j.job_id);
      const results = roundResults(rounds.filter((r) => r.job_id === j.job_id), mine);
      const roundIds = new Set(results.map((r) => r.round.id));
      return { ...j, results, entries: mine, extras: mine.filter((e) => !e.round_id || !roundIds.has(e.round_id)), allQualified: allQualified(results) };
    });
  });
}

export type JobPipelineRow = { candidate_id: string; name: string; email: string; stage: Stage; stage_note: string | null; stage_changed_at: Date | null; results: RoundResult[]; allQualified: boolean };

/** All candidates in a job with their round results, for the job's pipeline view. */
export async function getJobPipeline(orgId: string, jobId: string) {
  return withOrg(orgId, async (tx) => {
    const people = await tx<{ candidate_id: string; name: string; email: string; stage: Stage; stage_note: string | null; stage_changed_at: Date | null }[]>`
      select jc.candidate_id, c.name, c.email, jc.stage, jc.stage_note, jc.stage_changed_at
      from job_candidates jc join candidates c on c.id = jc.candidate_id
      where jc.job_id = ${jobId} and jc.organization_id = ${orgId}
      order by coalesce(jc.stage_changed_at, jc.created_at) desc`;
    const rounds = await tx<PipelineRound[]>`select id, job_id, name, kind, sort_order from job_rounds where job_id = ${jobId} order by sort_order, created_at`;
    const entries = await entriesSql(tx, tx`e.job_id = ${jobId}`);
    const rows: JobPipelineRow[] = people.map((p) => {
      const results = roundResults(rounds, entries.filter((e) => e.candidate_id === p.candidate_id));
      return { ...p, results, allQualified: allQualified(results) };
    });
    return { rounds, rows };
  });
}

/** Mark one interview (AI or human) Qualified / Not qualified / On hold, or clear it. */
/**
 * Mark one interview (AI or human) Qualified / Not qualified / On hold, or clear
 * it. Clearing a decision reopens the round (and unlocks human scorecards), so
 * it needs a reason, recorded in the history and audit log.
 */
export async function setRoundDecision(orgId: string, userId: string, input: {
  kind: "ai" | "human"; id: string; decision: Decision | null; note?: string | null;
  /** With Not qualified: also move the candidate to Rejected for the job. */
  reject?: boolean;
}) {
  const note = input.decision ? input.note?.trim() || null : null;
  const reason = input.decision ? null : input.note?.trim() || null;
  return withOrg(orgId, async (tx) => {
    const [before] = input.kind === "ai"
      ? await tx<{ decision: Decision | null }[]>`select decision from interviews where id = ${input.id} and organization_id = ${orgId} for update`
      : await tx<{ decision: Decision | null }[]>`select decision from human_interviews where id = ${input.id} and organization_id = ${orgId} for update`;
    if (!before) throw new ApiError(404, "Interview not found");
    if (!input.decision && before.decision && !reason) throw new ApiError(400, "Add a reason for reopening this round.", "needs_reason");
    const [row] = input.kind === "ai"
      ? await tx<{ id: string; job_id: string; candidate_id: string; round_name: string | null }[]>`
          update interviews set decision = ${input.decision}, decision_note = ${note}, decided_by = ${input.decision ? userId : null}, decided_at = ${input.decision ? new Date() : null}
          where id = ${input.id} and organization_id = ${orgId} returning id, job_id, candidate_id, round_name`
      : await tx<{ id: string; job_id: string; candidate_id: string; round_name: string | null }[]>`
          update human_interviews set decision = ${input.decision}, decision_note = ${note}, decided_by = ${input.decision ? userId : null}, decided_at = ${input.decision ? new Date() : null}
          where id = ${input.id} and organization_id = ${orgId} returning id, job_id, candidate_id, round_name`;
    if (!row) throw new ApiError(404, "Interview not found");
    await ensurePipeline(tx, orgId, row.job_id, row.candidate_id);
    if (input.kind === "human" && before.decision !== input.decision) {
      const item = input.decision
        ? { type: "decided", at: new Date().toISOString(), by: userId, decision: input.decision }
        : { type: "decision_cleared", at: new Date().toISOString(), by: userId, decision: before.decision, reason: reason!.slice(0, 300) };
      await tx`update human_interviews set history = history || ${json([item])} where id = ${input.id}`;
    }
    await audit(tx, {
      orgId, userId, action: "interview.decision", entityType: input.kind === "ai" ? "interview" : "human_interview", entityId: input.id,
      metadata: { decision: input.decision, previous: before.decision, ...(note ? { note: note.slice(0, 300) } : {}), ...(reason ? { reason: reason.slice(0, 300) } : {}) },
    });
    const rejected = input.decision === "not_qualified" && !!input.reject
      && await rejectInJob(tx, orgId, userId, row.job_id, row.candidate_id, `Not qualified in ${row.round_name ?? "a round"}${note ? `: ${note}` : ""}`, "round_not_qualified");
    return { jobId: row.job_id, candidateId: row.candidate_id, rejected };
  });
}

/** Move a candidate to a new stage for a job. Shortlisting before every round is qualified needs a reason. */
export async function setStage(orgId: string, userId: string, input: { jobId: string; candidateId: string; stage: Stage; note?: string | null }) {
  const note = input.note?.trim() || null;
  if (input.stage === "shortlisted" && !note) {
    const [p] = (await getCandidatePipelines(orgId, input.candidateId)).filter((x) => x.job_id === input.jobId);
    if (!p?.allQualified) throw new ApiError(400, "Not every round is marked Qualified yet. Add a short reason to shortlist anyway.", "needs_reason");
  }
  await withOrg(orgId, async (tx) => {
    await ensurePipeline(tx, orgId, input.jobId, input.candidateId);
    const [row] = await tx<{ stage: string }[]>`
      update job_candidates set stage = ${input.stage}, stage_note = ${note}, stage_changed_by = ${userId}, stage_changed_at = now()
      where job_id = ${input.jobId} and candidate_id = ${input.candidateId} and organization_id = ${orgId} returning stage`;
    if (!row) throw new ApiError(404, "Candidate not found for this job");
    await audit(tx, {
      orgId, userId, action: "candidate.stage_changed", entityType: "candidate", entityId: input.candidateId,
      metadata: { job_id: input.jobId, stage: input.stage, ...(note ? { note: note.slice(0, 300) } : {}) },
    });
    await syncAutoArchive(tx, orgId, input.candidateId, userId);
  });
}
