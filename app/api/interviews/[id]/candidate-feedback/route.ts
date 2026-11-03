import { ApiError, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { sendHeldFeedback } from "@/lib/interview/candidate-followup";

/** A recruiter approves AI feedback the safety check held back, and it's emailed to the candidate once. */
export const POST = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("interview:write");
  if (!(await sendHeldFeedback(auth.orgId, auth.userId, uuidParam(id)))) throw new ApiError(409, "This feedback has already been sent.");
  return { ok: true };
}, { rateLimit: { key: "candidate-feedback", limit: 30, windowMs: 60 * 60_000 } });
