import { ApiError, body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { deleteJob, getJob, JobInputSchema, updateJob } from "@/lib/services/jobs";
import { assertJobAccess } from "@/lib/auth/job-scope";
import { can } from "@/lib/auth/permissions";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth();
  const job = await getJob(auth.orgId, uuidParam(id));
  if (!job) throw new ApiError(404, "Job not found");
  await assertJobAccess(auth, job.id);
  // The budget is a salary detail.
  return can(auth.role, "candidate:salary") ? job : { ...job, hiring_limits: null };
});

export const PUT = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("job:write");
  await updateJob(auth.orgId, auth.userId, uuidParam(id), await body(req, JobInputSchema));
  return { ok: true };
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("job:write");
  await deleteJob(auth.orgId, auth.userId, uuidParam(id));
  return { ok: true };
});
