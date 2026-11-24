import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { withOrg, type Tx } from "@/lib/database/db";
import { companyBrand, replyToUser, sendEmail } from "@/lib/email";

// Decision emails: an optional email to the candidate when the team decides. Never sent on its own: the
// recruiter ticks it, can edit the text, and it goes once per candidate, job and kind. It never says why
// (budget, notes, scores and AI feedback stay internal).

export type DecisionKind = "rejected" | "shortlisted";

/** Archive reasons that are the team's decision. "Not interested" / "Hired elsewhere" are the candidate's. */
export const EMAILABLE_ARCHIVE_REASONS = ["Budget", "Location", "Not a fit", "Other"];
export const emailableArchiveReason = (reason: string) => EMAILABLE_ARCHIVE_REASONS.some((r) => reason === r || reason.startsWith(`${r}:`));

export const SendDecisionEmailSchema = z.object({
  kind: z.enum(["rejected", "shortlisted"]),
  jobIds: z.array(z.string().uuid()).min(1).max(20),
  subject: z.string().trim().min(3, "Add a subject").max(200),
  text: z.string().trim().min(20, "The message is too short").max(4000),
});

type Job = { id: string; title: string };
export type DecisionEmailDraft = {
  to: string; candidateName: string;
  /** Jobs the email is about (not emailed for this decision yet). Empty: nothing to send. */
  jobs: Job[];
  subject: string; text: string;
  /** Earlier emails for this decision, for "Already emailed on …". */
  sent: { job_title: string; sent_at: Date; sent_by_name: string | null }[];
};

/** The default wording. Plain and kind; the recruiter can edit it before sending. */
export function decisionEmailText(kind: DecisionKind, input: { firstName: string; company: string; jobs: string[] }) {
  const one = input.jobs.length === 1 ? input.jobs[0] : null;
  if (kind === "shortlisted") {
    const role = one ? `the ${one} role` : "the roles you applied for";
    return {
      subject: one ? `Next steps for the ${one} role at ${input.company}` : `Next steps for your application at ${input.company}`,
      text: `Hi ${input.firstName},

Good news: we'd like to move forward with your application for ${role}. Someone from our team will contact you soon about the next steps.

${input.company} hiring team`,
    };
  }
  const role = one ? `the ${one} role` : "the roles you applied for";
  return {
    subject: one ? `Your application for ${one} at ${input.company}` : `Your applications at ${input.company}`,
    text: `Hi ${input.firstName},

Thank you for your time and interest in ${role} at ${input.company}. After careful review, we've decided not to move forward with your application at this time.

We appreciate the effort you put into the process and wish you all the best in your search.

${input.company} hiring team`,
  };
}

/**
 * The jobs a decision applies to right now: for "rejected", jobs where the candidate is Rejected, their
 * application is declined, or (archived by the team for an emailable reason) any job they're in that isn't
 * hired or withdrawn; for "shortlisted", jobs where they're Shortlisted. `only` narrows to those jobs.
 */
async function decidedJobs(tx: Tx, orgId: string, candidateId: string, kind: DecisionKind, only: string[] | null): Promise<Job[]> {
  const [c] = await tx<{ archived_at: Date | null; archived_auto: boolean; archived_reason: string | null }[]>`
    select archived_at, archived_auto, archived_reason from candidates where id = ${candidateId} and organization_id = ${orgId}`;
  if (!c) throw new ApiError(404, "Candidate not found");
  const archivedByTeam = !!c.archived_at && !c.archived_auto && emailableArchiveReason(c.archived_reason ?? "");
  const rows = await tx<(Job & { stage: string | null; app_status: string | null })[]>`
    select j.id, j.title, jc.stage::text as stage, a.status::text as app_status
    from jobs j
    left join job_candidates jc on jc.job_id = j.id and jc.candidate_id = ${candidateId}
    left join job_applications a on a.job_id = j.id and a.candidate_id = ${candidateId}
    where j.organization_id = ${orgId} and (jc.candidate_id is not null or a.candidate_id is not null)
      ${only ? tx`and j.id = any(${only})` : tx``}
    order by j.title`;
  return rows.filter((r) => kind === "shortlisted"
    ? r.stage === "shortlisted"
    : r.stage === "rejected" || r.app_status === "declined" || (archivedByTeam && r.stage !== "hired" && r.stage !== "withdrawn"))
    .map(({ id, title }) => ({ id, title }));
}

