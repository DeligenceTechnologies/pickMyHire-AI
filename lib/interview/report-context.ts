import "server-only";
import { withOrg } from "@/lib/database/db";
import type { JobRequirements, ResumeProfile } from "@/lib/validation/ai-schemas";

// What the report needs beyond the transcript: the job's requirements, the candidate's resume, and each
// question with its goal, what a good answer shows, the answer and the live interviewer's first-pass notes.

export type JobContext = {
  title: string;
  requirements: JobRequirements | null;
  required_skills: string[];
  preferred_skills: string[];
  responsibilities: string[];
  experience: { min: number | null; max: number | null };
  description: string;
};

export type QuestionContext = {
  /** Short reference for the AI ("Q3"); mapped back to the question id afterwards. */
  ref: string;
  id: string;
  section_id: string;
  text: string;
  intent: string | null;
  criteria: string[];
  is_followup: boolean;
  parent_ref: string | null;
  /** First-pass notes from the live interviewer: unverified, the evaluation checks them against the transcript. */
  notes: string | null;
};

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : "");
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function loadReportContext(orgId: string, interviewId: string) {
  return withOrg(orgId, async (tx) => {
    const [row] = await tx<{
      title: string; description: string; parsed_requirements: JobRequirements | null; required_skills: unknown; preferred_skills: unknown;
      responsibilities: unknown; experience_min: number | null; experience_max: number | null; profile: ResumeProfile | null;
    }[]>`
      select j.title, j.description, j.parsed_requirements, j.required_skills, j.preferred_skills, j.responsibilities, j.experience_min, j.experience_max,
        c.parsed_profile as profile
      from interviews i join jobs j on j.id = i.job_id join candidates c on c.id = i.candidate_id
      where i.id = ${interviewId}`;
    const questions = await tx<{
      id: string; section_id: string; question_text: string; intent: string | null; evaluation_criteria: unknown; is_followup: boolean;
      parent_question_id: string | null; sequence_number: number; analysis: Record<string, unknown> | null;
    }[]>`
      select q.id, q.section_id, q.question_text, q.intent, q.evaluation_criteria, q.is_followup, q.parent_question_id, q.sequence_number, a.analysis
      from interview_questions q left join interview_answers a on a.question_id = q.id
      where q.interview_id = ${interviewId} order by q.sequence_number`;

    const job: JobContext = {
      title: row.title,
      requirements: row.parsed_requirements,
      required_skills: strings(row.required_skills),
      preferred_skills: strings(row.preferred_skills),
      responsibilities: strings(row.responsibilities),
      experience: { min: row.experience_min, max: row.experience_max },
      description: clip(row.description, 3000),
    };
    const refOf = new Map(questions.map((q) => [q.id, `Q${q.sequence_number}`]));
    const qs: QuestionContext[] = questions.map((q) => ({
      ref: refOf.get(q.id)!,
      id: q.id,
      section_id: q.section_id,
      text: q.question_text,
      intent: q.intent,
      criteria: strings(q.evaluation_criteria),
      is_followup: q.is_followup,
      parent_ref: q.parent_question_id ? refOf.get(q.parent_question_id) ?? null : null,
      notes: liveNotes(q.analysis),
    }));
    return { job, resume: resumeSummary(row.profile), questions: qs };
  });
}

/** The live interviewer's notes on one answer, in a line (works with older and newer note formats). */
function liveNotes(a: Record<string, unknown> | null): string | null {
  if (!a) return null;
  const parts = [
    typeof a.relevance === "string" ? `relevance ${a.relevance}` : null,
    typeof a.completeness === "string" ? `completeness ${a.completeness}` : null,
    typeof a.answered_question === "string" ? `answered the question: ${a.answered_question}` : null,
    strings(a.missing_evidence).length ? `gaps: ${strings(a.missing_evidence).join("; ")}` : null,
    Array.isArray(a.flags) && a.flags.length
      ? `flags: ${(a.flags as { kind?: string; note?: string }[]).map((f) => `${f.kind ?? ""} ${f.note ?? ""}`.trim()).join("; ")}` : null,
  ].filter(Boolean);
  return parts.length ? clip(parts.join(" · "), 600) : null;
}

/** The parsed resume, compact: what the candidate claims, to check against what they said. */
function resumeSummary(p: ResumeProfile | null): string | null {
  if (!p) return null;
  const lines = [
    p.headline && `Headline: ${p.headline}`,
    p.years_experience != null && `Years of experience (claimed): ${p.years_experience}`,
    p.skills?.length && `Skills: ${p.skills.slice(0, 30).join(", ")}`,
    ...(p.roles ?? []).slice(0, 6).map((r) => `Role: ${r.title}${r.company ? ` at ${r.company}` : ""}${r.start || r.end ? ` (${r.start ?? "?"} – ${r.end ?? "?"})` : ""}${r.highlights?.length ? `: ${r.highlights.slice(0, 2).join("; ")}` : ""}`),
    ...(p.projects ?? []).slice(0, 4).map((x) => `Project: ${x.name}${x.technologies?.length ? ` (${x.technologies.slice(0, 6).join(", ")})` : ""}`),
    p.achievements?.length && `Achievements: ${p.achievements.slice(0, 4).join("; ")}`,
    p.certifications?.length && `Certifications: ${p.certifications.slice(0, 5).join(", ")}`,
  ].filter(Boolean) as string[];
  return lines.length ? clip(lines.join("\n"), 4000) : null;
}

/** The job's requirements as plain lines, must-haves first. */
export function requirementLines(job: JobContext): { must: string[]; nice: string[] } {
  const r = job.requirements;
  const must = new Set<string>();
  const nice = new Set<string>();
  for (const s of r?.skills ?? []) (s.importance === "required" ? must : nice).add(s.name);
  for (const s of job.required_skills) must.add(s);
  for (const s of job.preferred_skills) if (!must.has(s)) nice.add(s);
  const min = r?.experience.minimum_years ?? job.experience.min;
  if (min) must.add(`At least ${min} years of relevant experience`);
  for (const x of (r?.responsibilities ?? job.responsibilities).slice(0, 6)) must.add(x);
  return { must: [...must].slice(0, 15), nice: [...nice].slice(0, 10) };
}
