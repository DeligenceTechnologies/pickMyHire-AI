import "server-only";
import { z } from "zod";
import { aiIsLive } from "@/lib/env";
import { log } from "@/lib/logger";
import * as prompt from "@/prompts/question-rephrase/v1";
import { AI_CONFIG } from "./config";
import { runStructured } from "./openai-client";

const RephraseSchema = z.object({ question: z.string() });

/**
 * A simpler wording of a question the candidate didn't understand. Never throws:
 * on timeout or failure it returns null and the question is repeated as it was.
 */
export async function rephraseQuestion(input: { orgId: string } & Parameters<typeof prompt.buildUser>[0]): Promise<string | null> {
  if (!aiIsLive()) return `Put simply: ${input.question}`;
  try {
    const { orgId, ...rest } = input;
    const r = await runStructured({
      orgId,
      feature: "question_rephrase",
      model: AI_CONFIG.answerTurn.model,
      reasoningEffort: AI_CONFIG.answerTurn.reasoningEffort,
      verbosity: AI_CONFIG.answerTurn.verbosity,
      promptVersion: prompt.version,
      system: prompt.system,
      user: prompt.buildUser(rest),
      schema: RephraseSchema,
      schemaName: "question_rephrase",
      timeoutMs: 6_000,
      maxAttempts: 1,
    });
    return r.question.trim() || null;
  } catch (err) {
    log.warn("ai.question_rephrase_fallback", { err });
    return null;
  }
}
