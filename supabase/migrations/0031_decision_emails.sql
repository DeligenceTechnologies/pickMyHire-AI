-- Decision emails a recruiter chose to send a candidate ("not moving forward", "moving forward"), one per
-- candidate, job and kind, so the same decision is never emailed twice and the team sees when it went out.

create table if not exists candidate_decision_emails (
  organization_id uuid not null references organizations(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  kind text not null check (kind in ('rejected', 'shortlisted')),
  sent_at timestamptz not null default now(),
  sent_by uuid references users(id) on delete set null,
  primary key (candidate_id, job_id, kind)
);
create index if not exists candidate_decision_emails_org_idx on candidate_decision_emails(organization_id);

alter table candidate_decision_emails enable row level security;
alter table candidate_decision_emails force row level security;
drop policy if exists tenant_isolation on candidate_decision_emails;
create policy tenant_isolation on candidate_decision_emails
  using (app_is_system() or organization_id = app_current_org())
  with check (app_is_system() or organization_id = app_current_org());
