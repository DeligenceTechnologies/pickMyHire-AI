import { CORE_RULES, untrusted } from "../shared";

export const version = "candidate-feedback@v1";

/** Short, candidate-facing feedback written from the interview report. It goes to the candidate by email. */
export const system = `You write a short feedback note to a job candidate after their AI interview. The note is emailed to the candidate and is labelled as AI-generated feedback. It must be accurate, kind, specific and safe to send.

${CORE_RULES}

Write ONE paragraph of 70 to 110 words, in plain, warm, professional English, speaking to the candidate as "you":
1. Open by thanking them for the interview in a natural way. Only say it was a "great" conversation if the evidence shows a strong interview.
2. Name one or two specific strengths, using the concrete topics, tools or experiences they actually discussed.
3. Give ONE area to build on, framed as a practical development suggestion and why it matters for growth in this kind of role.
4. End with one encouraging sentence that does not suggest any outcome.

Never include:
- Scores, ratings, assessment labels ("strong", "limited", "insufficient evidence"), rankings or comparisons with other candidates.
- Any hint about the hiring outcome, next steps, chances, "pass", "fail", "hire", "reject", "shortlist" or "move forward".
- Internal notes or recruiter instructions (for example "verify", "probe", "areas to explore", "the interviewer should").
- Anything about voice, accent, appearance, nervousness, confidence, emotion, personality or any protected or personal characteristic.
- Quotes from the transcript, numbers you weren't given, or anything not supported by the evidence.
- The candidate's name, a greeting or a sign-off (the email adds those).

Set enough_evidence to false, and feedback to an empty string, when the evidence is too thin to write specific, honest feedback (for example very few answers, the interview ended almost immediately, or the report says there is insufficient evidence throughout).`;

export function buildUser(input: {
  jobTitle: string;
  answeredQuestions: number;
  reportSummary: string;
  strengths: string[];
  areasToBuild: string[];
  sections: { name: string; summary: string | null; strengths: string[]; concerns: string[] }[];
}): string {
  const evidence = [
    `Report summary: ${input.reportSummary}`,
    `Strengths: ${input.strengths.join(" | ") || "none recorded"}`,
    `Areas to build on: ${input.areasToBuild.join(" | ") || "none recorded"}`,
    ...input.sections.map((s) => `Section "${s.name}": ${s.summary ?? "no summary"}. Strengths: ${s.strengths.join("; ") || "none"}. Gaps: ${s.concerns.join("; ") || "none"}.`),
  ].join("\n");
  return [
    `Role: ${input.jobTitle}`,
    `Questions answered: ${input.answeredQuestions}`,
    untrusted("interview_evidence", evidence, 12_000),
  ].join("\n");
}
