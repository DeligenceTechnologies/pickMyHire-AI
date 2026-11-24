import { z } from "zod";
import { body, route, uuidParam } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/session";
import { assertInterviewAccess } from "@/lib/auth/job-scope";
import { withOrg } from "@/lib/database/db";

/** Records recruiter review activity (report / evidence views). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("report:view");
  await assertInterviewAccess(auth, uuidParam(id));
  const { action, ms } = await body(req, z.object({ action: z.enum(["report_viewed", "evidence_viewed"]), ms: z.number().int().optional() }));
  const interviewId = uuidParam(id);
  await withOrg(auth.orgId, async (tx) => {
    const [iv] = await tx`select id from interviews where id = ${interviewId} and organization_id = ${auth.orgId}`;
    if (iv) await audit(tx, { orgId: auth.orgId, userId: auth.userId, action: `interview.${action}`, entityType: "interview", entityId: interviewId, metadata: ms != null ? { ms } : {} });
  });
  return { ok: true };
});
