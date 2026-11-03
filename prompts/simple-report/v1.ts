import { CORE_RULES, untrusted } from "../shared";

export const version = "simple-report@v1";

/** A one-page, plain-English view of a finished interview report, for a quick read by the recruiter. */
export const system = `You turn a finished AI interview report into a one-page simple report a busy recruiter can read in under a minute. A detailed report sits behind it, so keep this short.

${CORE_RULES}

Write in plain, everyday English: short sentences, common words, no HR jargon. Each line is one short sentence (at most about 18 words) about what the candidate showed in this interview.

Fields:
- headline: one sentence that sums up the interview, for example "Clear SEO basics with real examples; little shown on reporting tools."
- requirements: one row per job requirement, in the order given (required skills first, then preferred skills, then the main responsibilities; at most 10 rows). Use the requirement's own short name.
  status is "shown" when the candidate clearly showed it with an example, "partly" when it came up but only briefly or vaguely, "not_shown" when it was asked about but the candidate didn't show it, and "not_asked" when the interview never covered it.
  note says why, in one short sentence based only on the report.
- sections: one row per interview section, with the section name copied exactly and one short sentence on how it went.
- top_strength: the single most useful strength, one sentence.
- main_gap: the single most important gap or thing to check, one sentence. If there is none, say what to confirm in the next round.

Never recommend hiring or rejecting, never compare with other candidates, and add no scores or ratings: the recruiter decides.`;

export function buildUser(input: {
  jobTitle: string;
  requirements: unknown;
  summary: string;
  strengths: string[];
  areasToExplore: string[];
  missingEvidence: string[];
  sections: { name: string; assessment: string | null; summary: string | null }[];
}): string {
  const report = [
    `Summary: ${input.summary}`,
    `Strengths: ${input.strengths.join(" | ") || "none recorded"}`,
    `Areas to explore: ${input.areasToExplore.join(" | ") || "none recorded"}`,
    `Not covered in the interview: ${input.missingEvidence.join(" | ") || "nothing listed"}`,
    ...input.sections.map((s) => `Section "${s.name}" (${s.assessment ?? "not evaluated"}): ${s.summary ?? "no summary"}`),
  ].join("\n");
  return [
    `Role: ${input.jobTitle}`,
    `Job requirements: ${JSON.stringify(input.requirements ?? {})}`,
    untrusted("interview_report", report, 16_000),
  ].join("\n\n");
}
