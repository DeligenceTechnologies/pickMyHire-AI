import "server-only";
import { classifyReply } from "@/lib/interview/repeat";
// Deterministic stand-ins used when no OpenAI key is configured (demo mode) and
// in automated tests. They only reuse data that is actually present in the
// input; they never fabricate candidate facts. The UI labels demo-mode output.

import type {
  AnswerAnalysis,
  FinalReport,
  FollowupDecision,
  InterviewPlanAI,
  JobRequirements,
  ResumeProfile,
  SectionEvaluation,
  Assessment,
} from "@/lib/validation/ai-schemas";
import type { PlannerSectionInput } from "@/prompts/interview-planner/v1";

const SKILL_DICTIONARY = [
  "JavaScript", "TypeScript", "React", "Next.js", "Node.js", "Express", "Python", "Django", "Flask", "FastAPI",
  "Java", "Spring", "Kotlin", "Go", "Rust", "C#", ".NET", "Ruby", "Rails", "PHP", "Laravel", "Swift", "iOS", "Android",
  "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "Kafka", "RabbitMQ", "GraphQL", "REST",
  "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "CI/CD", "Linux", "Microservices",
  "Machine Learning", "PyTorch", "TensorFlow", "Data Engineering", "Spark", "Airflow", "Stripe", "Tailwind",
  "HTML", "CSS", "Vue", "Angular", "Svelte", "Figma", "Agile", "Scrum", "Product Management", "Sales", "Marketing",
];

