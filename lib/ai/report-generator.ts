import "server-only";
import { aiIsLive } from "@/lib/env";
import { FinalReportV2Schema, type Assessment, type FinalReport, type QuestionResult, type SectionEvaluation } from "@/lib/validation/ai-schemas";
import * as prompt from "@/prompts/report-generator/v2";
import { AI_CONFIG } from "./config";
import { mockReport } from "./mock";
import { runStructured } from "./openai-client";

export const REPORT_VERSION = prompt.version;

export type ReportSection = {
  name: string; objective: string; assessment: Assessment; summary: string; strengths: string[]; concerns: string[];
  evidence: SectionEvaluation["evidence"]; questions: QuestionResult[];
};

/** How the answers went overall, counted from the per-question results (not by the AI). */
/** `incorrect` is missing on reports made before answers were checked for being right. */
export type AnswerQuality = { total: number; answered: number; partly: number; not_answered: number; off_topic: number; strong: number; incorrect?: number; skipped?: number };

export function answerQuality(sections: { questions: QuestionResult[] }[]): AnswerQuality {
  const qs = sections.flatMap((s) => s.questions);
  return {
    total: qs.length,
    answered: qs.filter((q) => q.answered === "yes").length,
    partly: qs.filter((q) => q.answered === "partly").length,
    not_answered: qs.filter((q) => q.answered === "no").length,
    off_topic: qs.filter((q) => q.relevance === "off_topic").length,
    strong: qs.filter((q) => q.depth === "strong").length,
    incorrect: qs.filter((q) => q.accuracy === "incorrect").length,
    skipped: qs.filter((q) => q.answered === "skipped").length,
  };
}

export async function generateReport(input: {
  orgId: string;
  jobTitle: string;
  jobSummary: string | null;
  requirements: { must: string[]; nice: string[] };
  resume: string | null;
  sections: ReportSection[];
  /** Candidate transcript lines by ref, so evidence cited by per-question results can be quoted. */
  lines: Map<string, { start: number; end: number; text: string }>;
}): Promise<{ report: FinalReport; source: "openai" | "mock" }> {
  if (!aiIsLive()) return { report: mockReport(input.sections), source: "mock" };
  const quality = answerQuality(input.sections);
  const cited = new Set<string>();
  const index: string[] = [];
  for (const s of input.sections) {
    for (const e of s.evidence) {
      if (e.segment_ref) cited.add(e.segment_ref);
      index.push(`${e.segment_ref ?? "-"} [${e.timestamp_start_ms}-${e.timestamp_end_ms}] (${s.name}) ${e.quote_or_paraphrase}`);
    }
    for (const q of s.questions) for (const ref of q.evidence_refs) {
      const l = input.lines.get(ref);
      if (!l || cited.has(ref)) continue;
      cited.add(ref);
      index.push(`${ref} [${l.start}-${l.end}] (${s.name}, ${q.question_ref}) ${l.text.length > 220 ? `${l.text.slice(0, 217)}…` : l.text}`);
    }
  }
  const report = await runStructured({
    orgId: input.orgId,
    feature: "report_generator",
    model: AI_CONFIG.reportGenerator,
    promptVersion: prompt.version,
    system: prompt.system,
    user: prompt.buildUser({
      jobTitle: input.jobTitle,
      jobSummary: input.jobSummary,
      requirements: input.requirements,
      resume: input.resume,
      answerQuality: `${quality.total} questions: ${quality.answered} fully answered, ${quality.partly} partly, ${quality.not_answered} not answered, ${quality.skipped} skipped honestly; ${quality.off_topic} off topic; ${quality.incorrect} wrong; ${quality.strong} with strong, first-hand detail.`,
      sections: input.sections.map(({ evidence: _e, questions, ...rest }) => ({
        ...rest,
        questions: questions.map(({ question_id: _id, is_followup, evidence_refs, ...q }) => ({ ...q, follow_up: !!is_followup, refs: evidence_refs })),
      })),
      evidenceIndex: index.join("\n"),
    }),
    schema: FinalReportV2Schema,
    schemaName: "final_report",
  });
  return { report, source: "openai" };
}
