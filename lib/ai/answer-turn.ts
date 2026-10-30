import "server-only";
import { aiIsLive } from "@/lib/env";
import { log } from "@/lib/logger";
import { AnswerTurnSchema, type AnswerAnalysis, type FollowupDecision } from "@/lib/validation/ai-schemas";
import * as prompt from "@/prompts/answer-turn/v1";
import { AI_CONFIG } from "./config";
import { classifyReply } from "@/lib/interview/repeat";
import { mockAnalyzeAnswer, mockFollowup } from "./mock";
import { runStructured } from "./openai-client";

export const ANSWER_TURN_VERSION = prompt.version;

export type TurnResult = { analysis: AnswerAnalysis & { source: string; answer_unclear?: boolean }; decision: FollowupDecision | null; ms: number };

/**
 * One fast model call per answer: analysis + an optional follow-up proposal.
 * Never throws — on timeout/failure the interview simply moves on (the
 * state machine's default), so a slow AI call can't stall a live interview.
 */
export async function analyzeTurn(input: { orgId: string } & Parameters<typeof prompt.buildUser>[0]): Promise<TurnResult> {
  const started = Date.now();
  if (!aiIsLive()) {
    const analysis = mockAnalyzeAnswer(input.answer);
    const needs = analysis.followup_needed || analysis.candidate_asked_for_clarification;
    const used = Math.max(0, input.alreadyAsked.length - 1);
    return {
      analysis: { ...analysis, answer_unclear: classifyReply(input.answer) === "unclear", source: "mock" },
      decision: needs ? mockFollowup({ question: input.question, followupsUsed: used, clarification: analysis.candidate_asked_for_clarification }) : null,
      ms: Date.now() - started,
    };
  }
  try {
    const { orgId, ...rest } = input;
    const t = await runStructured({
      orgId,
      feature: "answer_turn",
      model: AI_CONFIG.answerTurn.model,
      reasoningEffort: AI_CONFIG.answerTurn.reasoningEffort,
      verbosity: AI_CONFIG.answerTurn.verbosity,
      promptVersion: prompt.version,
      system: prompt.system,
      user: prompt.buildUser(rest),
      schema: AnswerTurnSchema,
      schemaName: "answer_turn",
      timeoutMs: 9_000,
      maxAttempts: 2,
    });
    const { followup_question, followup_reason, transition, ...analysis } = t;
    const wantsFollowup = (analysis.followup_needed || analysis.candidate_asked_for_clarification) && !!followup_question?.trim();
    return {
      analysis: { ...analysis, source: "openai" },
      decision: wantsFollowup
        ? { action: "follow_up", reason: followup_reason, missing_evidence: analysis.missing_evidence, question: followup_question, transition }
        : null,
      ms: Date.now() - started,
    };
  } catch (err) {
    log.warn("ai.answer_turn_fallback", { err });
    return { analysis: { ...mockAnalyzeAnswer(input.answer), followup_needed: false, source: "fallback" }, decision: null, ms: Date.now() - started };
  }
}