function findSkills(text: string): string[] {
  const found = new Set<string>();
  for (const skill of SKILL_DICTIONARY) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\/#]/g, "\\$&");
    if (new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`, "i").test(text)) found.add(skill);
  }
  return [...found];
}

function findYears(text: string): number | null {
  const m = text.match(/(\d{1,2})\+?\s*(?:years|yrs)/i);
  return m ? Number(m[1]) : null;
}

export function mockParseResume(text: string): ResumeProfile {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? null;
  const name = first && first.split(/\s+/).length <= 5 && !/[@\d]/.test(first) ? first : null;
  const companies = [...new Set(
    lines.flatMap((l) => [...l.matchAll(/\bat\s+([A-Z][A-Za-z0-9&.\- ]{1,40})/g)].map((m) => m[1].trim())),
  )].slice(0, 8);
  const achievements = lines.filter((l) => /\d+%|\$\d|reduced|increased|improved|launched|led /i.test(l)).slice(0, 6);
  const education = lines.filter((l) => /university|college|b\.?s\.?|m\.?s\.?|bachelor|master|ph\.?d/i.test(l)).slice(0, 4);
  return {
    name,
    headline: lines[1] && lines[1].length < 120 ? lines[1] : null,
    years_experience: findYears(text),
    skills: findSkills(text),
    companies,
    roles: [],
    projects: [],
    responsibilities: [],
    achievements,
    education,
    certifications: lines.filter((l) => /certif/i.test(l)).slice(0, 4),
    uncertainties: ["Parsed in demo mode (no OpenAI key). Roles and projects were not extracted — review the resume directly."],
  };
}

export function mockParseJob(input: { title: string; description: string; required: string[]; preferred: string[] }): JobRequirements {
  const detected = findSkills(`${input.title}\n${input.description}`);
  const required = new Set(input.required);
  const preferred = new Set(input.preferred);
  for (const s of detected) if (!required.has(s) && !preferred.has(s)) required.add(s);
  const responsibilities = input.description
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length > 15 && l.length < 160)
    .slice(0, 8);
  const title = input.title.toLowerCase();
  const seniority: JobRequirements["seniority"] = /principal/.test(title) ? "principal" : /staff/.test(title) ? "staff"
    : /senior|sr\.?/.test(title) ? "senior" : /junior|jr\.?/.test(title) ? "junior" : /manager|head/.test(title) ? "manager" : "unknown";
  return {
    summary: `${input.title} role. (Parsed in demo mode.)`,
    skills: [
      ...[...required].map((name) => ({ name, importance: "required" as const })),
      ...[...preferred].map((name) => ({ name, importance: "preferred" as const })),
    ],
    experience: { minimum_years: findYears(input.description), maximum_years: null },
    responsibilities,
    seniority,
  };
}

export function mockPlan(input: {
  jobTitle: string;
  requirements: JobRequirements | null;
  profile: ResumeProfile | null;
  sections: PlannerSectionInput[];
}): InterviewPlanAI {
  const skills = input.requirements?.skills.filter((s) => s.importance === "required").map((s) => s.name) ?? [];
  const candidateSkills = input.profile?.skills ?? [];
  const overlap = skills.filter((s) => candidateSkills.includes(s));
  const topSkill = overlap[0] ?? skills[0] ?? candidateSkills[0] ?? null;
  const company = input.profile?.companies[0] ?? null;

  const bank = (name: string): { q: string; resume: boolean }[] => {
    const n = name.toLowerCase();
    if (n.includes("intro")) return [
      { q: `To start, could you give me a brief overview of your background and what interests you about this ${input.jobTitle} role?`, resume: false },
      { q: "What kind of work are you most looking to do in your next position?", resume: false },
    ];
    if (n.includes("experience") || n.includes("career")) return [
      company
        ? { q: `Your resume mentions ${company}. What was your role there, and what were you responsible for day to day?`, resume: true }
        : { q: "Walk me through your most recent role. What were you responsible for day to day?", resume: false },
      { q: "Which accomplishment from your career are you most proud of, and what was your specific contribution?", resume: false },
      { q: "How has your scope of responsibility grown over your last two roles?", resume: false },
    ];
    if (n.includes("project")) return [
      { q: "Tell me about the most technically challenging project you've worked on. What was the goal and what did you personally own?", resume: false },
      { q: "In that project, what was one important technical decision you made, and what trade-offs did you consider?", resume: false },
      { q: "What went wrong in production on a project you owned, and how did you handle it?", resume: false },
    ];
    if (n.includes("technical") || n.includes("skill")) return [
      topSkill
        ? { q: `Let's talk about ${topSkill}. Can you describe how you've used it in a real project and a problem you solved with it?`, resume: overlap.length > 0 }
        : { q: "Which technical skill is strongest for you, and how have you applied it in a real project?", resume: false },
      { q: `How would you design a reliable, scalable system for a core feature of a ${input.jobTitle}'s work? Walk me through the main components.`, resume: false },
      { q: "How do you ensure the quality of what you ship — testing, reviews, monitoring?", resume: false },
    ];
    if (n.includes("problem")) return [
      { q: "Imagine a key service suddenly becomes slow for users after a deployment. How would you investigate and resolve it?", resume: false },
      { q: "Tell me about a time you had to solve a problem with incomplete information. How did you approach it?", resume: false },
    ];
    if (n.includes("behav")) return [
      { q: "Tell me about a time you disagreed with a teammate or stakeholder. How did you handle it and what was the outcome?", resume: false },
      { q: "Describe a situation where you had to deliver under a tight deadline. What did you prioritize?", resume: false },
    ];
    if (n.includes("question")) return [
      { q: "That covers my questions. What questions do you have about the role or the next steps in the process?", resume: false },
    ];
    return [
      { q: `Could you share an example from your experience that relates to ${name.toLowerCase()}?`, resume: false },
      { q: "What did you learn from that, and what would you do differently next time?", resume: false },
    ];
  };

  return {
    sections: input.sections.map((s) => {
      const count = Math.max(1, Math.min(s.max_questions, Math.max(s.min_questions, 2)));
      const qs = bank(s.name).slice(0, count);
      return {
        section_index: s.section_index,
        name: s.name,
        objective: s.objective,
        questions: qs.map(({ q, resume }) => ({
          question: q,
          intent: s.objective || `Assess ${s.name.toLowerCase()}`,
          evaluation_criteria: s.evaluation_criteria.length ? s.evaluation_criteria.slice(0, 4) : ["Relevance", "Specificity"],
          followup_topics: ["personal contribution", "specific example", "outcome and impact"],
          references_resume: resume,
        })),
      };
    }),
  };
}

