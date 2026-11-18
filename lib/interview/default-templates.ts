import type { TemplateInput } from "@/types/interview";

export const DEFAULT_TEMPLATES: TemplateInput[] = [
  {
    // 40 minutes in total, so it counts as one interview (see minutesPerInterview in lib/pricing.ts).
    name: "Senior Full Stack Engineer Interview",
    description: "Structured technical interview covering experience, a project deep dive, technical skills, problem solving and behavioral competencies.",
    sections: [
      { name: "Introduction", description: "Warm-up and background", objective: "Understand the candidate's background and motivation for the role", instructions: "", duration_minutes: 4, min_questions: 1, max_questions: 2, max_followups: 1, evaluation_criteria: ["Relevant background", "Clarity of motivation"], scoring_enabled: false, enabled: true },
      { name: "Career Experience", description: "", objective: "Validate relevant experience, scope and progression", instructions: "", duration_minutes: 6, min_questions: 2, max_questions: 3, max_followups: 2, evaluation_criteria: ["Relevant experience", "Scope of responsibility", "Impact"], scoring_enabled: true, enabled: true },
      { name: "Project Deep Dive", description: "", objective: "Validate hands-on ownership and technical depth", instructions: "Probe personal contribution versus team contribution.", duration_minutes: 8, min_questions: 2, max_questions: 4, max_followups: 2, evaluation_criteria: ["Ownership", "Technical depth", "Decision making", "Problem solving"], scoring_enabled: true, enabled: true },
      { name: "Technical Skills", description: "", objective: "Assess depth in the role's required technologies", instructions: "", duration_minutes: 10, min_questions: 2, max_questions: 4, max_followups: 2, evaluation_criteria: ["Depth in required skills", "System design", "Engineering practices"], scoring_enabled: true, enabled: true },
      { name: "Problem Solving", description: "", objective: "Assess structured reasoning on realistic scenarios", instructions: "", duration_minutes: 6, min_questions: 1, max_questions: 2, max_followups: 2, evaluation_criteria: ["Structured approach", "Trade-off analysis", "Debugging methodology"], scoring_enabled: true, enabled: true },
      { name: "Behavioral", description: "", objective: "Assess collaboration, communication and ownership", instructions: "Use situation-based questions.", duration_minutes: 4, min_questions: 1, max_questions: 2, max_followups: 1, evaluation_criteria: ["Collaboration", "Communication clarity", "Accountability"], scoring_enabled: true, enabled: true },
      { name: "Candidate Questions", description: "", objective: "Give the candidate a chance to ask questions", instructions: "Do not answer company-specific questions you don't have information for; say the hiring team will follow up.", duration_minutes: 2, min_questions: 1, max_questions: 1, max_followups: 0, evaluation_criteria: [], scoring_enabled: false, enabled: true },
    ],
  },
  {
    name: "Quick Screening (15 min)",
    description: "Short first-round screen focused on experience and role fit.",
    sections: [
      { name: "Introduction", description: "", objective: "Understand background and motivation", instructions: "", duration_minutes: 3, min_questions: 1, max_questions: 1, max_followups: 1, evaluation_criteria: ["Relevant background"], scoring_enabled: false, enabled: true },
      { name: "Experience", description: "", objective: "Validate the most relevant experience for the role", instructions: "", duration_minutes: 7, min_questions: 2, max_questions: 3, max_followups: 2, evaluation_criteria: ["Relevant experience", "Ownership", "Impact"], scoring_enabled: true, enabled: true },
      { name: "Role Fit", description: "", objective: "Assess alignment with the role's key requirements", instructions: "", duration_minutes: 4, min_questions: 1, max_questions: 2, max_followups: 1, evaluation_criteria: ["Required skills coverage", "Communication clarity"], scoring_enabled: true, enabled: true },
      { name: "Candidate Questions", description: "", objective: "Give the candidate a chance to ask questions", instructions: "", duration_minutes: 1, min_questions: 1, max_questions: 1, max_followups: 0, evaluation_criteria: [], scoring_enabled: false, enabled: true },
    ],
  },
];
