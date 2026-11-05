import { route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { sendReminder } from "@/lib/services/interviews";

export const POST = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("interview:write");
  return sendReminder(auth.orgId, auth.userId, uuidParam(id));
}, { rateLimit: { key: "remind", limit: 60, windowMs: 60 * 60_000 } });
