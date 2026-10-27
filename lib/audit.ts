import "server-only";
import { json, type Tx } from "@/lib/database/db";
import { log } from "@/lib/logger";

export type AuditAction =
  | "auth.signup" | "auth.login" | "team.invited" | "team.role_changed" | "team.removed" | "team.joined"
  | "job.created" | "job.updated" | "job.status_changed" | "job.parsed" | "job.deleted"
  | "candidate.created" | "candidate.updated" | "candidate.resume_uploaded" | "candidate.deleted" | "candidate.stage_changed"
  | "candidate.hr_details_updated" | "candidate.answers_updated" | "candidate.note_added" | "candidate.note_updated" | "candidate.note_deleted"
  | "interview.decision"
  | "human_interview.scheduled" | "human_interview.rescheduled" | "human_interview.cancelled" | "human_interview.completed"
  | "human_interview.no_show" | "human_interview.reopened" | "human_interview.scorecard_submitted" | "human_interview.scorecard_updated"
  | "job.apply_link_changed" | "application.received" | "application.screened" | "application.status_changed" | "application.interview_invited"
  | "template.created" | "template.updated" | "template.deleted"
  | "interview.created" | "interview.invited" | "interview.reminded" | "interview.cancelled" | "interview.plan_generated"
  | "interview.face_reference_saved"
  | "interview.consent_given" | "interview.started" | "interview.question_asked" | "interview.answer_received"
  | "interview.followup_generated" | "interview.section_completed" | "interview.completed"
  | "interview.evaluation_generated" | "interview.report_generated" | "interview.report_viewed"
  | "interview.evidence_viewed" | "interview.recording_accessed" | "interview.transcript_downloaded" | "interview.data_deleted"
  | "interview.feedback_submitted" | "interview.issue_reported"
  | "support.ticket_created" | "support.replied" | "support.status_changed"
  | "settings.updated" | "settings.branding_updated" | "privacy.retention_run";

/** Write an audit entry inside the caller's transaction. Never throws. */
export async function audit(tx: Tx, entry: {
  orgId: string;
  userId?: string | null;
  actorType?: "user" | "candidate" | "system";
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await tx`savepoint audit_sp`;
    await tx`
      insert into audit_logs (organization_id, user_id, actor_type, action, entity_type, entity_id, metadata)
      values (${entry.orgId}, ${entry.userId ?? null}, ${entry.actorType ?? "user"}, ${entry.action},
              ${entry.entityType}, ${entry.entityId ?? null}, ${json(entry.metadata ?? {})})`;
    await tx`release savepoint audit_sp`;
  } catch (err) {
    await tx`rollback to savepoint audit_sp`.catch(() => {});
    log.warn("audit.write_failed", { action: entry.action, err });
  }
}

export async function notify(tx: Tx, entry: { orgId: string; userId?: string | null; type: string; payload: Record<string, unknown> }) {
  await tx`
    insert into notifications (organization_id, user_id, type, payload)
    values (${entry.orgId}, ${entry.userId ?? null}, ${entry.type}, ${json(entry.payload)})`;
}
