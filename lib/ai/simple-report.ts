import "server-only";
import { aiIsLive } from "@/lib/env";
import { SimpleReportOutputSchema, type JobRequirements, type SimpleReportOutput } from "@/lib/validation/ai-schemas";
import * as prompt from "@/prompts/simple-report/v1";
import { AI_CONFIG } from "./config";
import { runStructured } from "./openai-client";

export const SIMPLE_REPORT_VERSION = prompt.version;

type Input = Parameters<typeof prompt.buildUser>[0];

export async function writeSimpleReport(orgId: string, input: Input): Promise<{ report: SimpleReportOutput; source: "openai" | "mock" }> {
  if (!aiIsLive()) return { report: mockSimpleReport(input), source: "mock" };
  const report = await runStructured({
    orgId,
    feature: "simple_report",
    model: AI_CONFIG.simpleReport,
    promptVersion: prompt.version,
    system: prompt.system,
    user: prompt.buildUser(input),
    schema: SimpleReportOutputSchema,
    schemaName: "simple_report",
    timeoutMs: 60_000,
  });
  return { report, source: "openai" };
}

/** Demo mode: built only from the report's own points. */
function mockSimpleReport(input: Input): SimpleReportOutput {
  const req = input.requirements as Partial<JobRequirements> | null;
  const skills = (req?.skills ?? []).slice(0, 6);
  const text = [...input.strengths, input.summary].join(" ").toLowerCase();
  return {
    headline: input.summary.split(/(?<=\.)\s/)[0] ?? input.summary,
    requirements: skills.map((s) => {
      const hit = text.includes(s.name.toLowerCase());
      return { requirement: s.name, status: hit ? "shown" : "not_asked", note: hit ? "Came up with an example in the interview." : "Not covered in this interview." };
    }),
    sections: input.sections.map((s) => ({ name: s.name, note: (s.summary ?? "Not evaluated.").split(/(?<=\.)\s/)[0] })),
    top_strength: input.strengths[0] ?? "No clear strength recorded.",
    main_gap: input.areasToExplore[0] ?? input.missingEvidence[0] ?? "Nothing major noted; confirm details in the next round.",
  };
}
