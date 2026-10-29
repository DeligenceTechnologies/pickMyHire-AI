import "server-only";
import { json, withOrg } from "@/lib/database/db";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { assignableRoles, type Role } from "@/lib/auth/permissions";
import { log } from "@/lib/logger";
import { paths, storage } from "@/lib/storage";
import { deleteFaceDataTx, facePaths } from "@/lib/interview/face";
import { OrgSettingsSchema, readSettings, type OrgSettings } from "./org-settings";

export async function getDashboard(orgId: string, opts: { includeCandidateData: boolean }) {
  return withOrg(orgId, async (tx) => {
    const [stats] = await tx<{
      active_jobs: number; candidates: number; invited: number; started: number; completed: number; in_progress: number;
    }[]>`
      select
        (select count(*)::int from jobs where organization_id = ${orgId} and status = 'active') as active_jobs,
        (select count(*)::int from candidates where organization_id = ${orgId}) as candidates,
        (select count(*)::int from interviews where organization_id = ${orgId} and status not in ('created','cancelled')) as invited,
        (select count(*)::int from interviews where organization_id = ${orgId} and started_at is not null) as started,
        (select count(*)::int from interviews where organization_id = ${orgId} and status in ('completed','processing','report_ready')) as completed,
        (select count(*)::int from interviews where organization_id = ${orgId} and status in ('in_progress','completing')) as in_progress`;
    const recent = await tx<{ id: string; status: string; candidate_name: string; job_title: string; at: Date }[]>`
      select i.id, i.status, c.name as candidate_name, j.title as job_title, coalesce(i.completed_at, i.started_at, i.invited_at, i.created_at) as at
      from interviews i join candidates c on c.id = i.candidate_id join jobs j on j.id = i.job_id
      where i.organization_id = ${orgId} and i.status <> 'cancelled'
      order by coalesce(i.completed_at, i.started_at, i.invited_at, i.created_at) desc limit 8`;
    const attention = await tx<{ id: string; title: string; reason: string }[]>`
      select j.id, j.title, case
        when exists (select 1 from job_applications a where a.job_id = j.id and a.status = 'new' and a.interview_id is null and a.screening_status = 'completed')
          then (select count(*) from job_applications a where a.job_id = j.id and a.status = 'new' and a.interview_id is null)::text || ' new application(s) to review'
        when not exists (select 1 from job_rounds r where r.job_id = j.id and r.template_id is not null) then 'No interview rounds set up'
        when j.parse_status = 'failed' then 'Job description analysis failed'
        when not exists (select 1 from interviews i where i.job_id = j.id) then 'No candidates invited yet'
        when exists (select 1 from interviews i where i.job_id = j.id and i.status in ('completed') and i.processing_error is not null) then 'A report needs a retry'
        when exists (select 1 from interviews i where i.job_id = j.id and i.status = 'invited' and i.invited_at < now() - interval '3 days') then 'Invitations pending over 3 days'
        end as reason
      from jobs j where j.organization_id = ${orgId} and j.status = 'active'`;
    // Application counts are candidate data; hide them from roles without candidate access.
    const visible = attention.filter((a) => a.reason && (opts.includeCandidateData || !a.reason.includes("application")));
    return { stats, recent, attention: visible };
  });
}

export async function getSettings(orgId: string): Promise<{ name: string; settings: OrgSettings }> {
  const [org] = await withOrg(orgId, (tx) => tx<{ name: string; settings: unknown }[]>`select name, settings from organizations where id = ${orgId}`);
  return { name: org.name, settings: readSettings(org.settings) };
}

export async function updateSettings(orgId: string, userId: string, input: { name?: string; settings?: Partial<OrgSettings> }) {
  await withOrg(orgId, async (tx) => {
    const [org] = await tx<{ settings: unknown }[]>`select settings from organizations where id = ${orgId} for update`;
    const merged = OrgSettingsSchema.parse({ ...readSettings(org.settings), ...(input.settings ?? {}) });
    await tx`update organizations set settings = ${json(merged)} ${input.name ? tx`, name = ${input.name}` : tx``} where id = ${orgId}`;
    await audit(tx, { orgId, userId, action: "settings.updated", entityType: "organization", entityId: orgId, metadata: { keys: Object.keys(input.settings ?? {}), name: !!input.name } });
  });
}

