import "server-only";
import { withOrg } from "@/lib/database/db";
import { log } from "@/lib/logger";
import { ISSUE_CATEGORIES, type IssueCategory } from "@/lib/feedback";
import type { OutcomeInput } from "./outcome";

/**
 * Everything describeOutcome needs, from records the interview already keeps. No transcript or answer text.
 * Read-only, and never throws: if anything fails the card is simply not shown.
 */
export async function getOutcomeInput(orgId: string, interviewId: string): Promise<OutcomeInput | null> {
  return readOutcomeInput(orgId, interviewId).catch((err) => {
    log.warn("interview.outcome_failed", { interviewId, err });
    return null;
  });
}

async function readOutcomeInput(orgId: string, interviewId: string): Promise<OutcomeInput | null> {
  return withOrg(orgId, async (tx) => {
    const [iv] = await tx<{
      status: string; started_at: Date | null; completed_at: Date | null; duration_seconds: number | null; token_expires_at: Date | null;
      processing_error: string | null; last_activity: string | null; planned_minutes: number | null; created_at: Date;
    }[]>`
      select i.status, i.created_at, i.started_at, i.completed_at, i.duration_seconds, i.token_expires_at, i.processing_error,
        i.state->>'last_activity_at' as last_activity,
        (select sum(s.duration_minutes)::int from interview_template_sections s where s.template_id = i.template_id) as planned_minutes
      from interviews i where i.id = ${interviewId} and i.organization_id = ${orgId}`;
    if (!iv) return null;
    const [sections, events, audits, [signals]] = await Promise.all([
      tx<{ name: string; status: string }[]>`select name, status from interview_sections where interview_id = ${interviewId} order by sort_order`,
      tx<{ created_at: Date; type: string; payload: Record<string, unknown> }[]>`
        select created_at, type, payload from interview_events where interview_id = ${interviewId} order by created_at limit 500`,
      tx<{ created_at: Date; action: string; metadata: Record<string, unknown>; user_name: string | null }[]>`
        select a.created_at, a.action, a.metadata, u.name as user_name from audit_logs a left join users u on u.id = a.user_id
        -- Only entries since the interview was created: uses the (organization_id, created_at) index.
        where a.organization_id = ${orgId} and a.created_at >= ${iv.created_at} and a.entity_id = ${interviewId}
          and a.action in ('interview.completed', 'interview.cancelled', 'interview.issue_reported')
        order by a.created_at`,
      tx<{ last: Date | null }[]>`
        select greatest(
          (select max(created_at) from interview_events where interview_id = ${interviewId}),
          (select max(created_at) from transcript_segments where interview_id = ${interviewId}),
          (select max(c.created_at) from recording_chunks c join recordings r on r.id = c.recording_id where r.interview_id = ${interviewId}),
          (select max(created_at) from face_checks where interview_id = ${interviewId})
        ) as last`,
    ]);
    const lastActivity = iv.last_activity ? new Date(iv.last_activity) : null;
    const last = [signals?.last ?? null, lastActivity].filter((d): d is Date => !!d && !Number.isNaN(d.getTime())).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const completed = audits.filter((a) => a.action === "interview.completed").at(-1);
    return {
      status: iv.status,
      startedAt: iv.started_at,
      completedAt: iv.completed_at,
      durationSeconds: iv.duration_seconds,
      tokenExpiresAt: iv.token_expires_at,
      processingError: iv.processing_error,
      endReason: completed ? String(completed.metadata?.reason ?? "") || null : null,
      plannedMinutes: iv.planned_minutes,
      sections,
      events: events.map((e) => ({ at: e.created_at, type: e.type, payload: e.payload ?? {} })),
      lastSignalAt: last,
      issueReports: audits.filter((a) => a.action === "interview.issue_reported").map((a) => ({ at: a.created_at, category: ISSUE_CATEGORIES[String(a.metadata?.category) as IssueCategory] ?? "Something else" })),
      cancelledBy: audits.find((a) => a.action === "interview.cancelled")?.user_name ?? null,
    };
  });
}
