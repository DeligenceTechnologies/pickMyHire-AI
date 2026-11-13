-- The candidate follow-up email is claimed before it's sent and marked sent only once the
-- provider accepts it. A failed send (or a crash mid-send) releases the claim so a later
-- processing run can retry, and the interview page never says "sent" for an email that
-- didn't go out.
alter table interviews add column candidate_email_claimed_at timestamptz;
update interviews set candidate_email_claimed_at = candidate_email_sent_at where candidate_email_sent_at is not null;
