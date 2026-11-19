import { z } from "zod";
import { body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { archiveCandidate, restoreCandidate } from "@/lib/services/candidate-archive";

const Schema = z.object({ reason: z.string().trim().min(1, "Choose a reason.").max(200) });

/** Archive a candidate with a reason: they leave the active list; nothing is deleted. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("candidate:write");
  await archiveCandidate(auth.orgId, auth.userId, uuidParam(id), (await body(req, Schema)).reason);
  return { ok: true };
});

/** Restore an archived candidate to the active list. */
export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("candidate:write");
  await restoreCandidate(auth.orgId, auth.userId, uuidParam(id));
  return { ok: true };
});
