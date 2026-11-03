import "server-only";
import { withOrg } from "@/lib/database/db";
import { audit } from "@/lib/audit";
import { writeCandidateFeedback } from "@/lib/ai/candidate-feedback";
import { companyBrand, emailTemplates, replyToUser, sendEmail } from "@/lib/email";
import { ApiError } from "@/lib/api";
import { log } from "@/lib/logger";
import { readSettings } from "@/lib/services/org-settings";
import type { FinalReport } from "@/lib/validation/ai-schemas";

/** Too few answers to say anything specific: the candidate gets the confirmation only. */
const MIN_ANSWERS_FOR_FEEDBACK = 3;
/** Only interviews that ended recently: regenerating an old report never emails the candidate. */
const SEND_WITHIN_HOURS = 24;

/**
 * After an interview is processed, email the candidate once: a confirmation, plus
 * short AI feedback from the report when the company allows it and there's enough to
 * go on. Called after every processing run; the first call claims the send, so the
 * candidate never gets it twice (regenerated reports, retries, parallel runs).
 * Never throws: the interview and report are already saved.
 */
export async function sendCandidateFollowup(orgId: string, interviewId: string) {
  try {
    const claimed = await withOrg(orgId, async (tx) => {
      const [iv] = await tx<{
        candidate_name: string; candidate_email: string; job_title: string; org_name: string; round_name: string | null; created_by: string | null;
        settings: unknown; ended_reason: string | null; report_status: string | null; report_json: { final?: FinalReport } | null; answered: number;
      }[]>`
        update interviews i set candidate_email_sent_at = now()
        from candidates c, jobs j, organizations o
        where i.id = ${interviewId} and i.organization_id = ${orgId} and c.id = i.candidate_id and j.id = i.job_id and o.id = i.organization_id
          and i.candidate_email_sent_at is null and i.completed_at > now() - make_interval(hours => ${SEND_WITHIN_HOURS})
          and i.status in ('completed', 'processing', 'report_ready')
        returning c.name as candidate_name, c.email as candidate_email, j.title as job_title, o.name as org_name, i.round_name, i.created_by,
          o.settings, i.state->>'ended_reason' as ended_reason,
          (select r.status::text from interview_reports r where r.interview_id = i.id) as report_status,
          (select r.report_json from interview_reports r where r.interview_id = i.id) as report_json,
          (select count(*)::int from interview_answers a where a.interview_id = i.id and coalesce(a.transcript_text, '') <> '') as answered`;
      if (!iv) return null;
      const sections = await tx<{ name: string; summary: string | null; strengths: unknown; concerns: unknown }[]>`
        select s.name, e.summary, e.strengths, e.concerns from interview_sections s join section_evaluations e on e.section_id = s.id
        where s.interview_id = ${interviewId} order by s.sort_order`;
      return { iv, sections };
    });
    if (!claimed) return;
    const { iv, sections } = claimed;

    const final = iv.report_json?.final;
    const wantsFeedback = readSettings(iv.settings).candidate_feedback_email && iv.report_status === "completed" && !!final
      && iv.ended_reason !== "left" && iv.answered >= MIN_ANSWERS_FOR_FEEDBACK;
    const texts = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : String((x as { point?: string })?.point ?? ""))).filter(Boolean) : []);
    const { feedback, held } = wantsFeedback && final
      ? await writeCandidateFeedback({
        orgId, jobTitle: iv.job_title, answeredQuestions: iv.answered, reportSummary: final.summary,
        strengths: final.strengths.map((s) => s.point), areasToBuild: final.areas_to_explore.map((a) => a.point),
        sections: sections.map((s) => ({ name: s.name, summary: s.summary, strengths: texts(s.strengths), concerns: texts(s.concerns) })),
      })
      : { feedback: null, held: null };

    const tpl = emailTemplates.candidateThankYou({ candidateName: iv.candidate_name.split(" ")[0], jobTitle: iv.job_title, companyName: iv.org_name, roundName: iv.round_name, feedback });
    const sent = await sendEmail({ to: iv.candidate_email, ...tpl, orgId, replyTo: await replyToUser(iv.created_by), brand: await companyBrand(orgId) });
    await withOrg(orgId, async (tx) => {
      await tx`update interviews set candidate_feedback = ${feedback}, candidate_feedback_draft = ${held?.draft ?? null},
        candidate_feedback_held_reason = ${held?.reason.slice(0, 200) ?? null} where id = ${interviewId}`;
      await audit(tx, { orgId, actorType: "system", action: "interview.candidate_emailed", entityType: "interview", entityId: interviewId, metadata: { feedback: !!feedback, held: !!held, sent: sent.ok } });
    });
  } catch (err) {
    log.warn("interview.candidate_followup_failed", { interviewId, err });
  }
}

/**
 * A recruiter approved feedback the safety check held back: email that exact text to
 * the candidate, once. Returns false when there's nothing to send or it was already sent.
 */
export async function sendHeldFeedback(orgId: string, userId: string, interviewId: string): Promise<boolean> {
  const claimed = await withOrg(orgId, async (tx) => {
    const [iv] = await tx<{ candidate_name: string; candidate_email: string; job_title: string; org_name: string; round_name: string | null; draft: string }[]>`
      update interviews i set candidate_feedback_sent_at = now(), candidate_feedback_sent_by = ${userId},
        candidate_feedback = i.candidate_feedback_draft, candidate_feedback_draft = null
      from candidates c, jobs j, organizations o
      where i.id = ${interviewId} and i.organization_id = ${orgId} and c.id = i.candidate_id and j.id = i.job_id and o.id = i.organization_id
        and i.candidate_feedback_draft is not null and i.candidate_feedback is null and i.candidate_feedback_sent_at is null
      returning c.name as candidate_name, c.email as candidate_email, j.title as job_title, o.name as org_name, i.round_name, i.candidate_feedback as draft`;
    if (iv) await audit(tx, { orgId, userId, action: "interview.candidate_feedback_sent", entityType: "interview", entityId: interviewId, metadata: { manual: true } });
    return iv ?? null;
  });
  if (!claimed) return false;
  const tpl = emailTemplates.candidateFeedback({ candidateName: claimed.candidate_name.split(" ")[0], jobTitle: claimed.job_title, companyName: claimed.org_name, roundName: claimed.round_name, feedback: claimed.draft });
  const sent = await sendEmail({ to: claimed.candidate_email, ...tpl, orgId, replyTo: await replyToUser(userId), brand: await companyBrand(orgId) });
  if (!sent.ok) {
    // Let the recruiter try again rather than marking it sent.
    await withOrg(orgId, (tx) => tx`update interviews set candidate_feedback_draft = candidate_feedback, candidate_feedback = null,
      candidate_feedback_sent_at = null, candidate_feedback_sent_by = null where id = ${interviewId}`);
    throw new ApiError(502, "The email couldn't be sent. Please try again.");
  }
  return true;
}