export function mockAnalyzeAnswer(answer: string): AnswerAnalysis {
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;
  const kind = classifyReply(answer);
  const clarify = kind === "repeat" || kind === "clarify";
  const completeness: AnswerAnalysis["completeness"] = words === 0 ? "no_answer" : words < 15 ? "minimal" : words < 45 ? "partial" : "complete";
  return {
    relevance: words === 0 ? "low" : "medium",
    completeness,
    evidence: words > 0 ? [`Candidate answered in about ${words} words.`] : [],
    missing_evidence: completeness === "complete" ? [] : ["Specific example", "Personal contribution"],
    followup_needed: clarify || completeness === "partial" || completeness === "minimal",
    candidate_asked_for_clarification: clarify,
    summary: words === 0 ? "No answer was given." : `Answer of ${words} words (demo-mode heuristic analysis).`,
  };
}

export function mockFollowup(input: { question: string; followupsUsed: number; clarification: boolean }): FollowupDecision {
  if (input.clarification) {
    return {
      action: "follow_up",
      reason: "Candidate asked for clarification",
      missing_evidence: [],
      question: `Of course. Put simply: ${input.question}`,
      transition: null,
    };
  }
  const options = [
    "Could you walk me through a specific example — what did you personally do, and what was the outcome?",
    "What was the most difficult part of that, and how did you handle it?",
  ];
  return {
    action: "follow_up",
    reason: "Answer lacked a concrete example (demo-mode heuristic)",
    missing_evidence: ["Specific example"],
    question: options[Math.min(input.followupsUsed, options.length - 1)],
    transition: "Thanks.",
  };
}

type Seg = { ref: string; speaker: string; text: string; start: number; end: number };

export function mockEvaluateSection(segments: Seg[]): SectionEvaluation {
  const cand = segments.filter((s) => s.speaker === "candidate");
  const words = cand.reduce((acc, s) => acc + s.text.split(/\s+/).filter(Boolean).length, 0);
  const assessment: Assessment = words === 0 ? "insufficient_evidence" : words < 40 ? "limited" : words < 150 ? "adequate" : "strong";
  const top = [...cand].sort((a, b) => b.text.length - a.text.length).slice(0, 2);
  return {
    assessment,
    summary: words === 0
      ? "The candidate did not provide answers in this section."
      : `The candidate spoke about ${words} words across ${cand.length} answer segment(s). Demo-mode assessment is based on answer volume only — review the transcript.`,
    strengths: words >= 40 ? ["Provided substantive answers in this section"] : [],
    concerns: words < 40 ? ["Little detail was provided"] : [],
    criteria: [],
    evidence: top.map((s) => ({
      segment_ref: s.ref,
      timestamp_start_ms: s.start,
      timestamp_end_ms: s.end,
      quote_or_paraphrase: s.text.length > 160 ? s.text.slice(0, 157) + "..." : s.text,
      supports: "Representative answer",
    })),
  };
}

export function mockReport(sections: { name: string; assessment: Assessment; evidence: SectionEvaluation["evidence"] }[]): FinalReport {
  const evidence = sections.flatMap((s) => s.evidence).slice(0, 6);
  return {
    summary: `Interview covered ${sections.length} section(s). This summary was generated in demo mode (no OpenAI key configured) and reflects answer volume only; please review the transcript and recording.`,
    strengths: sections
      .filter((s) => s.assessment === "strong" || s.assessment === "very_strong")
      .map((s) => ({ point: `Detailed answers in ${s.name}`, evidence_refs: s.evidence.map((e) => e.segment_ref).filter((r): r is string => !!r) })),
    areas_to_explore: sections
      .filter((s) => s.assessment === "limited" || s.assessment === "insufficient_evidence")
      .map((s) => ({ point: `Limited evidence in ${s.name}`, reason: "Answers in this section were brief or missing." })),
    key_evidence: evidence.map((e) => ({
      claim: e.supports,
      segment_ref: e.segment_ref,
      timestamp_start_ms: e.timestamp_start_ms,
      timestamp_end_ms: e.timestamp_end_ms,
      quote_or_paraphrase: e.quote_or_paraphrase,
    })),
    missing_evidence: [],
    fact_vs_interpretation_note: "Demo mode: assessments are heuristic, not AI-generated.",
  };
}