export async function listMembers(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const members = await tx<{ id: string; user_id: string; name: string; email: string; role: Role; created_at: Date }[]>`
      select m.id, m.user_id, u.name, u.email, m.role, m.created_at from organization_members m join users u on u.id = m.user_id
      where m.organization_id = ${orgId} order by m.created_at`;
    const invites = await tx<{ id: string; email: string; role: Role; expires_at: Date; created_at: Date }[]>`
      select id, email, role, expires_at, created_at from organization_invites
      where organization_id = ${orgId} and accepted_at is null and expires_at > now() order by created_at desc`;
    return { members, invites };
  });
}

export async function changeMemberRole(auth: { orgId: string; userId: string; role: Role }, memberId: string, role: Role) {
  if (!assignableRoles(auth.role).includes(role)) throw new ApiError(403, "You can't assign that role.");
  await withOrg(auth.orgId, async (tx) => {
    const [m] = await tx<{ user_id: string; role: Role }[]>`select user_id, role from organization_members where id = ${memberId} and organization_id = ${auth.orgId}`;
    if (!m) throw new ApiError(404, "Member not found");
    if (m.user_id === auth.userId) throw new ApiError(400, "You can't change your own role.");
    if (m.role === "owner") throw new ApiError(403, "The owner's role can't be changed.");
    if (!assignableRoles(auth.role).includes(m.role)) throw new ApiError(403, "You can't change this member's role.");
    await tx`update organization_members set role = ${role} where id = ${memberId}`;
    await audit(tx, { orgId: auth.orgId, userId: auth.userId, action: "team.role_changed", entityType: "member", entityId: memberId, metadata: { from: m.role, to: role } });
  });
}

export async function removeMember(auth: { orgId: string; userId: string; role: Role }, memberId: string) {
  await withOrg(auth.orgId, async (tx) => {
    const [m] = await tx<{ user_id: string; role: Role }[]>`select user_id, role from organization_members where id = ${memberId} and organization_id = ${auth.orgId}`;
    if (!m) throw new ApiError(404, "Member not found");
    if (m.user_id === auth.userId) throw new ApiError(400, "You can't remove yourself.");
    if (m.role === "owner" || !assignableRoles(auth.role).includes(m.role)) throw new ApiError(403, "You can't remove this member.");
    await tx`delete from organization_members where id = ${memberId}`;
    await audit(tx, { orgId: auth.orgId, userId: auth.userId, action: "team.removed", entityType: "member", entityId: memberId });
  });
}

export async function revokeInvite(orgId: string, inviteId: string) {
  await withOrg(orgId, (tx) => tx`delete from organization_invites where id = ${inviteId} and organization_id = ${orgId}`);
}

export async function listAudit(orgId: string, page = 1) {
  return withOrg(orgId, (tx) => tx<{ id: string; action: string; entity_type: string; entity_id: string | null; actor_type: string; user_name: string | null; metadata: Record<string, unknown>; created_at: Date }[]>`
    select a.id, a.action, a.entity_type, a.entity_id, a.actor_type, u.name as user_name, a.metadata, a.created_at
    from audit_logs a left join users u on u.id = a.user_id
    where a.organization_id = ${orgId} order by a.created_at desc limit 50 offset ${(page - 1) * 50}`);
}

export async function getUsage(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const byFeature = await tx<{ feature: string; calls: number; failures: number; input_tokens: number; output_tokens: number; avg_ms: number }[]>`
      select feature, count(*)::int as calls, count(*) filter (where not success)::int as failures,
        coalesce(sum(input_tokens), 0)::int as input_tokens, coalesce(sum(output_tokens), 0)::int as output_tokens,
        coalesce(avg(duration_ms), 0)::int as avg_ms
      from ai_usage where organization_id = ${orgId} and created_at > now() - interval '30 days'
      group by feature order by calls desc`;
    const [interviews] = await tx<{ total: number; minutes: number }[]>`
      select count(*)::int as total, coalesce(sum(duration_seconds), 0)::int / 60 as minutes
      from interviews where organization_id = ${orgId} and completed_at > now() - interval '30 days'`;
    return { byFeature, interviews };
  });
}

