import { describe, expect, it } from "vitest";
import { analyzeTurn } from "@/lib/ai/answer-turn";
import { computeAllowed, resolveNextStep } from "@/lib/interview/state-machine";
import { AnswerTurnSchema } from "@/lib/validation/ai-schemas";
import { initialInterviewState, type StoredPlan } from "@/types/interview";

const base = {
  orgId: "00000000-0000-4000-8000-000000000000",
  sectionName: "Project Deep Dive", sectionObjective: "Ownership", question: "Tell me about the payment system you built.",
  intent: null, criteria: ["Ownership"], followupTopics: [], alreadyAsked: ["Tell me about the payment system you built."],
  followupsRemaining: 2, priorContext: null,
};

describe("analyzeTurn (demo mode)", () => {
  it("proposes a follow-up for a thin answer", async () => {
    const t = await analyzeTurn({ ...base, answer: "I worked on Stripe." });
    expect(t.decision?.action).toBe("follow_up");
    expect(t.analysis.completeness).toBe("minimal");
  });
  it("flags a repeat request but not a real answer that mentions repeating", async () => {
    expect((await analyzeTurn({ ...base, answer: "Sorry, can you repeat the question?" })).analysis.candidate_asked_for_clarification).toBe(true);
    expect((await analyzeTurn({ ...base, answer: "We had to repeat the payment reconciliation every night." })).analysis.candidate_asked_for_clarification).toBe(false);
  });
  it("flags filler-only replies as unclear", async () => {
    expect((await analyzeTurn({ ...base, answer: "Uh... hmm." })).analysis.answer_unclear).toBe(true);
    expect((await analyzeTurn({ ...base, answer: "Yes." })).analysis.answer_unclear).toBe(false);
  });
  it("moves on after a complete answer", async () => {
    const t = await analyzeTurn({ ...base, answer: "word ".repeat(60) });
    expect(t.decision).toBeNull();
  });
});

describe("answer turn schema", () => {
  it("accepts a no-follow-up turn and rejects a missing field", () => {
    const ok = { relevance: "high", completeness: "complete", evidence: [], missing_evidence: [], followup_needed: false,
      candidate_asked_for_clarification: false, answer_unclear: false, summary: "", followup_question: null, followup_reason: "not needed", transition: null };
    expect(AnswerTurnSchema.safeParse(ok).success).toBe(true);
    const { followup_reason: _r, ...bad } = ok;
    expect(AnswerTurnSchema.safeParse(bad).success).toBe(false);
  });
});

describe("rules still override the AI", () => {
  const q = (k: string) => ({ key: k, question: "Q?", intent: "", evaluation_criteria: [], followup_topics: [] });
  const plan: StoredPlan = { version: 1, generated_by: "mock", prompt_version: "t", generated_at: "", sections: [{
    index: 0, section_id: "00000000-0000-4000-8000-000000000001", name: "S", objective: "", instructions: "", duration_minutes: 5,
    min_questions: 1, max_questions: 2, max_followups: 2, evaluation_criteria: [], scoring_enabled: false, questions: [q("a"), q("b")] }] };
  it("ignores a suggested follow-up once follow-ups are used up", () => {
    const allowed = computeAllowed({ plan, state: { ...initialInterviewState(), phase: "in_progress", section_started_ms: 0, followups_used: 2 }, nowMs: 1000 });
    expect(allowed.follow_up).toBe(false); // controller takes the fast path: no AI call at all
    const step = resolveNextStep(allowed, { action: "follow_up", reason: "", missing_evidence: [], question: "More?", transition: null });
    expect(step.action).toBe("next_question");
  });
});
