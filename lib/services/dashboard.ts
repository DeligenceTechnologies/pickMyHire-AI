import "server-only";
import { withOrg } from "@/lib/database/db";
import { jobStageOf, type JobStage } from "@/lib/jobs/job-stages";
import { entriesSql, roundResults, type PipelineRound, type RoundEntry } from "@/lib/services/pipeline";
import type { Stage } from "@/lib/hiring";

// The dashboard: every active job's candidates counted exactly like each job page (jobStageOf), plus what
// needs doing, how far candidates get, what happened lately and interviews per day.

export const PERIODS = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
] as const;
export type PeriodId = (typeof PERIODS)[number]["id"];
export const periodOf = (v: unknown) => PERIODS.find((p) => p.id === v) ?? PERIODS[1];

const DAY = 86_400_000;
/** "Waiting a while": invited and not opened, or ready to review, for this long. */
export const STALE_DAYS = 3;
const LIVE = ["in_progress", "completing"];
const DONE = ["completed", "processing", "report_ready"];

export type StageCounts = { to_invite: number; interview: number; review: number; shortlisted: number; hired: number };
export type JobHealth = "on_track" | "needs_review" | "slow_start" | "few_candidates" | "not_set_up";

export type DashboardJob = StageCounts & {
  id: string; title: string; owner: string | null; created_at: Date;
  total: number; notStarted: number; reviewWaiting: number; health: JobHealth; why: string;
};

export type ActivityItem = {
  key: string; kind: "completed" | "report_ready" | "started" | "applied" | "shortlisted" | "hired" | "invited";
  name: string; by: string | null; job: string; at: Date; href: string; count?: number;
};

export type Dashboard = {
  totals: StageCounts & {
    total: number; newInPeriod: number; liveNow: number; reviewWaiting: number; notStarted: number;
    shortlistedInPeriod: number; hiredInPeriod: number;
  };
  jobs: DashboardJob[];
  funnel: { invited: number; started: number; completed: number; shortlisted: number; hired: number };
  /** Jobs by status, and interview events in the period and the period before. */
  overview: {
    jobs: { active: number; draft: number; paused: number; newInPeriod: number };
    now: { invited: number; started: number; completed: number };
    before: { invited: number; started: number; completed: number };
  };
  /** Interview times in the period, bucketed by day in the viewer's browser. */
  daily: { completed: string[]; unfinished: string[]; previousCompleted: number };
  activity: ActivityItem[];
  usage: { usedRecently: number; nextExpiry: { at: Date; count: number } | null };
};

const EMPTY = (): StageCounts => ({ to_invite: 0, interview: 0, review: 0, shortlisted: 0, hired: 0 });
const GROUP: Record<JobStage, keyof StageCounts | null> = {
  to_invite: "to_invite", invited: "interview", interviewing: "interview", review: "review",
  shortlisted: "shortlisted", hired: "hired", rejected: null,
};

function healthOf(j: Omit<DashboardJob, "health" | "why">, hasRounds: boolean, now: number): { health: JobHealth; why: string } {
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  if (!hasRounds) return { health: "not_set_up", why: "No interview rounds yet" };
  if (j.review >= 10 || j.reviewWaiting > 0) return { health: "needs_review", why: j.reviewWaiting ? `${plural(j.reviewWaiting, "candidate")} waiting ${STALE_DAYS}+ days` : `${j.review} waiting for you` };
  if (j.to_invite >= 5 && j.to_invite * 2 >= j.total) return { health: "slow_start", why: `${j.to_invite} not invited yet` };
  if (j.notStarted >= 3) return { health: "slow_start", why: `${j.notStarted} invited, not started` };
  if (j.total < 5 && now - j.created_at.getTime() > STALE_DAYS * DAY) return { health: "few_candidates", why: j.total ? `Only ${plural(j.total, "candidate")}` : "No candidates yet" };
  return { health: "on_track", why: j.total ? "Interviews moving" : "Just opened" };
}

/**
 * `mine`: only jobs this user created. `candidateData`: roles without candidate access get interview
 * numbers only (no candidate counts, names from applications, or decisions).
 */
