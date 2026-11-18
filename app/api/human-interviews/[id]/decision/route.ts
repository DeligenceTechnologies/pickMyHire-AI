import { z } from "zod";
import { body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { DECISIONS } from "@/lib/hiring";
import { setRoundDecision } from "@/lib/services/pipeline";
import { summarizeIfCleared } from "@/lib/services/candidate-summary";

const Schema = z.object({
  decision: z.enum(DECISIONS).nullable(),
  note: z.string().trim().max(1000).nullable().optional(),
  /** With Not qualified: also move the candidate to Rejected for the job. */
  reject: z.boolean().optional(),
});

/** Mark a human interview round Qualified / Not qualified / On hold (or clear it). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("decision:write");
  const input = await body(req, Schema);
  const { jobId, candidateId, rejected } = await setRoundDecision(auth.orgId, auth.userId, { kind: "human", id: uuidParam(id), ...input });
  if (input.decision === "qualified") summarizeIfCleared(auth.orgId, jobId, candidateId);
  return { ok: true, rejected };
});
