-- The email a candidate gets after their interview: when it was sent (so it's sent
-- once, even if the report is regenerated) and the AI feedback it included, so the
-- hiring team can see exactly what the candidate received.
alter table interviews add column candidate_email_sent_at timestamptz;
alter table interviews add column candidate_feedback text check (char_length(candidate_feedback) <= 2000);