/** What the email would say, for the preview in the decision dialog. `jobIds` null: every job the decision covers. */
export async function getDecisionEmailDraft(orgId: string, candidateId: string, kind: DecisionKind, jobIds: string[] | null): Promise<DecisionEmailDraft> {
  return withOrg(orgId, async (tx) => {
    const [c] = await tx<{ name: string; email: string; company: string }[]>`
      select c.name, c.email, o.name as company from candidates c join organizations o on o.id = c.organization_id
      where c.id = ${candidateId} and c.organization_id = ${orgId}`;
    if (!c) throw new ApiError(404, "Candidate not found");
    // The jobs the dialog is about (the decision may not be saved yet), or the candidate's open jobs.
    const all = jobIds
      ? await tx<Job[]>`select id, title from jobs where organization_id = ${orgId} and id = any(${jobIds}) order by title`
      : await tx<Job[]>`
          select j.id, j.title from jobs j
          left join job_candidates jc on jc.job_id = j.id and jc.candidate_id = ${candidateId}
          left join job_applications a on a.job_id = j.id and a.candidate_id = ${candidateId}
          where j.organization_id = ${orgId} and (jc.candidate_id is not null or a.candidate_id is not null)
            and coalesce(jc.stage::text, '') not in ('hired', 'withdrawn')
          order by j.title`;
    const sent = await tx<{ job_id: string; job_title: string; sent_at: Date; sent_by_name: string | null }[]>`
      select e.job_id, j.title as job_title, e.sent_at, u.name as sent_by_name from candidate_decision_emails e
      join jobs j on j.id = e.job_id left join users u on u.id = e.sent_by
      where e.candidate_id = ${candidateId} and e.organization_id = ${orgId} and e.kind = ${kind}
        and e.job_id = any(${all.map((j) => j.id)}) order by e.sent_at desc`;
    const done = new Set(sent.map((s) => s.job_id));
    const jobs = all.filter((j) => !done.has(j.id));
    const firstName = c.name.trim().split(/\s+/)[0] || c.name;
    return { to: c.email, candidateName: c.name, jobs, ...decisionEmailText(kind, { firstName, company: c.company, jobs: jobs.map((j) => j.title) }), sent };
  });
}

/**
 * Send the email for a decision that's already saved. Only the jobs the decision covers and that haven't
 * had this email are included; the rows are claimed first, so two clicks can't send it twice.
 */
export async function sendDecisionEmail(orgId: string, userId: string, candidateId: string, input: z.infer<typeof SendDecisionEmailSchema>) {
  const claimed = await withOrg(orgId, async (tx) => {
    const decided = await decidedJobs(tx, orgId, candidateId, input.kind, input.jobIds);
    if (!decided.length) {
      throw new ApiError(409, input.kind === "shortlisted" ? "Shortlist the candidate first, then send the email." : "Save the decision first, then send the email.");
    }
    const ids: string[] = [];
    for (const j of decided) {
      const [row] = await tx`insert into candidate_decision_emails (organization_id, candidate_id, job_id, kind, sent_by)
        values (${orgId}, ${candidateId}, ${j.id}, ${input.kind}, ${userId}) on conflict do nothing returning job_id`;
      if (row) ids.push(j.id);
    }
    if (!ids.length) throw new ApiError(409, "This email was already sent.", "already_sent");
    const [c] = await tx<{ email: string }[]>`select email from candidates where id = ${candidateId}`;
    await audit(tx, { orgId, userId, action: "candidate.decision_email_sent", entityType: "candidate", entityId: candidateId, metadata: { kind: input.kind, job_ids: ids } });
    return { to: c.email, ids };
  });
  const sent = await sendEmail({ to: claimed.to, subject: input.subject, text: input.text, orgId, replyTo: await replyToUser(userId), brand: await companyBrand(orgId) });
  if (!sent.ok) {
    // Not sent: let the recruiter try again.
    await withOrg(orgId, (tx) => tx`delete from candidate_decision_emails
      where candidate_id = ${candidateId} and kind = ${input.kind} and job_id = any(${claimed.ids}) and organization_id = ${orgId}`);
    return { emailFailed: [claimed.to] };
  }
  return { ok: true };
}

/** Decision emails sent to a candidate, newest first, for their profile. */
export async function listDecisionEmails(orgId: string, candidateId: string) {
  return withOrg(orgId, (tx) => tx<{ job_id: string; job_title: string; kind: DecisionKind; sent_at: Date; sent_by_name: string | null }[]>`
    select e.job_id, j.title as job_title, e.kind, e.sent_at, u.name as sent_by_name from candidate_decision_emails e
    join jobs j on j.id = e.job_id left join users u on u.id = e.sent_by
    where e.candidate_id = ${candidateId} and e.organization_id = ${orgId} order by e.sent_at desc`);
}
