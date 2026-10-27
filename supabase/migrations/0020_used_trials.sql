-- Emails that already used a free trial, kept as a one-way hash after their account
-- is deleted, so deleting and signing up again doesn't give a new free trial.
create table used_trials (
  email_hash text primary key,
  created_at timestamptz not null default now()
);
alter table used_trials enable row level security;
alter table used_trials force row level security;
create policy system_only on used_trials using (app_is_system()) with check (app_is_system());
