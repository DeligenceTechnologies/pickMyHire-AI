import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { withOrg } from "@/lib/database/db";
import { can, type Role } from "./permissions";

// Which jobs a team member may see. Owners, Admins, Recruiters and Viewers see every job; Interviewers
// see only the jobs whose hiring team they're on (job_members): those jobs' candidates, interviews,
// reports and recordings. Every page and API that shows job data checks here, so nothing is missed.

type Who = { orgId: string; userId: string; role: Role };

const scopeFor = cache(async (orgId: string, userId: string): Promise<string[]> => {
  const rows = await withOrg(orgId, (tx) => tx<{ job_id: string }[]>`
    select job_id from job_members where organization_id = ${orgId} and user_id = ${userId}`);
  return rows.map((r) => r.job_id);
});

/** The job ids this person may see, or null for every job. */
export async function jobScope(who: Who): Promise<string[] | null> {
  return can(who.role, "job:all") ? null : scopeFor(who.orgId, who.userId);
}

export async function canSeeJob(who: Who, jobId: string): Promise<boolean> {
  const scope = await jobScope(who);
  return !scope || scope.includes(jobId);
}

/** APIs: a job this person can't see is "not found", so its existence isn't revealed. */
export async function assertJobAccess(who: Who, jobId: string) {
  if (!(await canSeeJob(who, jobId))) throw new ApiError(404, "Not found");
}

/** Pages: same, as the 404 page. */
export async function requireJobAccess(who: Who, jobId: string) {
  if (!(await canSeeJob(who, jobId))) notFound();
}

async function interviewJob(orgId: string, interviewId: string) {
  const [r] = await withOrg(orgId, (tx) => tx<{ job_id: string }[]>`
    select job_id from interviews where id = ${interviewId} and organization_id = ${orgId}`);
  return r?.job_id ?? null;
}

/** An AI interview's pages and files: only for people who can see its job. */
export async function assertInterviewAccess(who: Who, interviewId: string) {
  if (can(who.role, "job:all")) return;
  const jobId = await interviewJob(who.orgId, interviewId);
  if (!jobId || !(await canSeeJob(who, jobId))) throw new ApiError(404, "Interview not found");
}

/** The jobs (of those this person may see) a candidate is in, or null when every job is visible. */
export async function candidateJobsInScope(who: Who, candidateId: string): Promise<string[] | null> {
  const scope = await jobScope(who);
  if (!scope) return null;
  if (!scope.length) return [];
  const rows = await withOrg(who.orgId, (tx) => tx<{ job_id: string }[]>`
    select job_id from job_candidates where candidate_id = ${candidateId} and job_id = any(${scope})
    union select job_id from job_applications where candidate_id = ${candidateId} and job_id = any(${scope})
    union select job_id from interviews where candidate_id = ${candidateId} and job_id = any(${scope})`);
  return rows.map((r) => r.job_id);
}

/** A candidate's profile and files: only for people who can see one of the candidate's jobs. */
export async function assertCandidateAccess(who: Who, candidateId: string) {
  const jobs = await candidateJobsInScope(who, candidateId);
  if (jobs && !jobs.length) throw new ApiError(404, "Candidate not found");
}
