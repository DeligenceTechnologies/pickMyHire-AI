import { route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { rotateLink } from "@/lib/services/interviews";

/** Issue a new copyable link. Links are stored hashed, so the previous link stops working. */
export const POST = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("interview:write");
  return { link: (await rotateLink(auth.orgId, auth.userId, uuidParam(id), false)).link };
});
