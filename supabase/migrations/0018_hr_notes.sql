-- Applications no longer have their own "Shortlisted" step (the next step is an
-- interview or "Not moving forward"); "Shortlisted" now only means the final
-- decision after every round. Existing ones go back to New.
update job_applications set status = 'new' where status = 'shortlisted';

-- What HR learns about a candidate (CTC, notice period, …). One record per
-- candidate, shown wherever the candidate is opened. Never sent to the AI.
create table candidate_hr_details (
  candidate_id uuid primary key references candidates(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  current_ctc text,
  expected_ctc text,
  notice_period text,
  joining_date date,
  current_location text,
  open_to_relocation boolean,
  other_details text,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger candidate_hr_details_updated before update on candidate_hr_details for each row execute function set_updated_at();

-- The team's notes on a candidate, optionally tagged with the job they were written for.
create table candidate_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  author_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index candidate_notes_candidate_idx on candidate_notes(candidate_id, created_at desc);
create trigger candidate_notes_updated before update on candidate_notes for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['candidate_hr_details', 'candidate_notes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (app_is_system() or organization_id = app_current_org()) with check (app_is_system() or organization_id = app_current_org())', t);
  end loop;
end $$;
