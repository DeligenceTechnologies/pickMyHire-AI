-- A job's hiring team. Owners, Admins and Recruiters on it get the job's emails (they see every job
-- either way); Interviewers see only the jobs they're on (candidates, interviews, reports, recordings).

create table if not exists job_members (
  job_id uuid not null references jobs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  added_by uuid references users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (job_id, user_id)
);
create index if not exists job_members_user_idx on job_members(user_id, organization_id);

alter table job_members enable row level security;
alter table job_members force row level security;
drop policy if exists tenant_isolation on job_members;
create policy tenant_isolation on job_members
  using (app_is_system() or organization_id = app_current_org())
  with check (app_is_system() or organization_id = app_current_org());

-- Existing jobs: the person who created each one is on its team (if they're still in the company),
-- so emails keep reaching them.
insert into job_members (job_id, user_id, organization_id, added_by)
select j.id, j.created_by, j.organization_id, j.created_by
from jobs j
join organization_members m on m.user_id = j.created_by and m.organization_id = j.organization_id
where j.created_by is not null
on conflict do nothing;
