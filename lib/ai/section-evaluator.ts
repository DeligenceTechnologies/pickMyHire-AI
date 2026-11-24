import "server-only";
import { aiIsLive } from "@/lib/env";
import { SectionEvaluationV2Schema, type QuestionResult, type StoredSectionEvaluation } from "@/lib/validation/ai-schemas";
import * as prompt from "@/prompts/section-evaluator/v2";
import { AI_CONFIG } from "./config";
import { mockEvaluateSection } from "./mock";
import { runStructured } from "./openai-client";

export const EVALUATOR_VERSION = prompt.version;

export type EvalSegment = { ref: string; speaker: string; text: string; start: number; end: number; question_id: string | null };
export type EvalQuestion = {
  ref: string; id: string; text: string; intent: string | null; criteria: string[]; is_followup: boolean; parent_ref: string | null; notes: string | null;
};

const line = (s: EvalSegment) => `[${s.ref} ${s.start}-${s.end}] ${s.speaker}: ${s.text.replace(/\s+/g, " ")}`;

/**
 * Evaluate one section: every answer against its question (goal and what a good answer shows), the job's
 * requirements and the resume, then the section overall. Returns per-question results with their question ids.
 */
export async function evaluateSection(input: {
  orgId: string;
  jobTitle: string;
  jobSummary: string | null;
  requirements: { must: string[]; nice: string[] };
  resume: string | null;
  sectionName: string;
  objective: string;
  criteria: string[];
  segments: EvalSegment[];
  questions: EvalQuestion[];
}): Promise<{ evaluation: StoredSectionEvaluation; source: "openai" | "mock" }> {
  const hasCandidateSpeech = input.segments.some((s) => s.speaker === "candidate" && s.text.trim());
  if (!aiIsLive() || !hasCandidateSpeech) return { evaluation: { ...mockEvaluateSection(input.segments), questions: [] }, source: "mock" };

  const asked = new Set(input.questions.map((q) => q.id));
  const evaluation = await runStructured({
    orgId: input.orgId,
    feature: "section_evaluator",
    model: AI_CONFIG.evaluator,
    promptVersion: prompt.version,
    system: prompt.system,
    user: prompt.buildUser({
      jobTitle: input.jobTitle,
      jobSummary: input.jobSummary,
      requirements: input.requirements,
      resume: input.resume,
      sectionName: input.sectionName,
      objective: input.objective,
      criteria: input.criteria,
      questions: input.questions.map((q) => ({ ...q, lines: input.segments.filter((s) => s.question_id === q.id).map(line) })),
      otherLines: input.segments.filter((s) => !s.question_id || !asked.has(s.question_id)).map(line),
    }),
    schema: SectionEvaluationV2Schema,
    schemaName: "section_evaluation",
  });
  // Tie each result back to its question (the AI only sees short refs like "Q3"); drop refs it made up.
  const byRef = new Map(input.questions.map((q) => [q.ref, q]));
  const questions: QuestionResult[] = evaluation.questions.flatMap((r) => {
    const q = byRef.get(r.question_ref);
    return q ? [{ ...r, question_id: q.id, question_text: q.text, is_followup: q.is_followup }] : [];
  });
  return { evaluation: { ...evaluation, questions }, source: "openai" };
}
