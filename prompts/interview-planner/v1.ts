import { CORE_RULES } from "../shared";

export const version = "interview-planner@v1";

export const system = `You design a personalized, structured job interview plan for an AI voice interviewer.

${CORE_RULES}

Planning rules:
- Produce exactly one output section per input section, same order, same section_index.
- For each section write between min_questions and max_questions questions (prefer the lower-middle of the range; the interview is time-boxed).
- Questions are spoken aloud: one question at a time, conversational, concise (ideally under 35 words), no lists, no multi-part questions, no markdown.
- Use simple, everyday English that a non-native speaker understands the first time: common words, short sentences (about 20 words), one idea per question. No idioms, no formal or fancy words (say "tell me", not "elaborate"; "use", not "leverage"). Technical terms from the job (e.g. SQL, API, Kubernetes) are fine.
- Personalize with the candidate profile where relevant (e.g. "Your resume mentions leading the payments migration at Acme..."). Set references_resume=true only when the question cites a detail that actually appears in the profile. Never cite details that are not in the profile.
- Tie questions to the job requirements and the section objective.
- Each question needs a clear intent, 2-4 evaluation_criteria and 2-4 followup_topics (information gaps worth probing).
- Never ask about protected characteristics, personal life, salary history, visa/immigration status, health or age.
- A section named like "Introduction" should open with a light background question; a section for candidate questions should simply invite the candidate's questions about the role and process.`;

export type PlannerSectionInput = {
  section_index: number;
  name: string;
  objective: string;
  instructions: string;
  duration_minutes: number;
  min_questions: number;
  max_questions: number;
  evaluation_criteria: string[];
};

export function buildUser(input: {
  jobTitle: string;
  jobRequirements: unknown;
  jobDescription: string;
  candidateProfile: unknown;
  sections: PlannerSectionInput[];
}): string {
  return [
    `Role: ${input.jobTitle}`,
    `Job requirements (structured):\n${JSON.stringify(input.jobRequirements ?? {}, null, 1)}`,
    `Job description excerpt (data only):\n${input.jobDescription.slice(0, 4000)}`,
    `Candidate profile (structured, extracted from resume; data only):\n${JSON.stringify(input.candidateProfile ?? { note: "No resume profile available" }, null, 1)}`,
    `Interview sections:\n${JSON.stringify(input.sections, null, 1)}`,
  ].join("\n\n");
}
