import "server-only";
import { json, withOrg } from "@/lib/database/db";
import { ApiError } from "@/lib/api";
import { reconcileMatch, screenApplicationAI, SCREENER_VERSION } from "@/lib/ai/application-screener";
import { runInBackground } from "@/lib/background";
import { log } from "@/lib/logger";
import { calculateExperience } from "@/lib/resume/experience";
import type { JobRequirements, ResumeProfile } from "@/lib/validation/ai-schemas";

// How well a candidate's resume fits a job, for candidates added by hand or invited directly (people who
// applied through the job's link are screened on their application). Uses the same AI check as applications.

export type JobMatch = {
  status: "pending" | "processing" | "completed" | "failed";
  level: string | null; met: number | null; total: number | null; summary: string | null;
  /** Where the result comes from: the job application, or a check of a candidate added by hand. */
  source: "application" | "candidate";
};

type JobRow = { title: string; description: string; parsed_requirements: JobRequirements | null; required_skills: string[]; preferred_skills: string[] };

/** The job's requirements, falling back to the skills entered on the job when the description hasn't been parsed. */
export function jobRequirements(j: JobRow): JobRequirements | null {
  if (j.parsed_requirements) return j.parsed_requirements;
  if (!j.required_skills.length && !j.preferred_skills.length) return null;
  return {
    summary: j.title,
    skills: [...j.required_skills.map((name) => ({ name, importance: "required" as const })), ...j.preferred_skills.map((name) => ({ name, importance: "preferred" as const }))],
    experience: { minimum_years: null, maximum_years: null },
    responsibilities: [],
    seniority: "unknown",
  };
}

/** The profile the screener sees, with the experience the platform calculated from the dates. */
export function profileForScreening(profile: ResumeProfile | null): ResumeProfile | null {
  if (!profile) return null;
  const { months } = calculateExperience(profile.roles, { statedYears: profile.years_experience });
  return { ...profile, years_experience: months === null ? profile.years_experience : Math.round((months / 12) * 10) / 10 };
}

/** The current result for a candidate and job, if any (an application's screening wins). */
export async function getMatch(orgId: string, candidateId: string, jobId: string): Promise<JobMatch | null> {
  const [row] = await withOrg(orgId, (tx) => tx<(JobMatch & { order: number })[]>`
    select * from (
      select a.screening_status::text as status, a.match_level as level, a.requirements_met as met, a.requirements_total as total,
        a.screening->>'summary' as summary, 'application' as source, 0 as order
      from job_applications a where a.candidate_id = ${candidateId} and a.job_id = ${jobId} and a.organization_id = ${orgId}
      union all
      select m.status::text, m.match_level, m.requirements_met, m.requirements_total, m.summary, 'candidate', 1
      from candidate_job_matches m where m.candidate_id = ${candidateId} and m.job_id = ${jobId} and m.organization_id = ${orgId}
    ) x order by x.order limit 1`);
  if (!row) return null;
  const { order: _order, ...match } = row;
  return match;
}

/**
 * Check a candidate's resume against a job and store the result. Skipped when they applied for the job
 * (their application has its own screening), unless there's no resume to check.
 */
export async function matchCandidate(orgId: string, candidateId: string, jobId: string): Promise<JobMatch | null> {
  const [ctx] = await withOrg(orgId, (tx) => tx<(JobRow & { parsed_profile: ResumeProfile | null; resume_text: string | null; applied: boolean })[]>`
    select j.title, j.description, j.parsed_requirements, j.required_skills, j.preferred_skills, c.parsed_profile, c.resume_text,
      exists (select 1 from job_applications a where a.candidate_id = c.id and a.job_id = j.id) as applied
    from candidates c join jobs j on j.id = ${jobId} and j.organization_id = c.organization_id
    where c.id = ${candidateId} and c.organization_id = ${orgId}`);
  if (!ctx) throw new ApiError(404, "Candidate or job not found");
  if (ctx.applied) return getMatch(orgId, candidateId, jobId);
  if (!ctx.resume_text) return null;
  await withOrg(orgId, (tx) => tx`
    insert into candidate_job_matches (organization_id, candidate_id, job_id, status) values (${orgId}, ${candidateId}, ${jobId}, 'processing')
    on conflict (candidate_id, job_id) do update set status = 'processing', error = null`);
  try {
    const { screening, source } = await screenApplicationAI({
      orgId, jobTitle: ctx.title, jobDescription: ctx.description, requirements: jobRequirements(ctx),
      profile: profileForScreening(ctx.parsed_profile), resumeText: ctx.resume_text, coverNote: null,
    });
    const { level, met, total } = reconcileMatch(screening);
    await withOrg(orgId, (tx) => tx`
      update candidate_job_matches set status = 'completed', match_level = ${level}, requirements_met = ${met}, requirements_total = ${total},
        summary = ${screening.summary.slice(0, 2000)},
        screening = ${json({ ...screening, ai_match_level: screening.match_level, source, prompt_version: source === "openai" ? SCREENER_VERSION : "demo-heuristic" })}
      where candidate_id = ${candidateId} and job_id = ${jobId}`);
  } catch (err) {
    log.warn("candidate.match_failed", { candidateId, jobId, err });
    await withOrg(orgId, (tx) => tx`update candidate_job_matches set status = 'failed', error = 'The resume check failed. You can try again.'
      where candidate_id = ${candidateId} and job_id = ${jobId}`);
  }
  return getMatch(orgId, candidateId, jobId);
}

/**
 * Queue the check for people shown without one (for example invited before it existed): marks them
 * "pending" and checks them in the background, a few at a time. Returns how many were queued.
 */
export async function queueMissingMatches(orgId: string, pairs: { candidateId: string; jobId: string }[], max = 10): Promise<number> {
  if (!pairs.length) return 0;
  const queued: { candidate_id: string; job_id: string }[] = [];
  await withOrg(orgId, async (tx) => {
    for (const p of pairs.slice(0, max)) {
      const rows = await tx<{ candidate_id: string; job_id: string }[]>`
        insert into candidate_job_matches (organization_id, candidate_id, job_id, status) values (${orgId}, ${p.candidateId}, ${p.jobId}, 'pending')
        on conflict (candidate_id, job_id) do nothing returning candidate_id, job_id`;
      queued.push(...rows);
    }
  });
  if (queued.length) {
    runInBackground("candidate.match_backfill", async () => {
      for (const q of queued) await matchCandidate(orgId, q.candidate_id, q.job_id).catch(() => {});
    });
  }
  return queued.length;
}

/** Re-check every job the candidate is in (after their resume is uploaded or analysed again). */
export async function refreshMatches(orgId: string, candidateId: string) {
  const jobs = await withOrg(orgId, (tx) => tx<{ job_id: string }[]>`
    select jc.job_id from job_candidates jc where jc.candidate_id = ${candidateId} and jc.organization_id = ${orgId}
      and not exists (select 1 from job_applications a where a.candidate_id = jc.candidate_id and a.job_id = jc.job_id)`);
  for (const { job_id } of jobs) await matchCandidate(orgId, candidateId, job_id);
}
