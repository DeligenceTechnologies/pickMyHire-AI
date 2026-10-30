import "server-only";
import { z } from "zod";
import { aiIsLive } from "@/lib/env";
import { log } from "@/lib/logger";
import * as prompt from "@/prompts/candidate-feedback/v1";
import { AI_CONFIG } from "./config";
import { runStructured } from "./openai-client";

const FeedbackSchema = z.object({ enough_evidence: z.boolean(), feedback: z.string() });

// A last check on what reaches the candidate: anything that looks like a score, an
// outcome or an internal note means the email goes without feedback.
const NOT_FOR_CANDIDATES = /\b(score[ds]?|rating|rated|\d\s*\/\s*(?:5|10)|out of (?:5|10)|hire[ds]?|hiring decision|reject\w*|shortlist\w*|pass(?:ed)?|fail(?:ed)?|next round|move forward|other candidates|insufficient evidence|areas? to explore|accent|nervous\w*)\b/i;

export const CANDIDATE_FEEDBACK_VERSION = prompt.version;

/** Candidate-safe feedback text, or null when there isn't enough evidence or anything looks unsafe. Never throws. */
export async function writeCandidateFeedback(input: { orgId: string } & Parameters<typeof prompt.buildUser>[0]): Promise<string | null> {
  try {
    const { orgId, ...rest } = input;
    const out = aiIsLive()
      ? await runStructured({
        orgId,
        feature: "candidate_feedback",
        model: AI_CONFIG.reportGenerator,
        promptVersion: prompt.version,
        system: prompt.system,
        user: prompt.buildUser(rest),
        schema: FeedbackSchema,
        schemaName: "candidate_feedback",
        timeoutMs: 60_000,
        maxAttempts: 2,
      })
      : mockFeedback(rest);
    return checkFeedback(out);
  } catch (err) {
    log.warn("ai.candidate_feedback_failed", { err });
    return null;
  }
}

export function checkFeedback(out: z.infer<typeof FeedbackSchema>): string | null {
  const text = out.feedback.replace(/\s+/g, " ").trim();
  if (!out.enough_evidence || text.length < 80 || text.length > 1200) return null;
  if (NOT_FOR_CANDIDATES.test(text)) {
    log.warn("ai.candidate_feedback_rejected", { reason: "unsafe wording" });
    return null;
  }
  return text;
}

/** Demo mode: a plain note built only from the report's own points. */
function mockFeedback(input: Parameters<typeof prompt.buildUser>[0]): z.infer<typeof FeedbackSchema> {
  if (input.answeredQuestions < 3 || !input.strengths.length) return { enough_evidence: false, feedback: "" };
  const area = input.areasToBuild[0];
  return {
    enough_evidence: true,
    feedback: `Thank you for taking the time to interview for the ${input.jobTitle} role. ${input.strengths[0].replace(/\.$/, "")} came through clearly in your answers.`
      + (area ? ` One area to build on: ${area.replace(/\.$/, "").toLowerCase()}. Developing this will help you show the impact of your work more clearly.` : "")
      + " Keep building on these strengths as you grow in your career.",
  };
}
