import "server-only";
import { z } from "zod";
import { aiIsLive } from "@/lib/env";
import { log } from "@/lib/logger";
import * as prompt from "@/prompts/candidate-feedback/v1";
import { AI_CONFIG } from "./config";
import { runStructured } from "./openai-client";

const FeedbackSchema = z.object({ enough_evidence: z.boolean(), feedback: z.string() });
type FeedbackDraft = z.infer<typeof FeedbackSchema>;

// A last check on what reaches the candidate: phrases about their result, an outcome,
// a comparison or an internal note. Ordinary job words ("SEO score", "app ratings",
// "passed the tests") are fine; only wording aimed at the candidate's own result is held back.
const NOT_FOR_CANDIDATES = new RegExp([
  String.raw`your (?:overall |final |interview )?(?:score|rating|result|grade|performance rating)s?`,
  String.raw`you (?:scored|were scored|were rated|rated|got a score|passed|failed|did not pass|didn't pass|qualified|did not qualify|didn't qualify)`,
  String.raw`(?:rated|scored|graded) (?:you|your)`,
  String.raw`\d+(?:\.\d+)? ?(?:\/|out of) ?(?:5|10|100)`,
  String.raw`hiring (?:decision|outcome)`,
  String.raw`(?:you|your application|your candidacy) (?:will|won't|will not|has|have|was|were|is|are)(?: not| been| be)* (?:hired|selected|shortlisted|rejected|declined|accepted|progressed|advanced)`,
  String.raw`next (?:round|stage|step of the process)`,
  String.raw`move (?:you )?forward|moving forward with`,
  String.raw`other (?:candidates|applicants)`,
  String.raw`compared (?:to|with) (?:other|the other)`,
  String.raw`insufficient evidence|areas? to explore|the interviewer should|the recruiter should|hiring team should`,
  String.raw`your accent|(?:seemed|sounded|were|looked) (?:nervous|anxious|confident|unconfident)`,
].map((p) => `\\b(?:${p})\\b`).join("|"), "i");

export const CANDIDATE_FEEDBACK_VERSION = prompt.version;

export type CandidateFeedback =
  /** Safe to send: goes into the email. */
  | { feedback: string; held: null }
  /** Written but held back by the safety check: a recruiter can review it and send it. */
  | { feedback: null; held: { draft: string; reason: string } }
  /** Not enough to go on, or the AI call failed: the email goes without feedback. */
  | { feedback: null; held: null };

const NONE: CandidateFeedback = { feedback: null, held: null };

/**
 * Candidate-safe feedback for the follow-up email. When the first draft uses a phrase
 * candidates must not see, the AI rewrites it once without that phrase; if that still
 * fails, the draft is returned as held for a recruiter to review. Never throws.
 */
export async function writeCandidateFeedback(input: { orgId: string } & Parameters<typeof prompt.buildUser>[0]): Promise<CandidateFeedback> {
  try {
    const { orgId, ...rest } = input;
    const user = prompt.buildUser(rest);
    const ask = (extra?: string) => aiIsLive()
      ? runStructured({
        orgId,
        feature: "candidate_feedback",
        model: AI_CONFIG.reportGenerator,
        promptVersion: prompt.version,
        system: prompt.system,
        user: extra ? `${user}\n\n${extra}` : user,
        schema: FeedbackSchema,
        schemaName: "candidate_feedback",
        timeoutMs: 60_000,
        maxAttempts: 2,
      })
      : Promise.resolve(mockFeedback(rest));

    let check = checkFeedback(await ask());
    if (check.blocked) {
      log.warn("ai.candidate_feedback_rewrite", { phrase: check.blocked });
      check = checkFeedback(await ask(prompt.rewriteInstruction(check.blocked, check.text)));
    }
    if (check.ok) return { feedback: check.text, held: null };
    if (check.blocked) {
      log.warn("ai.candidate_feedback_held", { phrase: check.blocked });
      return { feedback: null, held: { draft: check.text, reason: check.blocked } };
    }
    return NONE;
  } catch (err) {
    log.warn("ai.candidate_feedback_failed", { err });
    return NONE;
  }
}

/** ok: safe to send; blocked: the phrase that held it back; neither: too little to send. */
export function checkFeedback(out: FeedbackDraft): { ok: boolean; text: string; blocked: string | null } {
  const text = out.feedback.replace(/\s+/g, " ").trim();
  if (!out.enough_evidence || text.length < 80 || text.length > 1200) return { ok: false, text, blocked: null };
  const hit = text.match(NOT_FOR_CANDIDATES);
  if (hit) return { ok: false, text, blocked: hit[0] };
  return { ok: true, text, blocked: null };
}

/** Demo mode: a plain note built only from the report's own points. */
function mockFeedback(input: Parameters<typeof prompt.buildUser>[0]): FeedbackDraft {
  if (input.answeredQuestions < 3 || !input.strengths.length) return { enough_evidence: false, feedback: "" };
  const area = input.areasToBuild[0];
  return {
    enough_evidence: true,
    feedback: `Thank you for taking the time to interview for the ${input.jobTitle} role. ${input.strengths[0].replace(/\.$/, "")} came through clearly in your answers.`
      + (area ? ` One area to build on: ${area.replace(/\.$/, "").toLowerCase()}. Developing this will help you show the impact of your work more clearly.` : "")
      + " Keep building on these strengths as you grow in your career.",
  };
}
