import { ApiError, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { assertInterviewAccess } from "@/lib/auth/job-scope";
import { runInBackground } from "@/lib/background";
import { withOrg } from "@/lib/database/db";
import { processInterview } from "@/lib/interview/processing";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("report:view");
  await assertInterviewAccess(auth, uuidParam(id));
  const [row] = await withOrg(auth.orgId, (tx) => tx`
    select r.status, r.summary, r.report_json, r.error, r.generated_at, i.status as interview_status, i.processing_error
    from interviews i left join interview_reports r on r.interview_id = i.id
    where i.id = ${uuidParam(id)} and i.organization_id = ${auth.orgId}`);
  if (!row) throw new ApiError(404, "Interview not found");
  return row;
});

/** Retry evaluation + report generation (idempotent). */
export const POST = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("report:regenerate");
  const interviewId = uuidParam(id);
  const [row] = await withOrg(auth.orgId, (tx) => tx<{ status: string }[]>`select status from interviews where id = ${interviewId} and organization_id = ${auth.orgId}`);
  if (!row) throw new ApiError(404, "Interview not found");
  if (!["completing", "completed", "report_ready", "failed", "processing"].includes(row.status)) throw new ApiError(409, "The interview hasn't finished yet.");
  runInBackground("interview.reprocess", () => processInterview(auth.orgId, interviewId));
  return { ok: true };
}, { rateLimit: { key: "report-retry", limit: 20, windowMs: 60 * 60_000 } });
