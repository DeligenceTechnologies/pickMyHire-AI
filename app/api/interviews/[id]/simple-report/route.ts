import { ApiError, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { buildSimpleReport } from "@/lib/interview/simple-report";
import { log } from "@/lib/logger";

/** Create the one-page simple report for an interview whose report predates it (or where it failed). */
export const POST = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("report:view");
  const interviewId = uuidParam(id);
  try {
    return { simple: await buildSimpleReport(auth.orgId, interviewId, auth.userId) };
  } catch (err) {
    log.warn("simple_report.on_demand_failed", { interviewId, err });
    throw new ApiError(502, "We couldn't create the simple report. Please try again.");
  }
}, { rateLimit: { key: "simple-report", limit: 30, windowMs: 60 * 60_000 } });
