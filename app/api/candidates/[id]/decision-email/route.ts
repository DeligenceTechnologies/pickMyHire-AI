import { ApiError, body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { getDecisionEmailDraft, sendDecisionEmail, SendDecisionEmailSchema } from "@/lib/services/decision-email";

const UUID = /^[0-9a-f-]{36}$/i;

/** The decision email's preview: who it goes to, the default text, and whether it was already sent. */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("candidate:write");
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind");
  if (kind !== "rejected" && kind !== "shortlisted") throw new ApiError(400, "Unknown decision.");
  const jobs = sp.get("jobs")?.split(",").filter(Boolean) ?? null;
  if (jobs && (!jobs.length || jobs.length > 20 || !jobs.every((j) => UUID.test(j)))) throw new ApiError(400, "Unknown job.");
  return getDecisionEmailDraft(auth.orgId, uuidParam(id), kind, jobs);
});

/** Send it, after the decision is saved. Only ever on the recruiter's request, and once per decision. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("candidate:write");
  return sendDecisionEmail(auth.orgId, auth.userId, uuidParam(id), await body(req, SendDecisionEmailSchema));
}, { rateLimit: { key: "decision-email", limit: 200, windowMs: 60 * 60_000 } });
