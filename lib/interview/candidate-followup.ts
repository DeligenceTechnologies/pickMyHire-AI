import "server-only";
import { withOrg } from "@/lib/database/db";
import { audit } from "@/lib/audit";
import { writeCandidateFeedback } from "@/lib/ai/candidate-feedback";
import { companyBrand, emailTemplates, replyToUser, sendEmail } from "@/lib/email";
import { log } from "@/lib/logger";
import { readSettings } from "@/lib/services/org-settings";
import type { FinalReport } from "@/lib/validation/ai-schemas";

/** Too few answers to say anything specific: the candidate gets the confirmation only. */
const MIN_ANSWERS_FOR_FEEDBACK = 3;
/** Only interviews that ended recently: regenerating an old report never emails the candidate. */
const SEND_WITHIN_HOURS = 24;
/**
 * A claim older than this is treated as abandoned (the process died between claiming and
 * sending), so a later run can retry. Longer than the AI call (2 × 60s) plus the send.
 */
const STALE_CLAIM_MINUTES = 15;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

/**
 * After an interview is processed, email the candidate once: a confirmation, plus
 * short AI feedback from the report when the company allows it and there's enough to
 * go on. Called after every processing run.
 *
 * - Waits for the report: while it's failed or still generating, nothing is claimed, so a
 *   successful retry still sends the email (with feedback) instead of a bare confirmation.
 * - The first run claims the send, so the candidate never gets it twice (retries, parallel runs).
 * - `candidate_email_sent_at` is set only after the provider accepts the email; a failed
 *   send releases the claim for the next run.
 *
 * Never throws: the interview and report are already saved.
 */
export async function sendCandidateFollowup(orgId: string, interviewId: string) {
  let claimed = false;
  try {
    const data = await withOrg(orgId, async (tx) => {
      const [iv] = await tx<{
        candidate_name: string; candidate_email: string; job_title: string; org_name: string; round_name: string | null; created_by: string | null;
        settings: unknown; ended_reason: string | null; report_json: { final?: FinalReport } | null; answered: number;
      }[]>`
        update interviews i set candidate_email_claimed_at = now()
        from candidates c, jobs j, organizations o, interview_reports r
        where i.id = ${interviewId} and i.organization_id = ${orgId} and c.id = i.candidate_id and j.id = i.job_id and o.id = i.organization_id
          and r.interview_id = i.id and r.status = 'completed'
          and i.candidate_email_sent_at is null
          and (i.candidate_email_claimed_at is null or i.candidate_email_claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES}))
          and i.completed_at > now() - make_interval(hours => ${SEND_WITHIN_HOURS})
          and i.status in ('completed', 'report_ready')
        returning c.name as candidate_name, c.email as candidate_email, j.title as job_title, o.name as org_name, i.round_name, i.created_by,
          o.settings, i.state->>'ended_reason' as ended_reason, r.report_json,
          (select count(*)::int from interview_answers a where a.interview_id = i.id and coalesce(a.transcript_text, '') <> '') as answered`;
      if (!iv) return null;
      const sections = await tx<{ name: string; summary: string | null; strengths: unknown; concerns: unknown }[]>`
        select s.name, e.summary, e.strengths, e.concerns from interview_sections s join section_evaluations e on e.section_id = s.id
        where s.interview_id = ${interviewId} order by s.sort_order`;
      return { iv, sections };
    });
    if (!data) return;
    claimed = true;
    const { iv, sections } = data;

    const final = iv.report_json?.final;
    const wantsFeedback = readSettings(iv.settings).candidate_feedback_email && !!final
      && iv.ended_reason !== "left" && iv.answered >= MIN_ANSWERS_FOR_FEEDBACK;
    const texts = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : String((x as { point?: string })?.point ?? ""))).filter(Boolean) : []);
    const feedback = wantsFeedback && final
      ? await writeCandidateFeedback({
        orgId, jobTitle: iv.job_title, answeredQuestions: iv.answered, reportSummary: final.summary,
        strengths: final.strengths.map((s) => s.point), areasToBuild: final.areas_to_explore.map((a) => a.point),
        sections: sections.map((s) => ({ name: s.name, summary: s.summary, strengths: texts(s.strengths), concerns: texts(s.concerns) })),
      })
      : null;

    const tpl = emailTemplates.candidateThankYou({ candidateName: firstName(iv.candidate_name), jobTitle: iv.job_title, companyName: iv.org_name, roundName: iv.round_name, feedback });
    const sent = await sendEmail({ to: iv.candidate_email, ...tpl, orgId, replyTo: await replyToUser(iv.created_by), brand: await companyBrand(orgId) });
    // Once the email is out, never release the claim: a retry would send it twice.
    if (sent.ok) claimed = false;
    await withOrg(orgId, async (tx) => {
      if (sent.ok) {
        // What was sent and when, in one write, so the interview page shows exactly what the candidate got.
        await tx`update interviews set candidate_email_sent_at = now(), candidate_feedback = ${feedback} where id = ${interviewId}`;
      } else {
        await tx`update interviews set candidate_email_claimed_at = null where id = ${interviewId} and candidate_email_sent_at is null`;
      }
      await audit(tx, { orgId, actorType: "system", action: "interview.candidate_emailed", entityType: "interview", entityId: interviewId, metadata: { feedback: !!feedback, sent: sent.ok } });
    });
    claimed = false; // released above when the send failed
  } catch (err) {
    log.warn("interview.candidate_followup_failed", { interviewId, err });
    if (claimed) {
      // Release the claim so a later run can retry (the stale-claim timeout covers a crash).
      await withOrg(orgId, (tx) => tx`update interviews set candidate_email_claimed_at = null where id = ${interviewId} and candidate_email_sent_at is null`)
        .catch(() => undefined);
    }
  }
}
