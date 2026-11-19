import type { Stage } from "@/lib/hiring";
import type { RoundResult } from "@/lib/services/pipeline";

/** Where a person is in one job's hiring, from the first touch to the end. */
export const JOB_STAGES = ["to_invite", "invited", "interviewing", "review", "shortlisted", "hired", "rejected"] as const;
export type JobStage = (typeof JOB_STAGES)[number];

export const JOB_STAGE_LABEL: Record<JobStage, string> = {
  to_invite: "Not invited", invited: "Invited", interviewing: "Interviewing", review: "Ready to review",
  shortlisted: "Shortlisted", hired: "Hired", rejected: "Rejected",
};

export const JOB_STAGE_HINT: Record<JobStage, string> = {
  to_invite: "Applied or added, no interview yet",
  invited: "Invitation sent, not started",
  interviewing: "Taking an interview now, or one is scheduled",
  review: "Interview done: review it and decide, or invite to the next round",
  shortlisted: "Shortlisted for this job",
  hired: "Hired for this job",
  rejected: "Not moving forward or withdrew",
};

/**
 * The groups the job page counts and filters by, in hiring order. "Interviewing" covers both an invite
 * that's waiting and an interview in progress. Together they add up to every active (not rejected) person.
 */
export const STAGE_GROUPS = [
  { id: "to_invite", label: "Not invited", hint: "No interview sent yet", stages: ["to_invite"] },
  { id: "interview", label: "Interviewing", hint: "Invited or taking the interview", stages: ["invited", "interviewing"] },
  { id: "review", label: "Ready to review", hint: "Interview done, needs your decision", stages: ["review"] },
  { id: "shortlisted", label: "Shortlisted", hint: "Moving forward", stages: ["shortlisted"] },
  { id: "hired", label: "Hired", hint: "Hired for this job", stages: ["hired"] },
  { id: "rejected", label: "Rejected", hint: "Not moving forward or withdrew", stages: ["rejected"] },
] as const satisfies readonly { id: string; label: string; hint: string; stages: readonly JobStage[] }[];
export type StageGroup = (typeof STAGE_GROUPS)[number]["id"];
export const stageGroup = (id: string) => STAGE_GROUPS.find((g) => g.id === id);
/** Is a person at `stage` in group `id`? */
export const inStageGroup = (id: StageGroup, stage: JobStage) => (stageGroup(id)?.stages as readonly JobStage[] | undefined)?.includes(stage) ?? false;

const INVITED = ["created", "invited", "consent_pending", "device_check", "ready"];
const LIVE = ["in_progress", "completing"];
const DONE = ["completed", "processing", "report_ready"];

export function jobStageOf(p: {
  pipeline_stage: Stage | null; application_status: string | null; interview_status: string | null; results: RoundResult[];
}): JobStage {
  if (p.pipeline_stage === "hired") return "hired";
  if (p.pipeline_stage === "shortlisted") return "shortlisted";
  if (p.pipeline_stage === "rejected" || p.pipeline_stage === "withdrawn" || p.application_status === "declined") return "rejected";
  const iv = p.interview_status;
  if (iv && LIVE.includes(iv)) return "interviewing";
  if (p.results.some((r) => r.state === "waiting" && r.entry?.kind === "human")) return "interviewing";
  if (iv && INVITED.includes(iv)) return "invited";
  if (p.results.some((r) => r.state === "waiting" && r.entry?.kind === "ai" && LIVE.includes(r.entry.status))) return "interviewing";
  if (p.results.some((r) => r.state === "waiting")) return "invited";
  if ((iv && DONE.includes(iv)) || p.results.some((r) => r.state === "done")) return "review";
  return "to_invite";
}
