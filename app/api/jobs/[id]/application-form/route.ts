import { route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { getJobForm } from "@/lib/services/application-answers";

/** A job's application questions (for filling them in when inviting directly). */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("candidate:view");
  const { form } = await getJobForm(auth.orgId, uuidParam(id));
  return { form };
});
