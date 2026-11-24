import { z } from "zod";
import { ApiError, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { assertInterviewAccess } from "@/lib/auth/job-scope";
import { getInterviewDetail } from "@/lib/services/interviews";
import { deleteInterviewData } from "@/lib/services/workspace";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("interview:view");
  await assertInterviewAccess(auth, uuidParam(id));
  const detail = await getInterviewDetail(auth.orgId, uuidParam(id));
  if (!detail) throw new ApiError(404, "Interview not found");
  return detail;
});

export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("data:delete");
  const what = z.enum(["recording", "transcript", "report", "all"]).parse(req.nextUrl.searchParams.get("what") ?? "all");
  await deleteInterviewData(auth.orgId, auth.userId, uuidParam(id), what);
  return { ok: true };
});
