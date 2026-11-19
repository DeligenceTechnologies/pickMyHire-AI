-- Candidates page feedback: total experience calculated from resume dates, a resume-vs-job match for
-- candidates added by hand, and an Archived list.
select set_config('app.system', 'on', true);

-- Experience worked out from the resume's dates (lib/resume/experience.ts), with any dates that need a look.
alter table candidates add column experience_months integer check (experience_months is null or experience_months between 0 and 1200);
alter table candidates add column experience_approximate boolean not null default false;
alter table candidates add column experience_flags jsonb not null default '[]'::jsonb;

-- Archived candidates leave the active list: by hand with a reason, or automatically once every job
-- they're in has them Rejected or Withdrawn ("auto" reasons are cleared again if that changes).
alter table candidates add column archived_at timestamptz;
alter table candidates add column archived_reason text check (archived_reason is null or length(archived_reason) <= 200);
alter table candidates add column archived_auto boolean not null default false;
alter table candidates add column archived_by uuid references users(id) on delete set null;
create index candidates_active_idx on candidates(organization_id, created_at desc) where archived_at is null;

-- How well a candidate's resume fits a job, for candidates who didn't apply through the job's link
-- (applications keep their own screening on job_applications).
create table candidate_job_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  status processing_status not null default 'pending',
  match_level text,
  requirements_met integer,
  requirements_total integer,
  summary text,
  screening jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, job_id)
);
create index candidate_job_matches_org_idx on candidate_job_matches(organization_id, job_id);
create trigger candidate_job_matches_updated before update on candidate_job_matches for each row execute function set_updated_at();
alter table candidate_job_matches enable row level security;
alter table candidate_job_matches force row level security;
create policy tenant_isolation on candidate_job_matches
  using (app_is_system() or organization_id = app_current_org())
  with check (app_is_system() or organization_id = app_current_org());

-- Candidates already Rejected or Withdrawn in every job they're in start out archived.
update candidates c set archived_at = now(), archived_auto = true,
  archived_reason = case when x.all_withdrawn then 'Withdrawn' else 'Rejected' end
from (
  select candidate_id, bool_and(stage = 'withdrawn') as all_withdrawn
  from job_candidates group by candidate_id
  having bool_and(stage in ('rejected', 'withdrawn'))
) x
where x.candidate_id = c.id and c.archived_at is null;
