import { route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { assertInterviewAccess } from "@/lib/auth/job-scope";
import { getTranscript } from "@/lib/services/interviews";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("interview:view");
  await assertInterviewAccess(auth, uuidParam(id));
  return { segments: await getTranscript(auth.orgId, uuidParam(id)) };
});
