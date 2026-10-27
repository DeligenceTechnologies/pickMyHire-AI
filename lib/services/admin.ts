import "server-only";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { Role } from "@/lib/auth/permissions";
import { withSystem, type Tx } from "@/lib/database/db";
import { env } from "@/lib/env";
import type { InquiryTopic } from "@/lib/marketing";
import { generateToken, hashToken } from "@/lib/security/tokens";
import { platformAudit, writeSetting, getDefaultQuota, getSignupCode, getTrialSettings, type TrialSettings } from "./platform";
import { COUNTED_STATUSES, RUNNING_STATUSES, WAITING_STATUSES, getQuotaStatus } from "./quota";
import { storage } from "@/lib/storage";
import { log } from "@/lib/logger";

// Platform admin operations across all companies. Everything runs in the
// system context, so every function here must only be reached through
// requirePlatformAdmin / requirePlatformAdminApi, and every change is logged.
// Candidate content (videos, transcripts, resumes) is deliberately not exposed.

const COMPANY_INVITE_DAYS = 14;
const RESET_LINK_HOURS = 24;

/** Per-company quota counts, shared by the overview and the companies list. */
function quotaCounts(tx: Tx) {
  return tx`
    left join lateral (
      select
        count(*) filter (where i.status::text = any(${COUNTED_STATUSES}) and i.completed_at >= o.quota_counted_from)::int as used,
        count(*) filter (where i.status::text = any(${RUNNING_STATUSES})
          or (i.status::text = any(${WAITING_STATUSES}) and (i.token_expires_at is null or i.token_expires_at > now())))::int as in_progress
      from interviews i where i.organization_id = o.id
    ) q on true`;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function getOverview() {
  return withSystem(async (tx) => {
    const [totals] = await tx<{ companies: number; active: number; suspended: number; users: number; new_requests: number; pending_links: number; support_waiting: number }[]>`
      select
        (select count(*)::int from organizations) as companies,
        (select count(*)::int from organizations where status = 'active') as active,
        (select count(*)::int from organizations where status = 'suspended') as suspended,
        (select count(*)::int from users) as users,
        (select count(*)::int from access_requests where status = 'new') as new_requests,
        (select count(*)::int from support_tickets where status <> 'resolved' and not last_message_from_admin) as support_waiting,
        (select count(*)::int from company_invites where used_at is null and revoked_at is null and expires_at > now()) as pending_links`;
    const [month] = await tx<{ completed: number; minutes: number; ai_calls: number }[]>`
      select
        (select count(*)::int from interviews where completed_at >= date_trunc('month', now())) as completed,
        (select coalesce(sum(duration_seconds), 0)::int / 60 from interviews where completed_at >= date_trunc('month', now())) as minutes,
        (select count(*)::int from ai_usage where created_at >= date_trunc('month', now())) as ai_calls`;
    const outOfQuota = await tx<{ id: string; name: string; interview_quota: number; used: number; in_progress: number }[]>`
      select o.id, o.name, o.interview_quota, q.used, q.in_progress
      from organizations o ${quotaCounts(tx)}
      where o.status = 'active' and o.interview_quota is not null and q.used + q.in_progress >= o.interview_quota
      order by o.name limit 20`;
    const recentCompanies = await tx<{ id: string; name: string; created_at: Date; owner_email: string | null }[]>`
      select o.id, o.name, o.created_at,
        (select u.email from organization_members m join users u on u.id = m.user_id where m.organization_id = o.id and m.role = 'owner' limit 1) as owner_email
      from organizations o order by o.created_at desc limit 6`;
    const recentIssues = await tx<{ id: string; org_id: string; org_name: string; category: string | null; created_at: Date }[]>`
      select f.id, o.id as org_id, o.name as org_name, f.category, f.created_at
      from interview_feedback f join organizations o on o.id = f.organization_id
      where f.kind = 'issue' order by f.created_at desc limit 6`;
    const trials = await tx<{ id: string; name: string; created_at: Date; trial_days_left: number | null; interview_quota: number | null; used: number; in_progress: number; owner_email: string | null; same_domain: number }[]>`
      select o.id, o.name, o.created_at, case when o.trial_ends_at is null then null else greatest(0, ceil(extract(epoch from o.trial_ends_at - now()) / 86400))::int end as trial_days_left, o.interview_quota, q.used, q.in_progress,
        (select u.email from organization_members m join users u on u.id = m.user_id where m.organization_id = o.id and m.role = 'owner' limit 1) as owner_email,
        (select count(*)::int from organizations d where d.signup_domain = o.signup_domain and d.id <> o.id) as same_domain
      from organizations o ${quotaCounts(tx)}
      where o.plan = 'trial' order by o.created_at desc limit 8`;
    return { totals, month, outOfQuota, recentCompanies, recentIssues, trials };
  });
}

// ---------------------------------------------------------------------------
// Access requests and one-time company sign-up links
// ---------------------------------------------------------------------------

export type AccessRequestStatus = "new" | "contacted" | "approved" | "rejected" | "closed";

/** Home page inquiries: "Request access" (topic `access`) and "Contact us" (every other topic). */
export async function listAccessRequests(status?: AccessRequestStatus, topic?: InquiryTopic) {
  return withSystem((tx) => tx<{
    id: string; topic: InquiryTopic; topic_other: string | null; name: string; email: string; company: string | null; team_size: string | null; phone: string | null; message: string | null;
    status: AccessRequestStatus; notes: string | null; created_at: Date; reviewed_at: Date | null; reviewer: string | null;
  }[]>`
    select r.id, r.topic, r.topic_other, r.name, r.email, r.company, r.team_size, r.phone, r.message, r.status, r.notes, r.created_at, r.reviewed_at, u.name as reviewer
    from access_requests r left join users u on u.id = r.reviewed_by
    where true ${status ? tx`and r.status = ${status}` : tx``} ${topic ? tx`and r.topic = ${topic}` : tx``}
    order by (r.status = 'new') desc, r.created_at desc limit 200`);
}

export async function updateAccessRequest(adminId: string, id: string, input: { status?: AccessRequestStatus; notes?: string | null }) {
  await withSystem(async (tx) => {
    const [r] = await tx`
      update access_requests set
        status = coalesce(${input.status ?? null}, status),
        notes = case when ${input.notes !== undefined} then ${input.notes ?? null} else notes end,
        reviewed_by = ${adminId}, reviewed_at = now()
      where id = ${id} returning id`;
    if (!r) throw new ApiError(404, "Request not found");
    await platformAudit(tx, { adminId, action: "access_request.updated", targetType: "access_request", targetId: id, details: { status: input.status, notes_changed: input.notes !== undefined } });
  });
}

/** Create a one-time link that lets `email` create `companyName` with the given quota. */
export async function createCompanyInvite(adminId: string, input: { companyName: string; email: string; quota: number | null; accessRequestId?: string }) {
  const token = generateToken();
  await withSystem(async (tx) => {
    const existing = await tx`select 1 from users where email = ${input.email}`;
    if (existing.length) throw new ApiError(409, "This email already has an account. Add them to a company from the company page instead.");
    const [inv] = await tx<{ id: string }[]>`
      insert into company_invites (token_hash, company_name, email, interview_quota, access_request_id, created_by, expires_at)
      values (${hashToken(token)}, ${input.companyName}, ${input.email}, ${input.quota}, ${input.accessRequestId ?? null}, ${adminId},
              now() + make_interval(days => ${COMPANY_INVITE_DAYS}))
      returning id`;
    if (input.accessRequestId) {
      await tx`update access_requests set status = 'approved', reviewed_by = ${adminId}, reviewed_at = now() where id = ${input.accessRequestId}`;
    }
    await platformAudit(tx, {
      adminId, action: input.accessRequestId ? "access_request.approved" : "company_invite.created", targetType: "company_invite", targetId: inv.id,
      details: { company: input.companyName, email: input.email, quota: input.quota, access_request_id: input.accessRequestId },
    });
  });
  return { link: `${env().APP_URL}/signup?company=${token}`, expiresInDays: COMPANY_INVITE_DAYS };
}

export async function listCompanyInvites() {
  return withSystem((tx) => tx<{ id: string; company_name: string; email: string; interview_quota: number | null; expires_at: Date; created_at: Date }[]>`
    select id, company_name, email, interview_quota, expires_at, created_at from company_invites
    where used_at is null and revoked_at is null and expires_at > now() order by created_at desc`);
}

export async function revokeCompanyInvite(adminId: string, id: string) {
  await withSystem(async (tx) => {
    const [r] = await tx`update company_invites set revoked_at = now() where id = ${id} and used_at is null and revoked_at is null returning id`;
    if (!r) throw new ApiError(404, "Link not found or already used");
    await platformAudit(tx, { adminId, action: "company_invite.revoked", targetType: "company_invite", targetId: id });
  });
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export type CompanyFilter = "all" | "active" | "trial" | "suspended" | "out_of_quota";

export type CompanyRow = {
  id: string; name: string; status: "active" | "suspended"; created_at: Date; interview_quota: number | null;
  used: number; in_progress: number; members: number; owner_email: string | null; last_interview_at: Date | null;
  plan: "standard" | "trial"; trial_days_left: number | null; same_domain: number;
};

export async function listCompanies(opts: { q?: string; filter?: CompanyFilter } = {}) {
  const q = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
  const filter = opts.filter ?? "all";
  return withSystem((tx) => tx<CompanyRow[]>`
    select o.id, o.name, o.status, o.created_at, o.interview_quota, q.used, q.in_progress, o.plan, case when o.trial_ends_at is null then null else greatest(0, ceil(extract(epoch from o.trial_ends_at - now()) / 86400))::int end as trial_days_left,
      (select count(*)::int from organizations d where d.signup_domain = o.signup_domain and d.id <> o.id) as same_domain,
      (select count(*)::int from organization_members m where m.organization_id = o.id) as members,
      (select u.email from organization_members m join users u on u.id = m.user_id where m.organization_id = o.id and m.role = 'owner' limit 1) as owner_email,
      (select max(i.created_at) from interviews i where i.organization_id = o.id) as last_interview_at
    from organizations o ${quotaCounts(tx)}
    where true
      ${filter === "active" ? tx`and o.status = 'active'` : tx``}
      ${filter === "suspended" ? tx`and o.status = 'suspended'` : tx``}
      ${filter === "trial" ? tx`and o.plan = 'trial'` : tx``}
      ${filter === "out_of_quota" ? tx`and o.interview_quota is not null and q.used + q.in_progress >= o.interview_quota` : tx``}
      ${q ? tx`and (o.name ilike ${q} or exists (select 1 from organization_members m join users u on u.id = m.user_id where m.organization_id = o.id and u.email::text ilike ${q}))` : tx``}
    order by o.created_at desc limit 300`);
}

export async function getCompany(id: string) {
  const company = await withSystem(async (tx) => {
    const [org] = await tx<{ id: string; name: string; status: "active" | "suspended"; suspended_at: Date | null; created_at: Date; admin_notes: string | null; plan: "standard" | "trial"; trial_ends_at: Date | null; trial_days_left: number | null; signup_domain: string | null }[]>`
      select o.id, o.name, o.status, o.suspended_at, o.created_at, o.admin_notes, o.plan, o.trial_ends_at, case when o.trial_ends_at is null then null else greatest(0, ceil(extract(epoch from o.trial_ends_at - now()) / 86400))::int end as trial_days_left, o.signup_domain::text from organizations o where o.id = ${id}`;
    if (!org) return null;
    const members = await tx<{ id: string; user_id: string; name: string; email: string; role: Role; created_at: Date; disabled_at: Date | null; last_seen_at: Date | null }[]>`
      select m.id, m.user_id, u.name, u.email, m.role, m.created_at, u.disabled_at,
        (select max(s.last_seen_at) from sessions s where s.user_id = u.id) as last_seen_at
      from organization_members m join users u on u.id = m.user_id
      where m.organization_id = ${id}
      order by (m.role = 'owner') desc, m.created_at`;
    const invites = await tx<{ id: string; email: string; role: Role; expires_at: Date }[]>`
      select id, email, role, expires_at from organization_invites
      where organization_id = ${id} and accepted_at is null and expires_at > now() order by created_at desc`;
    const [usage] = await tx<{ jobs: number; candidates: number; interviews_total: number; completed_30d: number; minutes_30d: number; ai_calls_30d: number; ai_tokens_30d: number; recording_bytes: number }[]>`
      select
        (select count(*)::int from jobs where organization_id = ${id}) as jobs,
        (select count(*)::int from candidates where organization_id = ${id}) as candidates,
        (select count(*)::int from interviews where organization_id = ${id}) as interviews_total,
        (select count(*)::int from interviews where organization_id = ${id} and completed_at > now() - interval '30 days') as completed_30d,
        (select coalesce(sum(duration_seconds), 0)::int / 60 from interviews where organization_id = ${id} and completed_at > now() - interval '30 days') as minutes_30d,
        (select count(*)::int from ai_usage where organization_id = ${id} and created_at > now() - interval '30 days') as ai_calls_30d,
        (select coalesce(sum(input_tokens + output_tokens), 0)::bigint::float8 from ai_usage where organization_id = ${id} and created_at > now() - interval '30 days') as ai_tokens_30d,
        (select coalesce(sum(file_size), 0)::bigint::float8 from recordings where organization_id = ${id} and status = 'stored') as recording_bytes`;
    return { org, members, invites, usage };
  });
  if (!company) return null;
  return { ...company, quota: await getQuotaStatus(id) };
}

export async function updateCompany(adminId: string, id: string, input: {
  quota?: number | null; notes?: string | null; status?: "active" | "suspended";
  /** Free trial: add days (from today if it has already ended), or make it a full account. */
  extendTrialDays?: number; convertTrial?: boolean;
}) {
  await withSystem(async (tx) => {
    const [before] = await tx<{ status: string; interview_quota: number | null; plan: string; trial_ends_at: Date | null }[]>`select status, interview_quota, plan, trial_ends_at from organizations where id = ${id} for update`;
    if (!before) throw new ApiError(404, "Company not found");
    if ((input.extendTrialDays || input.convertTrial) && before.plan !== "trial") throw new ApiError(400, "This company isn't on a free trial.");
    if (input.extendTrialDays) {
      await tx`update organizations set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => ${input.extendTrialDays}) where id = ${id}`;
      await platformAudit(tx, { adminId, action: "company.trial_extended", targetType: "organization", targetId: id, details: { days: input.extendTrialDays, ends_was: before.trial_ends_at } });
    }
    if (input.convertTrial) {
      await tx`update organizations set plan = 'standard', trial_ends_at = null where id = ${id}`;
      await platformAudit(tx, { adminId, action: "company.trial_converted", targetType: "organization", targetId: id });
    }
    if (input.quota === undefined && input.notes === undefined && !input.status) return;
    if (input.quota !== undefined) await tx`update organizations set interview_quota = ${input.quota} where id = ${id}`;
    if (input.notes !== undefined) await tx`update organizations set admin_notes = ${input.notes} where id = ${id}`;
    if (input.status && input.status !== before.status) {
      if (input.status === "suspended") {
        await tx`update organizations set status = 'suspended', suspended_at = now() where id = ${id}`;
        // Sign everyone out of this company; people in other companies fall back to those.
        await tx`delete from sessions where organization_id = ${id}`;
      } else {
        await tx`update organizations set status = 'active', suspended_at = null where id = ${id}`;
      }
    }
    await platformAudit(tx, {
      adminId,
      action: input.status && input.status !== before.status ? (input.status === "suspended" ? "company.suspended" : "company.reactivated") : "company.updated",
      targetType: "organization", targetId: id,
      details: {
        ...(input.quota !== undefined ? { quota_from: before.interview_quota, quota_to: input.quota } : {}),
        ...(input.notes !== undefined ? { notes_changed: true } : {}),
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Company members
// ---------------------------------------------------------------------------

const MEMBER_ROLES: Role[] = ["admin", "recruiter", "interviewer", "viewer"];

/** Add someone to a company. Existing accounts join right away; new people get an invite link. */
export async function addCompanyMember(adminId: string, orgId: string, email: string, role: Role) {
  if (!MEMBER_ROLES.includes(role)) throw new ApiError(400, "Choose admin, recruiter, interviewer or viewer. Use transfer ownership for the owner role.");
  const token = generateToken();
  const result = await withSystem(async (tx) => {
    const [org] = await tx<{ id: string }[]>`select id from organizations where id = ${orgId}`;
    if (!org) throw new ApiError(404, "Company not found");
    const [user] = await tx<{ id: string }[]>`select id from users where email = ${email}`;
    if (user) {
      const member = await tx`select 1 from organization_members where organization_id = ${orgId} and user_id = ${user.id}`;
      if (member.length) throw new ApiError(409, "This person is already a member.");
      await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${user.id}, ${role})`;
      await audit(tx, { orgId, userId: null, actorType: "system", action: "team.joined", entityType: "user", entityId: user.id, metadata: { role, by: "platform_admin" } });
      await platformAudit(tx, { adminId, action: "company.member_added", targetType: "organization", targetId: orgId, details: { email, role } });
      return { added: true as const };
    }
    await tx`delete from organization_invites where organization_id = ${orgId} and email = ${email} and accepted_at is null`;
    await tx`insert into organization_invites (organization_id, email, role, token_hash, invited_by, expires_at)
      values (${orgId}, ${email}, ${role}, ${hashToken(token)}, ${adminId}, now() + interval '7 days')`;
    await platformAudit(tx, { adminId, action: "company.member_invited", targetType: "organization", targetId: orgId, details: { email, role } });
    return { added: false as const };
  });
  return result.added ? { added: true, link: null } : { added: false, link: `${env().APP_URL}/signup?invite=${token}` };
}

export async function changeCompanyMemberRole(adminId: string, orgId: string, memberId: string, role: Role) {
  if (!MEMBER_ROLES.includes(role)) throw new ApiError(400, "Use transfer ownership to make someone the owner.");
  await withSystem(async (tx) => {
    const [m] = await tx<{ role: Role }[]>`select role from organization_members where id = ${memberId} and organization_id = ${orgId}`;
    if (!m) throw new ApiError(404, "Member not found");
    if (m.role === "owner") throw new ApiError(400, "Transfer ownership to someone else first.");
    await tx`update organization_members set role = ${role} where id = ${memberId}`;
    await platformAudit(tx, { adminId, action: "company.member_role_changed", targetType: "organization", targetId: orgId, details: { member_id: memberId, from: m.role, to: role } });
  });
}

export async function removeCompanyMember(adminId: string, orgId: string, memberId: string) {
  await withSystem(async (tx) => {
    const [m] = await tx<{ role: Role; user_id: string; email: string }[]>`
      select m.role, m.user_id, u.email from organization_members m join users u on u.id = m.user_id where m.id = ${memberId} and m.organization_id = ${orgId}`;
    if (!m) throw new ApiError(404, "Member not found");
    if (m.role === "owner") throw new ApiError(400, "The owner can't be removed. Transfer ownership first.");
    await tx`delete from organization_members where id = ${memberId}`;
    await tx`delete from sessions where user_id = ${m.user_id} and organization_id = ${orgId}`;
    await platformAudit(tx, { adminId, action: "company.member_removed", targetType: "organization", targetId: orgId, details: { email: m.email, role: m.role } });
  });
}

export async function transferCompanyOwnership(adminId: string, orgId: string, memberId: string) {
  await withSystem(async (tx) => {
    const [target] = await tx<{ role: Role; email: string }[]>`
      select m.role, u.email from organization_members m join users u on u.id = m.user_id where m.id = ${memberId} and m.organization_id = ${orgId}`;
    if (!target) throw new ApiError(404, "Member not found");
    if (target.role === "owner") return;
    await tx`update organization_members set role = 'admin' where organization_id = ${orgId} and role = 'owner'`;
    await tx`update organization_members set role = 'owner' where id = ${memberId}`;
    await platformAudit(tx, { adminId, action: "company.ownership_transferred", targetType: "organization", targetId: orgId, details: { to: target.email } });
  });
}

export async function revokeCompanyMemberInvite(adminId: string, orgId: string, inviteId: string) {
  await withSystem(async (tx) => {
    const [r] = await tx`delete from organization_invites where id = ${inviteId} and organization_id = ${orgId} returning email`;
    if (!r) throw new ApiError(404, "Invitation not found");
    await platformAudit(tx, { adminId, action: "company.member_invite_revoked", targetType: "organization", targetId: orgId, details: { email: r.email } });
  });
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export type UserRow = {
  id: string; name: string; email: string; created_at: Date; disabled_at: Date | null; is_platform_admin: boolean;
  last_seen_at: Date | null; companies: { id: string; name: string; role: Role; status: string }[];
};

export async function listUsers(q?: string) {
  const like = q?.trim() ? `%${q.trim()}%` : null;
  return withSystem((tx) => tx<UserRow[]>`
    select u.id, u.name, u.email, u.created_at, u.disabled_at, u.is_platform_admin,
      (select max(s.last_seen_at) from sessions s where s.user_id = u.id) as last_seen_at,
      coalesce((select json_agg(json_build_object('id', o.id, 'name', o.name, 'role', m.role, 'status', o.status) order by m.created_at)
        from organization_members m join organizations o on o.id = m.organization_id where m.user_id = u.id), '[]'::json) as companies
    from users u
    ${like ? tx`where u.email::text ilike ${like} or u.name ilike ${like}` : tx``}
    order by u.created_at desc limit 200`);
}

export async function setUserDisabled(adminId: string, userId: string, disabled: boolean) {
  if (userId === adminId) throw new ApiError(400, "You can't disable your own account.");
  await withSystem(async (tx) => {
    const [u] = await tx<{ email: string }[]>`
      update users set disabled_at = ${disabled ? tx`now()` : null} where id = ${userId} returning email`;
    if (!u) throw new ApiError(404, "User not found");
    if (disabled) await tx`delete from sessions where user_id = ${userId}`;
    await platformAudit(tx, { adminId, action: disabled ? "user.disabled" : "user.enabled", targetType: "user", targetId: userId, details: { email: u.email } });
  });
}

/** A password reset link to share by hand (useful while email delivery isn't set up). */
export async function createPasswordResetLink(adminId: string, userId: string) {
  const token = generateToken();
  await withSystem(async (tx) => {
    const [u] = await tx<{ email: string }[]>`select email from users where id = ${userId}`;
    if (!u) throw new ApiError(404, "User not found");
    await tx`insert into password_resets (user_id, token_hash, expires_at)
      values (${userId}, ${hashToken(token)}, now() + make_interval(hours => ${RESET_LINK_HOURS}))`;
    await platformAudit(tx, { adminId, action: "user.reset_link_created", targetType: "user", targetId: userId, details: { email: u.email } });
  });
  return { link: `${env().APP_URL}/reset-password?token=${token}`, expiresInHours: RESET_LINK_HOURS };
}

// ---------------------------------------------------------------------------
// Settings and audit
// ---------------------------------------------------------------------------

export async function getPlatformSettings() {
  const [signupCode, defaultQuota, trial] = await Promise.all([getSignupCode(), getDefaultQuota(), getTrialSettings()]);
  return { signupCode, defaultQuota, trial };
}

export async function savePlatformSettings(adminId: string, input: { signupCodeEnabled: boolean; signupCode: string | null; defaultQuota: number | null; trial: TrialSettings }) {
  if (input.signupCodeEnabled && (!input.signupCode || input.signupCode.length < 8)) {
    throw new ApiError(400, "The access code needs at least 8 characters.");
  }
  const before = await getSignupCode();
  await withSystem(async (tx) => {
    await writeSetting(tx, "signup_code", { enabled: input.signupCodeEnabled, code: input.signupCode || null }, adminId);
    await writeSetting(tx, "default_quota", { value: input.defaultQuota }, adminId);
    await writeSetting(tx, "free_trial", input.trial, adminId);
    await platformAudit(tx, {
      adminId, action: "settings.updated", targetType: "platform", details: {
        signup_code_enabled: input.signupCodeEnabled, signup_code_changed: before.code !== (input.signupCode || null), default_quota: input.defaultQuota, free_trial: input.trial,
      },
    });
  });
}

export const PLATFORM_AUDIT_PAGE_SIZE = 50;

export async function listPlatformAudit(page = 1) {
  return withSystem((tx) => tx<{ id: string; action: string; target_type: string; target_id: string | null; details: Record<string, unknown>; created_at: Date; admin_name: string | null; admin_email: string | null }[]>`
    select l.id, l.action, l.target_type, l.target_id, l.details, l.created_at, u.name as admin_name, u.email as admin_email
    from platform_audit_logs l left join users u on u.id = l.admin_user_id
    order by l.created_at desc limit ${PLATFORM_AUDIT_PAGE_SIZE} offset ${(Math.max(1, page) - 1) * PLATFORM_AUDIT_PAGE_SIZE}`);
}

// ---------------------------------------------------------------------------
// Change email and permanent deletion
// ---------------------------------------------------------------------------

const trialHash = (email: string) => hashToken(`trial:${email.trim().toLowerCase()}`);

/** True when this email already used a free trial on an account that was deleted. */
export async function trialAlreadyUsed(email: string) {
  const [row] = await withSystem((tx) => tx`select 1 from used_trials where email_hash = ${trialHash(email)}`);
  return !!row;
}

/** Fix a mistyped email. The account, companies and history stay as they are. */
export async function changeUserEmail(adminId: string, userId: string, email: string) {
  const next = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next) || next.length > 254) throw new ApiError(400, "Enter a valid email address.");
  await withSystem(async (tx) => {
    const [u] = await tx<{ email: string }[]>`select email from users where id = ${userId} for update`;
    if (!u) throw new ApiError(404, "User not found");
    if (u.email.toLowerCase() === next) return;
    const [taken] = await tx`select 1 from users where email = ${next}`;
    if (taken) throw new ApiError(409, "Another account already uses this email.");
    // The new address hasn't been confirmed yet.
    await tx`update users set email = ${next}, email_verified_at = null where id = ${userId}`;
    await tx`delete from password_resets where user_id = ${userId}`;
    await tx`delete from email_verifications where user_id = ${userId}`;
    await platformAudit(tx, { adminId, action: "user.email_changed", targetType: "user", targetId: userId, details: { from: u.email, to: next } });
  });
}

type CompanyImpact = { id: string; name: string; jobs: number; candidates: number; interviews: number };

/** What deleting a user would also remove, and anything that blocks it. */
export async function userDeletionPreview(adminId: string, userId: string) {
  return withSystem(async (tx) => {
    const [u] = await tx<{ email: string; is_platform_admin: boolean }[]>`select email, is_platform_admin from users where id = ${userId}`;
    if (!u) throw new ApiError(404, "User not found");
    const memberships = await tx<{ org_id: string; name: string; role: Role; others: number; other_owners: number }[]>`
      select o.id as org_id, o.name, m.role,
        (select count(*)::int from organization_members x where x.organization_id = o.id and x.user_id <> ${userId}) as others,
        (select count(*)::int from organization_members x where x.organization_id = o.id and x.user_id <> ${userId} and x.role = 'owner') as other_owners
      from organization_members m join organizations o on o.id = m.organization_id where m.user_id = ${userId}`;
    const blockers: string[] = [];
    if (userId === adminId) blockers.push("You can't delete your own account.");
    if (u.is_platform_admin) blockers.push("This is a platform admin account.");
    const soloIds = memberships.filter((m) => m.others === 0).map((m) => m.org_id);
    for (const m of memberships) {
      if (m.others > 0 && m.role === "owner" && m.other_owners === 0) blockers.push(`${m.name}: transfer ownership to another member first.`);
    }
    // Scorecards are part of a company's hiring record: don't delete them from companies that stay.
    const scorecards = await tx<{ name: string; n: number }[]>`
      select o.name, count(*)::int as n from human_interview_scorecards s join organizations o on o.id = s.organization_id
      where s.user_id = ${userId} and not (s.organization_id = any(${soloIds}))
      group by o.name`;
    for (const s of scorecards) blockers.push(`${s.name}: has ${s.n} interview scorecard${s.n === 1 ? "" : "s"}. Disable this user instead, so their scorecards stay.`);
    const companies = soloIds.length ? await tx<CompanyImpact[]>`
      select o.id, o.name,
        (select count(*)::int from jobs where organization_id = o.id) as jobs,
        (select count(*)::int from candidates where organization_id = o.id) as candidates,
        (select count(*)::int from interviews where organization_id = o.id) as interviews
      from organizations o where o.id = any(${soloIds})` : [];
    return { email: u.email, blockers, companiesDeleted: companies, staysIn: memberships.filter((m) => m.others > 0).map((m) => m.name) };
  });
}

/** Free-trial companies (signed up without an invitation or code) record their members' emails. */
async function rememberTrials(tx: Tx, userIds: string[]) {
  if (!userIds.length) return;
  const rows = await tx<{ email: string }[]>`
    select distinct u.email from users u join organization_members m on m.user_id = u.id join organizations o on o.id = m.organization_id
    where u.id = any(${userIds}) and (o.plan = 'trial' or o.signup_domain is not null)`;
  for (const r of rows) await tx`insert into used_trials (email_hash) values (${trialHash(r.email)}) on conflict do nothing`;
}

/**
 * Permanently delete a user so their email can be used again. Companies where
 * they're the only member are deleted with them (all their data and files).
 */
export async function deleteUser(adminId: string, userId: string, confirmEmail: string) {
  const preview = await userDeletionPreview(adminId, userId);
  if (preview.blockers.length) throw new ApiError(409, preview.blockers.join(" "));
  if (confirmEmail.trim().toLowerCase() !== preview.email.toLowerCase()) throw new ApiError(400, "Type the user's email to confirm.");
  const orgIds = preview.companiesDeleted.map((c) => c.id);
  await withSystem(async (tx) => {
    await rememberTrials(tx, [userId]);
    if (orgIds.length) await tx`delete from organizations where id = any(${orgIds})`;
    await tx`delete from users where id = ${userId}`;
    await platformAudit(tx, { adminId, action: "user.deleted", targetType: "user", targetId: userId, details: { email: preview.email, companies_deleted: preview.companiesDeleted } });
  });
  await deleteCompanyFiles(orgIds);
}

/** What deleting a company would remove. */
export async function companyDeletionPreview(orgId: string) {
  return withSystem(async (tx) => {
    const [o] = await tx<(CompanyImpact & { status: string; recording_bytes: number })[]>`
      select o.id, o.name, o.status,
        (select count(*)::int from jobs where organization_id = o.id) as jobs,
        (select count(*)::int from candidates where organization_id = o.id) as candidates,
        (select count(*)::int from interviews where organization_id = o.id) as interviews,
        (select coalesce(sum(size), 0)::bigint::float8 from recording_chunks where organization_id = o.id) as recording_bytes
      from organizations o where o.id = ${orgId}`;
    if (!o) throw new ApiError(404, "Company not found");
    // Members with no other company lose their only workspace: their accounts can go too.
    const onlyHere = await tx<{ id: string; name: string; email: string }[]>`
      select u.id, u.name, u.email from organization_members m join users u on u.id = m.user_id
      where m.organization_id = ${orgId} and not u.is_platform_admin
        and not exists (select 1 from organization_members x where x.user_id = u.id and x.organization_id <> ${orgId})`;
    return { ...o, onlyHere };
  });
}

/**
 * Permanently delete a suspended company: every job, candidate, interview,
 * recording, resume and note. Optionally also the accounts of members who
 * belong to no other company, so their emails can be used again.
 */
export async function deleteCompany(adminId: string, orgId: string, input: { confirmName: string; deleteMembers: boolean }) {
  const preview = await companyDeletionPreview(orgId);
  if (preview.status !== "suspended") throw new ApiError(409, "Suspend the company before deleting it.");
  if (input.confirmName.trim() !== preview.name.trim()) throw new ApiError(400, "Type the company name exactly to confirm.");
  const userIds = input.deleteMembers ? preview.onlyHere.map((u) => u.id).filter((id) => id !== adminId) : [];
  await withSystem(async (tx) => {
    await rememberTrials(tx, userIds);
    await tx`delete from organizations where id = ${orgId}`;
    if (userIds.length) await tx`delete from users where id = any(${userIds})`;
    await platformAudit(tx, {
      adminId, action: "company.deleted", targetType: "organization", targetId: orgId,
      details: { name: preview.name, jobs: preview.jobs, candidates: preview.candidates, interviews: preview.interviews, members_deleted: preview.onlyHere.filter((u) => userIds.includes(u.id)).map((u) => u.email) },
    });
  });
  await deleteCompanyFiles([orgId]);
}

/** Every stored file of a company lives under its id: recordings, resumes, photos, logo. */
async function deleteCompanyFiles(orgIds: string[]) {
  for (const id of orgIds) {
    try {
      await storage().deletePrefix(`${id}/`);
    } catch (err) {
      log.warn("company.files_delete_failed", { orgId: id, err });
    }
  }
}
