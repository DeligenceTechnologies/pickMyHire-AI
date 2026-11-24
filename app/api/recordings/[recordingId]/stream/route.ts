import { ApiError, route, uuidParam } from "@/lib/api";
import { can } from "@/lib/auth/permissions";
import { assertInterviewAccess } from "@/lib/auth/job-scope";
import { withOrg } from "@/lib/database/db";
import { requireApiAuth } from "@/lib/auth/session";
import { streamRecording } from "@/lib/interview/recording";

/** Streams a recording to authorized recruiters (session cookie + recording:view). */
export const GET = route<{ recordingId: string }>(async (req, { recordingId }) => {
  const auth = await requireApiAuth("recording:view");
  if (!can(auth.role, "job:all")) {
    const [r] = await withOrg(auth.orgId, (tx) => tx<{ interview_id: string }[]>`
      select interview_id from recordings where id = ${uuidParam(recordingId)} and organization_id = ${auth.orgId}`);
    if (!r) throw new ApiError(404, "Recording not found");
    await assertInterviewAccess(auth, r.interview_id);
  }
  return streamRecording(auth.orgId, uuidParam(recordingId), req.headers.get("range"));
});
