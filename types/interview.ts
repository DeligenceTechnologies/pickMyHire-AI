import { z } from "zod";

export const TemplateSectionInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(""),
  objective: z.string().max(500).default(""),
  instructions: z.string().max(1000).default(""),
  duration_minutes: z.coerce.number().int().min(1).max(60),
  min_questions: z.coerce.number().int().min(0).max(10),
  max_questions: z.coerce.number().int().min(1).max(12),
  max_followups: z.coerce.number().int().min(0).max(5),
  evaluation_criteria: z.array(z.string().trim().min(1).max(80)).max(10),
  scoring_enabled: z.boolean().default(false),
  enabled: z.boolean().default(true),
}).refine((s) => s.min_questions <= s.max_questions, {
  message: "Minimum questions cannot exceed maximum questions",
  path: ["min_questions"],
});
export type TemplateSectionInput = z.infer<typeof TemplateSectionInputSchema>;

export const TemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).default(""),
  sections: z.array(TemplateSectionInputSchema).min(1).max(12),
});
export type TemplateInput = z.infer<typeof TemplateInputSchema>;

export const StoredPlanQuestionSchema = z.object({
  key: z.string(),
  question: z.string(),
  intent: z.string(),
  evaluation_criteria: z.array(z.string()),
  followup_topics: z.array(z.string()),
});
export type StoredPlanQuestion = z.infer<typeof StoredPlanQuestionSchema>;

export const StoredPlanSectionSchema = z.object({
  index: z.number().int(),
  section_id: z.string().uuid(),
  name: z.string(),
  objective: z.string(),
  instructions: z.string(),
  duration_minutes: z.number(),
  min_questions: z.number().int(),
  max_questions: z.number().int(),
  max_followups: z.number().int(),
  evaluation_criteria: z.array(z.string()),
  scoring_enabled: z.boolean(),
  questions: z.array(StoredPlanQuestionSchema).min(1),
});
export type StoredPlanSection = z.infer<typeof StoredPlanSectionSchema>;

export const StoredPlanSchema = z.object({
  version: z.literal(1),
  generated_by: z.enum(["openai", "mock"]),
  prompt_version: z.string(),
  generated_at: z.string(),
  sections: z.array(StoredPlanSectionSchema).min(1),
});
export type StoredPlan = z.infer<typeof StoredPlanSchema>;

export const PendingUtteranceSchema = z.object({
  question_id: z.string().uuid().nullable(),
  text: z.string(),
  kind: z.enum(["question", "followup", "closing"]),
});
export type PendingUtterance = z.infer<typeof PendingUtteranceSchema>;

export const InterviewStateSchema = z.object({
  phase: z.enum(["not_started", "in_progress", "finished"]),
  section_index: z.number().int().min(0),
  question_index: z.number().int().min(0),
  current_question_id: z.string().uuid().nullable(),
  current_planned_question_id: z.string().uuid().nullable(),
  followups_used: z.number().int().min(0),
  section_started_ms: z.number().int().nullable(),
  pending_utterance: PendingUtteranceSchema.nullable(),
  answered_count: z.number().int().min(0),
  last_activity_at: z.string().nullable(),
  /** Repeats / rephrasings given for the current question (see lib/interview/repeat.ts). */
  repeats: z.object({ question_id: z.string(), count: z.number().int().min(0) }).nullable().optional(),
  /** Set when the candidate left a started interview and it was closed (the link no longer works). */
  ended_reason: z.literal("left").optional(),
});
export type InterviewState = z.infer<typeof InterviewStateSchema>;

export const initialInterviewState = (): InterviewState => ({
  phase: "not_started",
  section_index: 0,
  question_index: 0,
  current_question_id: null,
  current_planned_question_id: null,
  followups_used: 0,
  section_started_ms: null,
  pending_utterance: null,
  answered_count: 0,
  last_activity_at: null,
});

export type InterviewStatus =
  | "created" | "invited" | "consent_pending" | "device_check" | "ready"
  | "in_progress" | "completing" | "completed" | "processing" | "report_ready"
  | "cancelled" | "expired" | "failed";

/** Progress info that is safe to show to the candidate. */
export type CandidateProgress = {
  section_index: number;
  section_count: number;
  section_name: string;
  total_minutes: number;
};
