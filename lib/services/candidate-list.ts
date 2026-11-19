import "server-only";
import { withOrg, type Tx } from "@/lib/database/db";
import type { ExperienceFlag } from "@/lib/resume/experience";

// The Candidates page: one row per person, with the job they're in (the selected job, or their latest),
// where their interview for that job stands, how well their resume fits it, and their experience.

import { emptyStageCounts, STAGE_GROUPS, type StageCounts, type StageGroup } from "@/lib/candidates/stages";
export { STAGE_GROUP_LABEL, STAGE_GROUPS, type StageGroup } from "@/lib/candidates/stages";
export const SORTS = ["new", "match", "experience"] as const;
export type CandidateSort = (typeof SORTS)[number];
export const PAGE_SIZE = 25;
/** The board shows up to this many people per stage. */
export const BOARD_LIMIT = 200;

export type CandidateListRow = {
  id: string; name: string; email: string; created_at: Date; skills: string[]; has_resume: boolean; parse_status: string | null;
  experience_months: number | null; experience_approximate: boolean; experience_flags: ExperienceFlag[];
  archived_at: Date | null; archived_reason: string | null;
  job_id: string | null; job_title: string | null; other_jobs: number;
  interview_id: string | null; interview_status: string | null; stage: StageGroup;
  match_level: string | null; match_met: number | null; match_total: number | null; match_status: string | null;
};

export type CandidateListQuery = { q?: string; jobId?: string; stage?: StageGroup; sort?: CandidateSort; archived?: boolean; page?: number; board?: boolean };

const MATCH_RANK = `case x.match_level when 'strong_match' then 5 when 'good_match' then 4 when 'partial_match' then 3 when 'low_match' then 2 when 'insufficient_information' then 1 else 0 end`;

/** Group an interview status into a stage (no interview, or a cancelled one, is "not invited"). */
function stageCase(tx: Tx, col: string) {
  const c = tx.unsafe(`${col}::text`);
  return tx`case
    when ${c} is null or ${c} = 'cancelled' then 'not_invited'
    when ${c} in ('created', 'invited', 'consent_pending', 'device_check', 'ready') then 'invited'
    when ${c} in ('in_progress', 'completing') then 'in_progress'
    when ${c} = 'expired' then 'expired'
    else 'completed' end`;
}

/** Every candidate with their job context; filters are applied by the caller's queries. */
function rowsSql(tx: Tx, orgId: string, jobId: string | null) {
  // A person is "in" a job if they're in its pipeline (added for it, invited, decided on) or applied to it.
  const inJob = (alias: string) => jobId ? tx`and ${tx(alias)}.job_id = ${jobId}` : tx``;
  return tx`
    select c.id, c.name, c.email, c.created_at, coalesce(c.parsed_profile->'skills', '[]'::jsonb) as skills_json,
      c.resume_file_path is not null as has_resume, c.parse_status::text as parse_status,
      c.experience_months, c.experience_approximate, c.experience_flags, c.archived_at, c.archived_reason,
      ctx.job_id, j.title as job_title, iv.id as interview_id, iv.status::text as interview_status,
      coalesce(app.match_level, m.match_level) as match_level,
      coalesce(app.requirements_met, m.requirements_met) as match_met,
      coalesce(app.requirements_total, m.requirements_total) as match_total,
      coalesce(app.screening_status::text, m.status::text) as match_status,
      (select count(distinct x.job_id)::int from (
        select jc.job_id from job_candidates jc where jc.candidate_id = c.id union select a.job_id from job_applications a where a.candidate_id = c.id
      ) x) as job_count,
      ${stageCase(tx, "iv.status")} as stage
    from candidates c
    -- The job to show: the selected one; otherwise the job of their latest interview, or, with no interview yet,
    -- the job they were most recently added to or applied for.
    left join lateral (
      select y.job_id from (
        select i.job_id, i.created_at, 0 as pri from interviews i where i.candidate_id = c.id ${inJob("i")}
        union all select jc.job_id, jc.created_at, 1 from job_candidates jc where jc.candidate_id = c.id ${inJob("jc")}
        union all select a.job_id, a.created_at, 1 from job_applications a where a.candidate_id = c.id ${inJob("a")}
      ) y order by y.pri, y.created_at desc limit 1
    ) ctx on true
    left join jobs j on j.id = ctx.job_id
    left join lateral (
      select i.id, i.status from interviews i where i.candidate_id = c.id and i.job_id = ctx.job_id order by i.created_at desc limit 1
    ) iv on true
    left join job_applications app on app.candidate_id = c.id and app.job_id = ctx.job_id
    left join candidate_job_matches m on m.candidate_id = c.id and m.job_id = ctx.job_id
    where c.organization_id = ${orgId} ${jobId ? tx`and ctx.job_id is not null` : tx``}`;
}

