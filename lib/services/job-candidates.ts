import "server-only";
import { withOrg } from "@/lib/database/db";
import type { ExperienceFlag } from "@/lib/resume/experience";
import type { Stage } from "@/lib/hiring";
import { jobStageOf, type JobStage } from "@/lib/jobs/job-stages";
import { describeJobList, filterJobList, jobListQuery, jobRowHref, parseJobListFilters } from "@/lib/jobs/job-list";
import { entriesSql, roundResults, type PipelineRound, type RoundResult } from "@/lib/services/pipeline";

// A job's candidates in one list: everyone who applied, was added for the job, or was interviewed for it,
// once each, at the stage they're at now. Replaces the separate Applications / Candidates / AI interviews lists.

export type JobCandidateRow = {
  id: string; name: string; email: string; has_resume: boolean; parse_status: string | null;
  experience_months: number | null; experience_approximate: boolean; experience_flags: ExperienceFlag[];
  source: "applied" | "added"; added_at: Date; last_activity: Date;
  application_id: string | null; application_status: string | null;
  pipeline_stage: Stage | null; stage_note: string | null;
  interview_id: string | null; interview_status: string | null;
  match_level: string | null; match_met: number | null; match_total: number | null; match_status: string | null;
  results: RoundResult[]; stage: JobStage;
};

export async function listJobCandidates(orgId: string, jobId: string) {
  return withOrg(orgId, async (tx) => {
    const people = await tx<Omit<JobCandidateRow, "results" | "stage" | "source">[]>`
      with p as (
        select candidate_id from job_candidates where job_id = ${jobId} and organization_id = ${orgId}
        union select candidate_id from job_applications where job_id = ${jobId} and organization_id = ${orgId}
        union select candidate_id from interviews where job_id = ${jobId} and organization_id = ${orgId}
      )
      select c.id, c.name, c.email, c.resume_file_path is not null as has_resume, c.parse_status::text as parse_status,
        c.experience_months, c.experience_approximate, c.experience_flags,
        least(coalesce(a.created_at, 'infinity'), coalesce(jc.created_at, 'infinity'), coalesce(iv.created_at, 'infinity')) as added_at,
        greatest(a.created_at, jc.created_at, jc.stage_changed_at, iv.created_at, iv.started_at, iv.completed_at) as last_activity,
        a.id as application_id, a.status::text as application_status, jc.stage as pipeline_stage, jc.stage_note,
        iv.id as interview_id, iv.status::text as interview_status,
        coalesce(a.match_level, m.match_level) as match_level,
        coalesce(a.requirements_met, m.requirements_met) as match_met,
        coalesce(a.requirements_total, m.requirements_total) as match_total,
        coalesce(a.screening_status::text, m.status::text) as match_status
      from p join candidates c on c.id = p.candidate_id and c.organization_id = ${orgId}
      left join job_candidates jc on jc.candidate_id = c.id and jc.job_id = ${jobId}
      left join job_applications a on a.candidate_id = c.id and a.job_id = ${jobId}
      left join candidate_job_matches m on m.candidate_id = c.id and m.job_id = ${jobId}
      left join lateral (
        select i.id, i.status, i.created_at, i.started_at, i.completed_at from interviews i where i.candidate_id = c.id and i.job_id = ${jobId} order by i.created_at desc limit 1
      ) iv on true`;
    const rounds = await tx<PipelineRound[]>`select id, job_id, name, kind, sort_order from job_rounds where job_id = ${jobId} order by sort_order, created_at`;
    const entries = await entriesSql(tx, tx`e.job_id = ${jobId}`);
    const rows: JobCandidateRow[] = people.map((p) => {
      const results = roundResults(rounds, entries.filter((e) => e.candidate_id === p.id));
      const source = p.application_id ? "applied" as const : "added" as const;
      return { ...p, source, results, stage: jobStageOf({ ...p, results }) };
    });
    rows.sort((a, b) => b.added_at.getTime() - a.added_at.getTime());
    const [{ interviews }] = await tx<{ interviews: number }[]>`
      select count(*)::int as interviews from interviews where job_id = ${jobId} and organization_id = ${orgId} and status <> 'cancelled'`;
    return { rows, rounds, interviewCount: interviews };
  });
}

/**
 * Previous / Next for a candidate or application opened from a job's list: walks the same filtered,
 * sorted list the job page shows, and links back to the page of the list this person is on.
 */
export async function jobListNav(orgId: string, jobId: string, params: Record<string, string | string[] | undefined>, candidateId: string) {
  const f = parseJobListFilters(params);
  const query = jobListQuery(f, false);
  const { rows } = await listJobCandidates(orgId, jobId);
  const list = filterJobList(rows, f);
  const at = list.findIndex((r) => r.id === candidateId);
  const inList = at >= 0;
  if (!inList && !rows.some((r) => r.id === candidateId)) return null;
  // Someone who no longer matches (e.g. their stage just changed) gets Next to the first one in the list.
  const prev = inList && at > 0 ? list[at - 1] : null;
  const next = inList ? list[at + 1] ?? null : list[0] ?? null;
  const page = inList ? Math.floor(at / f.size) + 1 : 1;
  const back = jobListQuery({ ...f, page });
  return {
    prevHref: prev ? jobRowHref(jobId, prev, query) : null,
    nextHref: next ? jobRowHref(jobId, next, query) : null,
    listHref: back ? `/jobs/${jobId}?${back}` : `/jobs/${jobId}`,
    position: at + 1, total: list.length, inList, label: describeJobList(f),
  };
}
