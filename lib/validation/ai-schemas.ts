import { z } from "zod";

// All AI structured outputs. Every field is required (nullable where unknown)
// so the same schemas can be used for OpenAI strict structured outputs.

export const ResumeProfileSchema = z.object({
  name: z.string().nullable(),
  headline: z.string().nullable(),
  years_experience: z.number().nullable(),
  skills: z.array(z.string()),
  companies: z.array(z.string()),
  roles: z.array(
    z.object({
      title: z.string(),
      company: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      highlights: z.array(z.string()),
    }),
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      technologies: z.array(z.string()),
    }),
  ),
  responsibilities: z.array(z.string()),
  achievements: z.array(z.string()),
  education: z.array(z.string()),
  certifications: z.array(z.string()),
  uncertainties: z.array(z.string()),
});
export type ResumeProfile = z.infer<typeof ResumeProfileSchema>;

export const JobRequirementsSchema = z.object({
  summary: z.string(),
  skills: z.array(
    z.object({
      name: z.string(),
      importance: z.enum(["required", "preferred"]),
    }),
  ),
  experience: z.object({
    minimum_years: z.number().nullable(),
    maximum_years: z.number().nullable(),
  }),
  responsibilities: z.array(z.string()),
  seniority: z.enum(["intern", "junior", "mid", "senior", "staff", "principal", "manager", "unknown"]),
});
export type JobRequirements = z.infer<typeof JobRequirementsSchema>;

export const PlanQuestionSchema = z.object({
  question: z.string(),
  intent: z.string(),
  evaluation_criteria: z.array(z.string()),
  followup_topics: z.array(z.string()),
  references_resume: z.boolean(),
});

export const InterviewPlanSchema = z.object({
  sections: z.array(
    z.object({
      section_index: z.number().int(),
      name: z.string(),
      objective: z.string(),
      questions: z.array(PlanQuestionSchema),
    }),
  ),
});
export type InterviewPlanAI = z.infer<typeof InterviewPlanSchema>;
export type PlanQuestion = z.infer<typeof PlanQuestionSchema>;

export const AnswerAnalysisSchema = z.object({
  relevance: z.enum(["high", "medium", "low", "off_topic"]),
  completeness: z.enum(["complete", "partial", "minimal", "no_answer"]),
  evidence: z.array(z.string()),
  missing_evidence: z.array(z.string()),
  followup_needed: z.boolean(),
  candidate_asked_for_clarification: z.boolean(),
  summary: z.string(),
});
export type AnswerAnalysis = z.infer<typeof AnswerAnalysisSchema>;

export const FollowupDecisionSchema = z.object({
  action: z.enum(["follow_up", "next_question", "next_section", "finish"]),
  reason: z.string(),
  missing_evidence: z.array(z.string()),
  question: z.string().nullable(),
  transition: z.string().nullable(),
});
export type FollowupDecision = z.infer<typeof FollowupDecisionSchema>;

export const AssessmentEnum = z.enum(["very_strong", "strong", "adequate", "limited", "insufficient_evidence"]);
export type Assessment = z.infer<typeof AssessmentEnum>;

export const SectionEvaluationSchema = z.object({
  assessment: AssessmentEnum,
  summary: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  criteria: z.array(
    z.object({
      criterion: z.string(),
      assessment: AssessmentEnum,
      note: z.string(),
    }),
  ),
  evidence: z.array(
    z.object({
      segment_ref: z.string().nullable(),
      timestamp_start_ms: z.number().int(),
      timestamp_end_ms: z.number().int(),
      quote_or_paraphrase: z.string(),
      supports: z.string(),
    }),
  ),
});
export type SectionEvaluation = z.infer<typeof SectionEvaluationSchema>;

export const FinalReportSchema = z.object({
  summary: z.string(),
  strengths: z.array(
    z.object({ point: z.string(), evidence_refs: z.array(z.string()) }),
  ),
  areas_to_explore: z.array(
    z.object({ point: z.string(), reason: z.string() }),
  ),
  key_evidence: z.array(
    z.object({
      claim: z.string(),
      segment_ref: z.string().nullable(),
      timestamp_start_ms: z.number().int(),
      timestamp_end_ms: z.number().int(),
      quote_or_paraphrase: z.string(),
    }),
  ),
  missing_evidence: z.array(z.string()),
  fact_vs_interpretation_note: z.string(),
});
export type FinalReport = z.infer<typeof FinalReportSchema>;

export const assessmentScore: Record<Assessment, number> = {
  insufficient_evidence: 1,
  limited: 2,
  adequate: 3,
  strong: 4,
  very_strong: 5,
};

export const assessmentLabel: Record<Assessment, string> = {
  insufficient_evidence: "Insufficient evidence",
  limited: "Limited",
  adequate: "Adequate",
  strong: "Strong",
  very_strong: "Very strong",
};

export const MatchLevelEnum = z.enum(["strong_match", "good_match", "partial_match", "low_match", "insufficient_information"]);
export type MatchLevel = z.infer<typeof MatchLevelEnum>;

export const ApplicationScreeningSchema = z.object({
  match_level: MatchLevelEnum,
  summary: z.string(),
  requirements: z.array(
    z.object({
      requirement: z.string(),
      importance: z.enum(["required", "preferred"]),
      status: z.enum(["met", "partially_met", "not_evident"]),
      evidence: z.string().nullable(),
    }),
  ),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  experience_evidence: z.string().nullable(),
  suggested_interview_focus: z.array(z.string()),
});
export type ApplicationScreening = z.infer<typeof ApplicationScreeningSchema>;

export const matchLevelLabel: Record<MatchLevel, string> = {
  strong_match: "Strong match",
  good_match: "Good match",
  partial_match: "Partial match",
  low_match: "Low match",
  insufficient_information: "Not enough information",
};

/** One-call answer turn: analysis plus an optional follow-up, used live during the interview. */
export const AnswerTurnSchema = AnswerAnalysisSchema.extend({
  answer_unclear: z.boolean(),
  followup_question: z.string().nullable(),
  followup_reason: z.string(),
  transition: z.string().nullable(),
});
export type AnswerTurn = z.infer<typeof AnswerTurnSchema>;

/** Overall summary across every round a candidate cleared (to support the shortlist decision). */
export const OverallSummarySchema = z.object({
  summary: z.string(),
  highlights: z.array(z.object({ point: z.string(), source_ids: z.array(z.string()) })),
  concern: z.object({ point: z.string(), source_ids: z.array(z.string()) }).nullable(),
  interviewer_quote: z.object({ quote: z.string(), source_id: z.string() }).nullable(),
  requirements: z.array(z.object({ requirement: z.string(), evidenced: z.boolean(), source_ids: z.array(z.string()) })),
});
export type OverallSummary = z.infer<typeof OverallSummarySchema>;
