-- Application questions (shown on the apply page) and internal hiring limits
-- (budget, notice period…) per job. Null means the defaults / no limits.
alter table jobs
  add column application_form jsonb,
  add column hiring_limits jsonb;

-- Answers to a job's questions: from the applicant on the apply page, or filled
-- in by the recruiter for a candidate invited directly. One record per
-- candidate per job.
create table candidate_job_answers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  -- Null when the candidate answered on the apply page.
  answered_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, candidate_id)
);
create index candidate_job_answers_candidate_idx on candidate_job_answers(candidate_id);
create trigger candidate_job_answers_updated before update on candidate_job_answers for each row execute function set_updated_at();

alter table candidate_job_answers enable row level security;
alter table candidate_job_answers force row level security;
create policy tenant_isolation on candidate_job_answers
  using (app_is_system() or organization_id = app_current_org())
  with check (app_is_system() or organization_id = app_current_org());
