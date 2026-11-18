-- Interviews are now used when the candidate starts (not held at invite):
--   credits_used  how many interviews this one used (1, or 2 for templates over 40 minutes); 0 = not used or given back
--   charged_at    when it was used (counted against the company's balance from quota_counted_from)
--   credits_refunded_at  given back automatically (the interview ended before the candidate answered anything)
--   held_at       the candidate opened the link while the company had no interviews left; cleared when
--                 interviews are added and the candidate is emailed that they can start
select set_config('app.system', 'on', true);

alter table interviews add column credits_used smallint not null default 0 check (credits_used between 0 and 10);
alter table interviews add column charged_at timestamptz;
alter table interviews add column credits_refunded_at timestamptz;
alter table interviews add column held_at timestamptz;

-- Existing interviews: the ones that already counted (completed) or are running count as one each.
update interviews set credits_used = 1, charged_at = coalesce(completed_at, started_at)
where status in ('completed', 'processing', 'report_ready', 'in_progress', 'completing') and coalesce(completed_at, started_at) is not null;

create index interviews_charged_idx on interviews(organization_id, charged_at) where credits_used > 0;
create index interviews_held_idx on interviews(organization_id) where held_at is not null;
