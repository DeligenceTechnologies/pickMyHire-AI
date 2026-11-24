import { body, route } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { createJob, JobInputSchema, listJobs } from "@/lib/services/jobs";
import { jobScope } from "@/lib/auth/job-scope";

export const GET = route(async (req) => {
  const auth = await requireApiAuth();
  const sp = req.nextUrl.searchParams;
  return listJobs(auth.orgId, { q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, jobIds: await jobScope(auth) });
});

export const POST = route(async (req) => {
  const auth = await requireApiAuth("job:write");
  const input = await body(req, JobInputSchema);
  return { id: await createJob(auth.orgId, auth.userId, input) };
});
