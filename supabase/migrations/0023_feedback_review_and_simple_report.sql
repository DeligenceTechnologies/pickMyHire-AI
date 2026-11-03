-- AI feedback the safety check held back from the candidate email: the draft and the
-- phrase that held it, so a recruiter can review it and send it once by hand.
alter table interviews add column candidate_feedback_draft text check (char_length(candidate_feedback_draft) <= 2000);
alter table interviews add column candidate_feedback_held_reason text check (char_length(candidate_feedback_held_reason) <= 200);
alter table interviews add column candidate_feedback_sent_at timestamptz;
alter table interviews add column candidate_feedback_sent_by uuid references users(id) on delete set null;

-- The one-page simple report shown above the detailed one: requirement and section
-- one-liners written from the finished report. Deleted with the report row.
alter table interview_reports add column simple_report jsonb;