export async function getDashboardData(orgId: string, opts: { userId: string; mine: boolean; jobId?: string | null; days: number; candidateData: boolean; jobIds?: string[] | null }): Promise<Dashboard> {
  const now = Date.now();
  const since = new Date(now - opts.days * DAY);
  const before = new Date(now - 2 * opts.days * DAY);
  const stale = new Date(now - STALE_DAYS * DAY);
  return withOrg(orgId, async (tx) => {
    // One job, the user's own jobs, or all jobs.
    // An Interviewer sees only the jobs they're on (jobIds).
    const only = opts.jobIds ? tx`and j.id = any(${opts.jobIds})` : tx``;
    const mine = tx`${opts.jobId ? tx`and j.id = ${opts.jobId}` : opts.mine ? tx`and j.created_by = ${opts.userId}` : tx``} ${only}`;
    const jobs = await tx<{ id: string; title: string; owner: string | null; created_at: Date; has_rounds: boolean }[]>`
      select j.id, j.title, u.name as owner, j.created_at,
        exists (select 1 from job_rounds r where r.job_id = j.id) as has_rounds
      from jobs j left join users u on u.id = j.created_by
      where j.organization_id = ${orgId} and j.status = 'active' ${mine}
      order by j.created_at desc`;
    const ids = jobs.map((j) => j.id);

    // Same people and stage rules as the job page, for all active jobs at once.
    let dashJobs: DashboardJob[] = [];
    const totals = { ...EMPTY(), total: 0, newInPeriod: 0, liveNow: 0, reviewWaiting: 0, notStarted: 0, shortlistedInPeriod: 0, hiredInPeriod: 0 };
    if (ids.length && opts.candidateData) {
      const people = await tx<{
        job_id: string; candidate_id: string; added_at: Date; application_status: string | null;
        pipeline_stage: Stage | null; stage_changed_at: Date | null; interview_status: string | null; invited_at: Date | null; completed_at: Date | null;
      }[]>`
        with p as (
          select job_id, candidate_id from job_candidates where organization_id = ${orgId} and job_id = any(${ids})
          union select job_id, candidate_id from job_applications where organization_id = ${orgId} and job_id = any(${ids})
          union select job_id, candidate_id from interviews where organization_id = ${orgId} and job_id = any(${ids})
        )
        select p.job_id, p.candidate_id,
          least(coalesce(a.created_at, 'infinity'), coalesce(jc.created_at, 'infinity'), coalesce(iv.created_at, 'infinity')) as added_at,
          a.status::text as application_status, jc.stage as pipeline_stage, jc.stage_changed_at,
          iv.status::text as interview_status, iv.invited_at, iv.completed_at
        from p join candidates c on c.id = p.candidate_id and c.organization_id = ${orgId}
        left join job_candidates jc on jc.candidate_id = p.candidate_id and jc.job_id = p.job_id
        left join job_applications a on a.candidate_id = p.candidate_id and a.job_id = p.job_id
        left join lateral (
          select i.status, i.created_at, i.invited_at, i.completed_at from interviews i
          where i.candidate_id = p.candidate_id and i.job_id = p.job_id order by i.created_at desc limit 1
        ) iv on true`;
      const rounds = await tx<PipelineRound[]>`select id, job_id, name, kind, sort_order from job_rounds where job_id = any(${ids}) order by sort_order, created_at`;
      const entries = await entriesSql(tx, tx`e.job_id = any(${ids})`);
      const byPerson = new Map<string, RoundEntry[]>();
      for (const e of entries) {
        const k = `${e.job_id}:${e.candidate_id}`;
        byPerson.set(k, [...(byPerson.get(k) ?? []), e]);
      }
      const perJob = new Map(jobs.map((j) => [j.id, { ...EMPTY(), total: 0, notStarted: 0, reviewWaiting: 0 }]));
      for (const p of people) {
        const results = roundResults(rounds.filter((r) => r.job_id === p.job_id), byPerson.get(`${p.job_id}:${p.candidate_id}`) ?? []);
        const stage = jobStageOf({ ...p, results });
        const g = GROUP[stage];
        if (!g) continue;
        const j = perJob.get(p.job_id)!;
        j[g]++; j.total++; totals[g]++; totals.total++;
        if (p.added_at >= since) totals.newInPeriod++;
        if (stage === "interviewing" && p.interview_status && LIVE.includes(p.interview_status)) totals.liveNow++;
        if (stage === "invited" && p.interview_status === "invited" && p.invited_at && p.invited_at < stale) { j.notStarted++; totals.notStarted++; }
        if (stage === "review") {
          const doneAt = [p.completed_at, ...results.map((r) => (r.state === "done" ? r.entry?.at ?? null : null))]
            .filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
          if (doneAt && doneAt < stale) { j.reviewWaiting++; totals.reviewWaiting++; }
        }
        if (p.stage_changed_at && p.stage_changed_at >= since) {
          if (stage === "shortlisted") totals.shortlistedInPeriod++;
          if (stage === "hired") totals.hiredInPeriod++;
        }
      }
      dashJobs = jobs.map((job) => {
        const base = { id: job.id, title: job.title, owner: job.owner, created_at: job.created_at, ...perJob.get(job.id)! };
        return { ...base, ...healthOf(base, job.has_rounds, now) };
      });
      // Most people waiting on you first.
      dashJobs.sort((a, b) => b.review + b.to_invite + b.notStarted - (a.review + a.to_invite + a.notStarted) || b.created_at.getTime() - a.created_at.getTime());
    }

    // How far candidates invited in the period got (one row per person and job).
    const jobScope = tx`${opts.jobId ? tx`and i.job_id = ${opts.jobId}`
      : opts.mine ? tx`and i.job_id in (select id from jobs where organization_id = ${orgId} and created_by = ${opts.userId})` : tx``}
      ${opts.jobIds ? tx`and i.job_id = any(${opts.jobIds})` : tx``}`;
    const [funnel] = await tx<Dashboard["funnel"][]>`
      with c as (
        select i.candidate_id, i.job_id,
          bool_or(i.started_at is not null) as started,
          bool_or(i.status::text = any(${DONE})) as completed
        from interviews i
        where i.organization_id = ${orgId} and i.invited_at >= ${since} ${jobScope}
        group by i.candidate_id, i.job_id
      )
      select count(*)::int as invited,
        count(*) filter (where started)::int as started,
        count(*) filter (where completed)::int as completed,
        count(*) filter (where jc.stage = 'shortlisted')::int as shortlisted,
        count(*) filter (where jc.stage = 'hired')::int as hired
      from c left join job_candidates jc on jc.candidate_id = c.candidate_id and jc.job_id = c.job_id`;
    if (!opts.candidateData) { funnel.shortlisted = 0; funnel.hired = 0; }

    const [jobCounts] = await tx<Dashboard["overview"]["jobs"][]>`
      select count(*) filter (where j.status = 'active')::int as active,
        count(*) filter (where j.status = 'draft')::int as draft,
        count(*) filter (where j.status = 'paused')::int as paused,
        count(*) filter (where j.status = 'active' and j.created_at >= ${since})::int as "newInPeriod"
      from jobs j where j.organization_id = ${orgId} ${mine}`;
    const events = (from: Date, to: Date) => tx<Dashboard["overview"]["now"][]>`
      select count(*) filter (where i.invited_at >= ${from} and i.invited_at < ${to})::int as invited,
        count(*) filter (where i.started_at >= ${from} and i.started_at < ${to})::int as started,
        count(*) filter (where i.status::text = any(${DONE}) and i.completed_at >= ${from} and i.completed_at < ${to})::int as completed
      from interviews i where i.organization_id = ${orgId} ${jobScope} and coalesce(i.invited_at, i.created_at) >= ${new Date(from.getTime() - 60 * DAY)}`;
    const [evNow] = await events(since, new Date(now + DAY));
    const [evBefore] = await events(before, since);

    const times = await tx<{ completed_at: Date | null; started_at: Date | null; finished: boolean }[]>`
      select i.completed_at, i.started_at, i.status::text = any(${DONE}) as finished
      from interviews i
      where i.organization_id = ${orgId} ${jobScope}
        and ((i.status::text = any(${DONE}) and i.completed_at >= ${since})
          or (i.started_at >= ${since} and i.status::text in ('cancelled', 'expired', 'failed')))
      limit 20000`;
    const [{ previous }] = await tx<{ previous: number }[]>`
      select count(*)::int as previous from interviews i
      where i.organization_id = ${orgId} ${jobScope} and i.status::text = any(${DONE}) and i.completed_at >= ${before} and i.completed_at < ${since}`;
    const daily = {
      completed: times.filter((t) => t.finished && t.completed_at).map((t) => t.completed_at!.toISOString()),
      unfinished: times.filter((t) => !t.finished && t.started_at).map((t) => t.started_at!.toISOString()),
      previousCompleted: previous,
    };

    // Recent updates: interviews for everyone; applications and decisions only with candidate access.
    const jScope = mine;
    const activity = await tx<ActivityItem[]>`
      select * from (
        select 'iv-' || i.id as key, case when i.status = 'report_ready' then 'report_ready' else 'completed' end as kind,
          c.name, null::text as by, j.title as job, i.completed_at as at, '/interviews/' || i.id as href, null::int as count
        from interviews i join candidates c on c.id = i.candidate_id join jobs j on j.id = i.job_id
        where i.organization_id = ${orgId} and i.status::text = any(${DONE}) and i.completed_at is not null ${jScope}
        union all
        select 'st-' || i.id, 'started', c.name, null, j.title, i.started_at, '/interviews/' || i.id, null
        from interviews i join candidates c on c.id = i.candidate_id join jobs j on j.id = i.job_id
        where i.organization_id = ${orgId} and i.status::text = any(${LIVE}) and i.started_at is not null ${jScope}
        union all
        select 'in-' || j.id || '-' || to_char(max(i.invited_at), 'YYYYMMDDHH24'), 'invited', max(c.name), u.name, j.title, max(i.invited_at), '/jobs/' || j.id || '?stage=interview', count(*)::int
        from interviews i join candidates c on c.id = i.candidate_id join jobs j on j.id = i.job_id left join users u on u.id = i.created_by
        where i.organization_id = ${orgId} and i.invited_at is not null ${jScope}
        group by j.id, j.title, u.name, date_trunc('hour', i.invited_at)
        ${opts.candidateData ? tx`
        union all
        select 'ap-' || a.id, 'applied', c.name, null, j.title, a.created_at, '/jobs/' || j.id || '/applications/' || a.id, null
        from job_applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id
        where a.organization_id = ${orgId} ${jScope}
        union all
        select 'jc-' || jc.id, jc.stage, c.name, u.name, j.title, jc.stage_changed_at, '/candidates/' || c.id, null
        from job_candidates jc join candidates c on c.id = jc.candidate_id join jobs j on j.id = jc.job_id left join users u on u.id = jc.stage_changed_by
        where jc.organization_id = ${orgId} and jc.stage in ('shortlisted', 'hired') and jc.stage_changed_at is not null ${jScope}` : tx``}
      ) e order by at desc limit 8`;

    const [usage] = await tx<{ used: number; expiry_at: Date | null; expiry_count: number | null }[]>`
      select
        (select coalesce(sum(credits_used), 0)::int from interviews where organization_id = ${orgId} and credits_used > 0 and charged_at > now() - interval '14 days') as used,
        p.expires_at as expiry_at, p.interviews_added as expiry_count
      from (select 1) x left join lateral (
        select expires_at, interviews_added from purchases
        where organization_id = ${orgId} and status in ('paid', 'partially_refunded') and expired_at is null and expires_at > now() and interviews_added > 0
        order by expires_at limit 1
      ) p on true`;

    return {
      totals, jobs: dashJobs, funnel, daily, activity, overview: { jobs: jobCounts, now: evNow, before: evBefore },
      usage: { usedRecently: usage.used, nextExpiry: usage.expiry_at ? { at: usage.expiry_at, count: usage.expiry_count ?? 0 } : null },
    };
  });
}

/** The dashboard's job picker: every active job, by name. */
export async function listDashboardJobs(orgId: string, jobIds: string[] | null = null) {
  return withOrg(orgId, (tx) => tx<{ id: string; title: string }[]>`
    select id, title from jobs where organization_id = ${orgId} and status = 'active' ${jobIds ? tx`and id = any(${jobIds})` : tx``} order by lower(title)`);
}
