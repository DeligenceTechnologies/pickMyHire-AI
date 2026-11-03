import { route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { recordingForViewer } from "@/lib/interview/recording";

/** Short-lived signed URLs; access is authorized and audited. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("recording:view");
  return recordingForViewer(auth.orgId, auth.userId, uuidParam(id));
});
