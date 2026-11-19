import type { Stage } from "@/lib/hiring";
import type { RoundResult } from "@/lib/services/pipeline";

/** Where a person is in one job's hiring, from the first touch to the end. */
export const JOB_STAGES = ["to_invite", "invited", "interviewing", "review", "shortlisted", "hired", "rejected"] as const;
export type JobStage = (typeof JOB_STAGES)[number];

export const JOB_STAGE_LABEL: Record<JobStage, string> = {
  to_invite: "To invite", invited: "Invited", interviewing: "Interviewing", review: "To review",
  shortlisted: "Shortlisted", hired: "Hired", rejected: "Rejected",
};

export const JOB_STAGE_HINT: Record<JobStage, string> = {
  to_invite: "Applied or added, no interview yet",
  invited: "Invitation sent, not started",
  interviewing: "Taking an interview now, or one is scheduled",
  review: "A round is done: decide, or invite to the next round",
  shortlisted: "Shortlisted for this job",
  hired: "Hired for this job",
  rejected: "Not moving forward or withdrew",
};

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
