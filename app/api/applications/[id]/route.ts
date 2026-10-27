import { z } from "zod";
import { ApiError, body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { getApplication, setApplicationStatus } from "@/lib/services/applications";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("candidate:view");
  const a = await getApplication(auth.orgId, uuidParam(id));
  if (!a) throw new ApiError(404, "Application not found");
  return a;
});

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("candidate:write");
  const { status } = await body(req, z.object({ status: z.enum(["new", "declined"]) }));
  await setApplicationStatus(auth.orgId, auth.userId, uuidParam(id), status);
  return { ok: true };
});
