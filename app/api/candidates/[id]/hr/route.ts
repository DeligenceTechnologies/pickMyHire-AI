import { body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { getHrPanel, HrDetailsSchema, saveHrDetails } from "@/lib/services/candidate-notes";

/** HR details and notes for a candidate (the same record on every page). */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("candidate:view");
  return getHrPanel(auth.orgId, uuidParam(id));
});

export const PUT = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("candidate:write");
  await saveHrDetails(auth.orgId, auth.userId, uuidParam(id), await body(req, HrDetailsSchema));
  return { ok: true };
});
