import { ApiError, body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { CandidateInputSchema, deleteCandidate, getCandidate, updateCandidate } from "@/lib/services/candidates";
import { assertCandidateAccess } from "@/lib/auth/job-scope";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("candidate:view");
  await assertCandidateAccess(auth, uuidParam(id));
  const c = await getCandidate(auth.orgId, uuidParam(id));
  if (!c) throw new ApiError(404, "Candidate not found");
  return c;
});

export const PUT = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("candidate:write");
  await updateCandidate(auth.orgId, auth.userId, uuidParam(id), await body(req, CandidateInputSchema));
  return { ok: true };
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("data:delete");
  await deleteCandidate(auth.orgId, auth.userId, uuidParam(id));
  return { ok: true };
});