export async function listCandidatePage(orgId: string, opts: CandidateListQuery) {
  const jobId = opts.jobId ?? null;
  const archived = !!opts.archived;
  const q = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
  const page = Math.max(1, opts.page ?? 1);
  const sort = opts.sort ?? "new";
  return withOrg(orgId, async (tx) => {
    const base = tx`(${rowsSql(tx, orgId, jobId)}) x
      where (x.archived_at is not null) = ${archived}
      ${q ? tx`and (x.name ilike ${q} or x.email::text ilike ${q} or x.skills_json::text ilike ${q})` : tx``}`;
    const order = sort === "match" ? tx`${tx.unsafe(MATCH_RANK)} desc, x.created_at desc`
      : sort === "experience" ? tx`x.experience_months desc nulls last, x.created_at desc`
      : archived ? tx`x.archived_at desc` : tx`x.created_at desc`;
    const stageFilter = opts.stage ? tx`and x.stage = ${opts.stage}` : tx``;
    const limit = opts.board ? BOARD_LIMIT * STAGE_GROUPS.length : PAGE_SIZE;
    const offset = opts.board ? 0 : (page - 1) * PAGE_SIZE;
    const rows = await tx<(Omit<CandidateListRow, "skills" | "other_jobs"> & { skills_json: unknown; job_count: number })[]>`
      select * from ${base} ${stageFilter} order by ${order} limit ${limit} offset ${offset}`;
    const counts = await tx<{ stage: StageGroup; n: number }[]>`select x.stage, count(*)::int as n from ${base} group by x.stage`;
    const [{ archived_count, active_count }] = await tx<{ archived_count: number; active_count: number }[]>`
      select count(*) filter (where archived_at is not null)::int as archived_count, count(*) filter (where archived_at is null)::int as active_count
      from candidates where organization_id = ${orgId}`;
    // Jobs with people in them, for the job cards: how many people (in the list being viewed: active or
    // archived) and where each one's interview for that job stands.
    const jobRows = await tx<{ id: string; title: string; status: string; stage: StageGroup; n: number }[]>`
      select j.id, j.title, j.status::text, ${stageCase(tx, "iv.status")} as stage, count(*)::int as n
      from jobs j join (
        select jc.job_id, jc.candidate_id from job_candidates jc where jc.organization_id = ${orgId}
        union select a.job_id, a.candidate_id from job_applications a where a.organization_id = ${orgId}
      ) p on p.job_id = j.id
      join candidates c on c.id = p.candidate_id and (c.archived_at is not null) = ${archived}
      left join lateral (
        select i.status from interviews i where i.candidate_id = p.candidate_id and i.job_id = p.job_id order by i.created_at desc limit 1
      ) iv on true
      where j.organization_id = ${orgId} group by j.id, 4`;
    const byJob = new Map<string, { id: string; title: string; status: string; n: number; stages: StageCounts; created: number }>();
    for (const r of jobRows) {
      const j = byJob.get(r.id) ?? { id: r.id, title: r.title, status: r.status, n: 0, stages: emptyStageCounts(), created: byJob.size };
      j.n += r.n; j.stages[r.stage] += r.n;
      byJob.set(r.id, j);
    }
    const jobs = [...byJob.values()].sort((a, b) => b.n - a.n || a.title.localeCompare(b.title)).map(({ created: _c, ...j }) => j);
    // Stages across all jobs (for the "All jobs" card), whatever job is selected.
    const allStages = emptyStageCounts();
    const allCounts = jobId ? await tx<{ stage: StageGroup; n: number }[]>`
      select x.stage, count(*)::int as n from (${rowsSql(tx, orgId, null)}) x where (x.archived_at is not null) = ${archived} group by x.stage` : counts;
    for (const c of allCounts) allStages[c.stage] += c.n;
    // Why people were archived, for the Archived view.
    const reasons = archived ? await tx<{ reason: string; n: number }[]>`
      select split_part(coalesce(archived_reason, 'Other'), ':', 1) as reason, count(*)::int as n from candidates
      where organization_id = ${orgId} and archived_at is not null group by 1 order by 2 desc, 1` : [];
    const byStage = Object.fromEntries(STAGE_GROUPS.map((s) => [s, counts.find((c) => c.stage === s)?.n ?? 0])) as Record<StageGroup, number>;
    const total = opts.stage ? byStage[opts.stage] : counts.reduce((a, c) => a + c.n, 0);
    return {
      rows: rows.map(({ skills_json, job_count, ...r }) => ({
        ...r, skills: Array.isArray(skills_json) ? (skills_json as string[]).slice(0, 6) : [], other_jobs: Math.max(0, job_count - 1),
      })) as CandidateListRow[],
      byStage, allStages, total, page, pageSize: PAGE_SIZE, jobs, reasons, archivedCount: archived_count, activeCount: active_count,
    };
  });
}