// Notifications are shared per organization (or targeted at one user); read and
// cleared state is tracked per person in notification_states.

const CANDIDATE_NOTIFICATIONS = ["application.received"];

export async function listNotifications(orgId: string, userId: string, opts: { includeCandidateData: boolean }) {
  return withOrg(orgId, (tx) => tx<{ id: string; type: string; payload: Record<string, string>; read_at: Date | null; created_at: Date }[]>`
    select n.id, n.type, n.payload, s.read_at, n.created_at
    from notifications n
    left join notification_states s on s.notification_id = n.id and s.user_id = ${userId}
    where n.organization_id = ${orgId} and (n.user_id is null or n.user_id = ${userId}) and s.dismissed_at is null
      ${opts.includeCandidateData ? tx`` : tx`and n.type <> all(${CANDIDATE_NOTIFICATIONS})`}
    order by n.created_at desc limit 20`);
}

export async function markNotificationsRead(orgId: string, userId: string) {
  await withOrg(orgId, (tx) => tx`
    insert into notification_states (notification_id, user_id, organization_id, read_at)
    select n.id, ${userId}, ${orgId}, now() from notifications n
    where n.organization_id = ${orgId} and (n.user_id is null or n.user_id = ${userId})
    on conflict (notification_id, user_id) do update set read_at = coalesce(notification_states.read_at, excluded.read_at)`);
}

/** Clear one notification (or all, when id is null) for this person only. */
export async function dismissNotifications(orgId: string, userId: string, id: string | null) {
  await withOrg(orgId, (tx) => tx`
    insert into notification_states (notification_id, user_id, organization_id, read_at, dismissed_at)
    select n.id, ${userId}, ${orgId}, now(), now() from notifications n
    where n.organization_id = ${orgId} and (n.user_id is null or n.user_id = ${userId})
      ${id ? tx`and n.id = ${id}` : tx``}
    on conflict (notification_id, user_id) do update set dismissed_at = now(), read_at = coalesce(notification_states.read_at, now())`);
}

export async function listOutbox(orgId: string) {
  return withOrg(orgId, (tx) => tx<{ id: string; to_email: string; subject: string; body_text: string; provider: string; status: string; created_at: Date }[]>`
    select id, to_email, subject, body_text, provider, status, created_at from email_outbox
    where organization_id = ${orgId} order by created_at desc limit 30`);
}

/** Targeted deletion of one kind of interview data. */
export async function deleteInterviewData(orgId: string, userId: string | null, interviewId: string, what: "recording" | "transcript" | "report" | "all") {
  await withOrg(orgId, async (tx) => {
    const [iv] = await tx`select id from interviews where id = ${interviewId} and organization_id = ${orgId}`;
    if (!iv) throw new ApiError(404, "Interview not found");
    if (what === "recording" || what === "all") {
      await tx`update recordings set status = 'deleted' where interview_id = ${interviewId}`;
      await deleteFaceDataTx(tx, interviewId);
    }
    if (what === "transcript" || what === "all") {
      await tx`delete from transcript_segments where interview_id = ${interviewId}`;
      await tx`update interview_answers set transcript_text = '[deleted]', analysis = null where interview_id = ${interviewId}`;
    }
    if (what === "report" || what === "all") {
      await tx`delete from interview_reports where interview_id = ${interviewId}`;
      await tx`delete from section_evaluations where interview_id = ${interviewId}`;
      await tx`update interview_sections set evaluation = null, summary = null, evaluation_status = null where interview_id = ${interviewId}`;
      await tx`update interviews set status = 'completed' where id = ${interviewId} and status = 'report_ready'`;
    }
    if (what === "all") await tx`delete from interviews where id = ${interviewId}`;
    await audit(tx, { orgId, userId, action: "interview.data_deleted", entityType: "interview", entityId: interviewId, metadata: { what } });
  });
  if (what === "recording" || what === "all") {
    await storage().deletePrefix(`${paths.interviewPrefix(orgId, interviewId)}recording/`);
    await storage().deletePrefix(facePaths.prefix(orgId, interviewId));
  }
  if (what === "all") await storage().deletePrefix(paths.interviewPrefix(orgId, interviewId));
}

