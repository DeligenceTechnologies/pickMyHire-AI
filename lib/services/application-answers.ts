import "server-only";
// Answers to a job's application questions (one record per candidate per job),
// the job's internal hiring limits, and the fit check. The standard answers
// (CTC, notice period, …) are copied into the candidate's HR details so HR sees
// them in one place. None of this is ever sent to the AI.

import { json, withOrg, type Tx } from "@/lib/database/db";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import {
  answersToHrDetails, computeFit, readForm, readLimits, validateAnswers,
  type Answers, type ApplicationForm, type Fit, type HiringLimits,
} from "@/lib/application-form";

export async function getJobForm(orgId: string, jobId: string) {
  const [j] = await withOrg(orgId, (tx) => tx<{ title: string; application_form: unknown; hiring_limits: unknown }[]>`
    select title, application_form, hiring_limits from jobs where id = ${jobId} and organization_id = ${orgId}`);
  if (!j) throw new ApiError(404, "Job not found");
  return { title: j.title, form: readForm(j.application_form), limits: readLimits(j.hiring_limits) };
}

/** Validate answers against the job's questions; throws a 400 listing each problem. */
export function checkAnswers(form: ApplicationForm, raw: unknown) {
  const { answers, errors } = validateAnswers(form, (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>);
  if (Object.keys(errors).length) {
    throw new ApiError(400, "Please answer the required questions in the right format.", "invalid_answers",
      Object.entries(errors).map(([path, message]) => ({ path: `answers.${path}`, message })));
  }
  return answers;
}

/** Save answers and copy the standard ones into the candidate's HR details (only fields that were answered). */
export async function saveAnswersTx(tx: Tx, orgId: string, input: { jobId: string; candidateId: string; form: ApplicationForm; answers: Answers; answeredBy: string | null }) {
  await tx`
    insert into candidate_job_answers (organization_id, job_id, candidate_id, answers, answered_by)
    values (${orgId}, ${input.jobId}, ${input.candidateId}, ${json(input.answers)}, ${input.answeredBy})
    on conflict (job_id, candidate_id) do update set answers = excluded.answers, answered_by = excluded.answered_by`;
  const hr = answersToHrDetails(input.form, input.answers);
  const given = Object.entries(hr).filter(([, v]) => v != null);
  if (!given.length) return;
  await tx`insert into candidate_hr_details (candidate_id, organization_id, updated_by) values (${input.candidateId}, ${orgId}, ${input.answeredBy})
    on conflict (candidate_id) do nothing`;
  for (const [field, value] of given) {
    // Field names come from answersToHrDetails, never from input.
    await tx`update candidate_hr_details set ${tx(field)} = ${value as string}, updated_by = ${input.answeredBy} where candidate_id = ${input.candidateId}`;
  }
}

/** A recruiter fills in (or corrects) a candidate's answers for a job. */
export async function saveAnswers(orgId: string, userId: string, jobId: string, candidateId: string, raw: unknown) {
  const { form } = await getJobForm(orgId, jobId);
  const answers = checkAnswers(form, raw);
  await withOrg(orgId, async (tx) => {
    const [c] = await tx`select 1 from candidates where id = ${candidateId} and organization_id = ${orgId}`;
    if (!c) throw new ApiError(404, "Candidate not found");
    await saveAnswersTx(tx, orgId, { jobId, candidateId, form, answers, answeredBy: userId });
    // Values aren't copied into the audit log: salary details stay in one place.
    await audit(tx, { orgId, userId, action: "candidate.answers_updated", entityType: "candidate", entityId: candidateId, metadata: { job_id: jobId } });
  });
  return { answers };
}

export type JobAnswers = {
  job_id: string; job_title: string; form: ApplicationForm; limits: HiringLimits; answers: Answers;
  answered_by_name: string | null; updated_at: Date; fit: Fit;
};

/** A candidate's answers for every job they answered, with the fit check. */
export async function answersForCandidate(orgId: string, candidateId: string): Promise<JobAnswers[]> {
  const rows = await withOrg(orgId, (tx) => tx<{ job_id: string; job_title: string; application_form: unknown; hiring_limits: unknown; answers: Answers; answered_by_name: string | null; updated_at: Date }[]>`
    select a.job_id, j.title as job_title, j.application_form, j.hiring_limits, a.answers, u.name as answered_by_name, a.updated_at
    from candidate_job_answers a join jobs j on j.id = a.job_id left join users u on u.id = a.answered_by
    where a.candidate_id = ${candidateId} and a.organization_id = ${orgId} order by a.updated_at desc`);
  return rows.map((r) => {
    const form = readForm(r.application_form); const limits = readLimits(r.hiring_limits);
    return { job_id: r.job_id, job_title: r.job_title, form, limits, answers: r.answers, answered_by_name: r.answered_by_name, updated_at: r.updated_at, fit: computeFit(form, limits, r.answers) };
  });
}

/** Fit check for every candidate who answered a job's questions (for the applications list). */
export async function fitForJob(orgId: string, jobId: string) {
  const { form, limits } = await getJobForm(orgId, jobId);
  const rows = await withOrg(orgId, (tx) => tx<{ candidate_id: string; answers: Answers }[]>`
    select candidate_id, answers from candidate_job_answers where job_id = ${jobId} and organization_id = ${orgId}`);
  return new Map(rows.map((r) => [r.candidate_id, computeFit(form, limits, r.answers)]));
}
