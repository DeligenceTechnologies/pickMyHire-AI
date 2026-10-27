import { z } from "zod";
import { body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { withOrg } from "@/lib/database/db";
import { saveAnswers } from "@/lib/services/application-answers";

/** The candidate's answers to a job's questions, if any. */
export const GET = route<{ id: string; jobId: string }>(async (_req, { id, jobId }) => {
  const auth = await requireApiAuth("candidate:view");
  const [row] = await withOrg(auth.orgId, (tx) => tx<{ answers: unknown }[]>`
    select answers from candidate_job_answers where candidate_id = ${uuidParam(id)} and job_id = ${uuidParam(jobId)} and organization_id = ${auth.orgId}`);
  return { answers: row?.answers ?? null };
});

/** Fill in or correct a candidate's answers (e.g. for a direct invite, from what they told HR). */
export const PUT = route<{ id: string; jobId: string }>(async (req, { id, jobId }) => {
  const auth = await requireApiAuth("candidate:write");
  const { answers } = await body(req, z.object({ answers: z.record(z.string(), z.unknown()) }));
  return saveAnswers(auth.orgId, auth.userId, uuidParam(jobId), uuidParam(id), answers);
});