/** Apply the organization's retention policy: remove interview media & text older than N days. */
export async function runRetention(orgId: string, userId: string | null) {
  const { settings } = await getSettings(orgId);
  if (!settings.retention_days) return { deleted: 0 };
  const old = await withOrg(orgId, (tx) => tx<{ id: string }[]>`
    select id from interviews where organization_id = ${orgId} and completed_at < now() - make_interval(days => ${settings.retention_days})
      and exists (select 1 from transcript_segments t where t.interview_id = interviews.id
                  union all select 1 from recordings r where r.interview_id = interviews.id and r.status <> 'deleted')`);
  for (const iv of old) {
    try {
      await deleteInterviewData(orgId, userId, iv.id, "recording");
      await deleteInterviewData(orgId, userId, iv.id, "transcript");
    } catch (err) {
      log.warn("retention.failed", { interviewId: iv.id, err });
    }
  }
  await withOrg(orgId, (tx) => audit(tx, { orgId, userId, actorType: userId ? "user" : "system", action: "privacy.retention_run", entityType: "organization", entityId: orgId, metadata: { interviews: old.length, days: settings.retention_days } }));
  return { deleted: old.length };
}

/** Candidate comparison for one job, using only recruiter-visible, job-relevant dimensions. */
export async function getComparison(orgId: string, jobId: string, roundName?: string | null) {
  return withOrg(orgId, async (tx) => {
    // Interviews are compared within one round; rounds are listed by job order, then any one-off rounds.
    const rounds = (await tx<{ name: string }[]>`
      select name from (
        select r.name, r.sort_order as o, 0 as k from job_rounds r where r.job_id = ${jobId}
        union all
        select distinct i.round_name, 1000, 1 from interviews i where i.job_id = ${jobId} and i.round_name is not null
          and i.status <> 'cancelled' and not exists (select 1 from job_rounds r where r.job_id = ${jobId} and r.name = i.round_name)
      ) x order by o, name`).map((r) => r.name).filter((n, i, a) => a.indexOf(n) === i);
    const round = roundName && rounds.includes(roundName) ? roundName : rounds[0] ?? null;
    const interviews = await tx<{ id: string; candidate_name: string; status: string; duration_seconds: number | null; completed_at: Date | null; attempt: number }[]>`
      select i.id, c.name as candidate_name, i.status, i.duration_seconds, i.completed_at, i.attempt from interviews i join candidates c on c.id = i.candidate_id
      -- Only interviews that have ended; invited, in-progress, expired and failed ones have nothing to compare.
      where i.job_id = ${jobId} and i.organization_id = ${orgId} and i.status in ('completed', 'processing', 'report_ready')
        ${round ? tx`and i.round_name = ${round}` : tx``}
      order by c.name, i.attempt`;
    const ids = interviews.map((i) => i.id);
    const sections = await tx<{ interview_id: string; name: string; sort_order: number; status: string; assessment: string | null; score: number | null }[]>`
      select s.interview_id, s.name, s.sort_order, s.status, e.assessment, e.score from interview_sections s
      left join section_evaluations e on e.section_id = s.id
      where s.interview_id = any(${ids})`;
    const names: string[] = [];
    for (const s of [...sections].sort((a, b) => a.sort_order - b.sort_order)) if (!names.includes(s.name)) names.push(s.name);
    return {
      rounds,
      round,
      columns: names,
      rows: interviews.map((iv) => ({
        ...iv,
        sections: Object.fromEntries(sections.filter((s) => s.interview_id === iv.id).map((s) => [s.name, { assessment: s.assessment, score: s.score, status: s.status }])),
      })),
    };
  });
}
