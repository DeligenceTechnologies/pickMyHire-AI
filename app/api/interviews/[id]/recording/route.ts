import { route, uuidParam } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/session";
import { assertInterviewAccess } from "@/lib/auth/job-scope";
import { withOrg } from "@/lib/database/db";
import { recordingUrls } from "@/lib/interview/recording";

/** Short-lived signed URLs; access is authorized and audited. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("recording:view");
  await assertInterviewAccess(auth, uuidParam(id));
  const interviewId = uuidParam(id);
  const all = await recordingUrls(auth.orgId, interviewId);
  await withOrg(auth.orgId, (tx) => audit(tx, { orgId: auth.orgId, userId: auth.userId, action: "interview.recording_accessed", entityType: "interview", entityId: interviewId }));
  // `parts`: the candidate's video; `voice`: the interviewer's voice, played in sync.
  return { parts: all.filter((p) => p.track === "candidate"), voice: all.filter((p) => p.track === "interviewer") };
});
