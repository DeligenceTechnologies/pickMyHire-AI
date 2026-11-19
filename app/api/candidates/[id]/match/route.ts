import { z } from "zod";
import { body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { getMatch, matchCandidate } from "@/lib/services/candidate-match";

const Schema = z.object({ jobId: z.string().uuid(), refresh: z.boolean().optional() });

/** How well the candidate's resume fits a job. Checks it now if it hasn't been checked yet (or `refresh`). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("interview:write");
  const { jobId, refresh } = await body(req, Schema);
  const candidateId = uuidParam(id);
  const known = await getMatch(auth.orgId, candidateId, jobId);
  if (known && !refresh && (known.status === "completed" || known.source === "application")) return { match: known };
  return { match: await matchCandidate(auth.orgId, candidateId, jobId) };
}, { rateLimit: { key: "candidate-match", limit: 60, windowMs: 60 * 60_000 } });
