import { ApiError, body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { getHrPanel, HrDetailsSchema, saveHrDetails, visibleHrPanel } from "@/lib/services/candidate-notes";
import { candidateJobsInScope } from "@/lib/auth/job-scope";
import { can } from "@/lib/auth/permissions";

/** HR details and notes for a candidate (the same record on every page). */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("candidate:view");
  const candidateId = uuidParam(id);
  const jobs = await candidateJobsInScope(auth, candidateId);
  if (jobs && !jobs.length) throw new ApiError(404, "Candidate not found");
  return visibleHrPanel(await getHrPanel(auth.orgId, candidateId), can(auth.role, "candidate:salary"), jobs);
});

export const PUT = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("candidate:write");
  await saveHrDetails(auth.orgId, auth.userId, uuidParam(id), await body(req, HrDetailsSchema));
  return { ok: true };
});
