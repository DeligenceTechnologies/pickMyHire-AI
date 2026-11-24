import { route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { getJobForm } from "@/lib/services/application-answers";
import { assertJobAccess } from "@/lib/auth/job-scope";

/** A job's application questions (for filling them in when inviting directly). */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("candidate:view");
  await assertJobAccess(auth, uuidParam(id));
  const { form } = await getJobForm(auth.orgId, uuidParam(id));
  return { form };
});
