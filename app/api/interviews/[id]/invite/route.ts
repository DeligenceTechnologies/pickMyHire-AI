import { route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { rotateLink } from "@/lib/services/interviews";

/** Send (or re-send) the invitation email with a fresh secure link. */
export const POST = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("interview:write");
  return rotateLink(auth.orgId, auth.userId, uuidParam(id), true);
}, { rateLimit: { key: "invite", limit: 60, windowMs: 60 * 60_000 } });
