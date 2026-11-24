import { describe, expect, it, vi } from "vitest";

// The AI call is replaced: these tests check what we send it and how its answer is used.
const runStructured = vi.fn();
vi.mock("@/lib/ai/openai-client", () => ({ runStructured: (o: unknown) => runStructured(o) }));
vi.mock("@/lib/env", async (orig) => ({ ...(await orig<object>()), aiIsLive: () => true }));

const { evaluateSection } = await import("@/lib/ai/section-evaluator");
const { answerQuality } = await import("@/lib/ai/report-generator");
const { requirementLines } = await import("@/lib/interview/report-context");
const evaluatorPrompt = await import("@/prompts/section-evaluator/v2");
const reportPrompt = await import("@/prompts/report-generator/v2");

const questions = [
  { ref: "Q1", id: "q-1", text: "Tell me about a project you led.", intent: "Leadership", criteria: ["own role", "outcome"], is_followup: false, parent_ref: null, notes: "relevance high · gaps: team size" },
  { ref: "Q2", id: "q-2", text: "How big was the team?", intent: null, criteria: [], is_followup: true, parent_ref: "Q1", notes: null },
];
const segments = [
  { ref: "S1", speaker: "interviewer", text: "Tell me about a project you led.", start: 0, end: 3000, question_id: "q-1" },
  { ref: "S2", speaker: "candidate", text: "I led the billing rewrite.", start: 3500, end: 9000, question_id: "q-1" },
  { ref: "S3", speaker: "candidate", text: "Five engineers.", start: 9500, end: 11000, question_id: "q-2" },
];
const input = {
  orgId: "org", jobTitle: "Engineering Manager", jobSummary: "Lead a payments team",
  requirements: { must: ["Team leadership", "At least 5 years of relevant experience"], nice: ["Kafka"] },
  resume: "Role: Tech Lead at Acme (2019 – 2024)", sectionName: "Leadership", objective: "Leading teams", criteria: ["ownership"],
  segments, questions,
};

describe("report v2: each answer judged against its question, the job and the resume", () => {
  it("sends each question with its goal, what a good answer shows, live notes and its own answer lines", () => {
    const text = evaluatorPrompt.buildUser({ ...input, questions: questions.map((q) => ({ ...q, lines: segments.filter((s) => s.question_id === q.id).map((s) => `[${s.ref}] ${s.speaker}: ${s.text}`) })), otherLines: [] });
    expect(text).toContain("Q1 (planned): Tell me about a project you led.");
    expect(text).toContain("Goal: Leadership");
    expect(text).toContain("A good answer shows: own role; outcome");
    expect(text).toContain("Live notes (unverified): relevance high");
    expect(text).toContain("Q2 (follow-up to Q1): How big was the team?");
    // Answer lines sit under their own question.
    expect(text.indexOf("[S2] candidate")).toBeGreaterThan(text.indexOf("Q1 (planned)"));
    expect(text.indexOf("[S3] candidate")).toBeGreaterThan(text.indexOf("Q2 (follow-up"));
    expect(text).toContain("- Team leadership");
    // The resume is data, never instructions.
    expect(text).toMatch(/<resume>[\s\S]*Tech Lead at Acme[\s\S]*<\/resume>/);
  });

  it("ties the AI's results back to the right questions and drops refs it made up", async () => {
    runStructured.mockResolvedValueOnce({
      assessment: "adequate", summary: "s", strengths: [], concerns: [], criteria: [], evidence: [],
      questions: [
        { question_ref: "Q2", answered: "yes", relevance: "high", depth: "basic", shown: ["team size"], missing: [], note: "n", evidence_refs: ["S3"] },
        { question_ref: "Q9", answered: "no", relevance: "off_topic", depth: "none", shown: [], missing: [], note: "x", evidence_refs: [] },
      ],
    });
    const { evaluation, source } = await evaluateSection(input);
    expect(source).toBe("openai");
    expect(evaluation.questions).toEqual([expect.objectContaining({ question_ref: "Q2", question_id: "q-2", question_text: "How big was the team?", is_followup: true })]);
    const sent = runStructured.mock.calls[0][0] as { user: string; promptVersion: string };
    expect(sent.promptVersion).toBe("section-evaluator@v2");
    expect(sent.user).toContain("Engineering Manager");
  });

  it("counts how the answers went, without the AI", () => {
    const r = (answered: "yes" | "partly" | "no", relevance: "high" | "off_topic", depth: "strong" | "basic") =>
      ({ question_ref: "Q", answered, relevance, depth, shown: [], missing: [], note: "", evidence_refs: [] });
    expect(answerQuality([{ questions: [r("yes", "high", "strong"), r("partly", "high", "basic")] }, { questions: [r("no", "off_topic", "basic")] }]))
      .toEqual({ total: 3, answered: 1, partly: 1, not_answered: 1, off_topic: 1, strong: 1 });
  });

  it("lists the job's must-haves (required skills, minimum experience, responsibilities) and nice-to-haves once each", () => {
    const lines = requirementLines({
      title: "x", description: "", experience: { min: 3, max: null }, responsibilities: ["Run on-call"],
      required_skills: ["Go", "Postgres"], preferred_skills: ["Kafka", "Go"],
      requirements: { summary: "", seniority: "senior", responsibilities: ["Lead the payments team"], experience: { minimum_years: 5, maximum_years: null },
        skills: [{ name: "Go", importance: "required" }, { name: "Terraform", importance: "preferred" }] },
    });
    expect(lines.must).toEqual(["Go", "Postgres", "At least 5 years of relevant experience", "Lead the payments team"]);
    expect(lines.nice).toEqual(["Terraform", "Kafka"]);
  });

  it("asks the final report for every requirement and a resume check, never a hiring decision", () => {
    expect(reportPrompt.system).toMatch(/EVERY must-have and nice-to-have/);
    expect(reportPrompt.system).toMatch(/Never recommend hire\/reject/);
    const text = reportPrompt.buildUser({ jobTitle: "EM", jobSummary: null, requirements: { must: ["Go"], nice: [] }, resume: null, answerQuality: "3 questions", sections: [], evidenceIndex: "" });
    expect(text).toContain("Must-haves:\n- Go");
    expect(text).toContain("Resume: not provided");
  });
});
