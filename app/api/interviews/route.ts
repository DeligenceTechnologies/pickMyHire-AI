import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { runInBackground } from "@/lib/background";
import { getMatch, matchCandidate } from "@/lib/services/candidate-match";
import { createInterview, listInterviews } from "@/lib/services/interviews";
import { RoundChoiceSchema } from "@/lib/validation/rounds";
import { jobScope } from "@/lib/auth/job-scope";

export const GET = route(async (req) => {
  const auth = await requireApiAuth("interview:view");
  const sp = req.nextUrl.searchParams;
  return listInterviews(auth.orgId, {
    jobIds: await jobScope(auth),
    q: sp.get("q") ?? undefined,
    status: sp.get("status") ?? undefined,
    jobId: sp.get("jobId") ?? undefined,
    page: Number(sp.get("page") ?? 1),
  });
});

const Schema = RoundChoiceSchema.extend({
  jobId: z.string().uuid(),
  candidateId: z.string().uuid(),
  sendInvite: z.boolean().default(true),
});

export const POST = route(async (req) => {
  const auth = await requireApiAuth("interview:write");
  const input = await body(req, Schema);
  const result = await createInterview(auth.orgId, auth.userId, input);
  // A candidate invited without applying gets the same resume-vs-job check as applicants (shown on the Candidates page).
  runInBackground("candidate.match", async () => {
    if (!(await getMatch(auth.orgId, input.candidateId, input.jobId))) await matchCandidate(auth.orgId, input.candidateId, input.jobId);
  });
  return result;
}, { rateLimit: { key: "interview-create", limit: 120, windowMs: 60 * 60_000 } });
