import { describe, expect, it } from "vitest";
import { JOB_STAGES, STAGE_GROUPS, jobStageOf } from "@/lib/jobs/job-stages";
import type { RoundResult } from "@/lib/services/pipeline";

const round = { id: "r1", job_id: "j", name: "AI screen", kind: "ai" as const, sort_order: 0 };
const entry = (kind: "ai" | "human", status: string) => ({
  kind, id: "e", job_id: "j", candidate_id: "c", round_id: "r1", round_name: "AI screen", attempt: 1, status, created_at: new Date(), at: null, timezone: null,
  decision: null, decision_note: null, decided_at: null, decided_by_name: null,
});
const base = { pipeline_stage: null, application_status: null, interview_status: null, results: [] as RoundResult[] };

describe("where a person is in a job", () => {
  it("puts new applicants and added people with no interview in Not invited", () => {
    expect(jobStageOf({ ...base, application_status: "new" })).toBe("to_invite");
    expect(jobStageOf({ ...base, pipeline_stage: "in_progress" })).toBe("to_invite");
    expect(jobStageOf({ ...base, interview_status: "cancelled" })).toBe("to_invite");
  });

  it("follows the latest interview", () => {
    expect(jobStageOf({ ...base, interview_status: "invited" })).toBe("invited");
    expect(jobStageOf({ ...base, interview_status: "in_progress" })).toBe("interviewing");
    expect(jobStageOf({ ...base, interview_status: "report_ready" })).toBe("review");
  });

  it("counts a scheduled human round as interviewing and a decided round as to review", () => {
    expect(jobStageOf({ ...base, results: [{ round, decision: null, state: "waiting", entry: entry("human", "scheduled") }] })).toBe("interviewing");
    expect(jobStageOf({ ...base, results: [{ round, decision: "qualified", state: "done", entry: entry("ai", "report_ready") }] })).toBe("review");
  });

  it("uses the hiring decision first", () => {
    expect(jobStageOf({ ...base, pipeline_stage: "shortlisted", interview_status: "in_progress" })).toBe("shortlisted");
    expect(jobStageOf({ ...base, pipeline_stage: "hired" })).toBe("hired");
    expect(jobStageOf({ ...base, pipeline_stage: "withdrawn" })).toBe("rejected");
    expect(jobStageOf({ ...base, application_status: "declined" })).toBe("rejected");
  });
});

describe("the job page's stage groups", () => {
  it("put every stage in exactly one group, so the cards add up", () => {
    const grouped = STAGE_GROUPS.flatMap((g) => g.stages as readonly string[]);
    expect([...grouped].sort()).toEqual([...JOB_STAGES].sort());
  });
});
