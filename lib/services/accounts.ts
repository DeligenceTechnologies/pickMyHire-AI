import "server-only";
import { json, withOrg, withSystem } from "@/lib/database/db";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { companyBrand, emailTemplates, failedRecipients, replyToUser, sendEmail } from "@/lib/email";
import { DEFAULT_TEMPLATES } from "@/lib/interview/default-templates";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { generateToken, hashToken } from "@/lib/security/tokens";
import type { Role } from "@/lib/auth/permissions";
import { OrgSettingsSchema } from "./org-settings";
import { getDefaultQuota, platformAudit } from "./platform";
import { insertTemplate } from "./templates";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";
}

export async function signup(input: {
  name: string; email: string; password: string; orgName?: string; inviteToken?: string; companyInviteToken?: string;
  /** Self-serve free trial: this many interviews for this many days. */
  trial?: { interviews: number; days: number; domain: string };
}) {
  const defaultQuota = await getDefaultQuota();
  const passwordHash = await hashPassword(input.password);
  return withSystem(async (tx) => {
    const existing = await tx`select 1 from users where email = ${input.email}`;
    if (existing.length) throw new ApiError(409, "An account with this email already exists. Try signing in.");

    const [user] = await tx<{ id: string }[]>`
      insert into users (email, name, password_hash) values (${input.email}, ${input.name}, ${passwordHash}) returning id`;

    if (input.inviteToken) {
      const [invite] = await tx<{ id: string; organization_id: string; role: Role; email: string }[]>`
        select id, organization_id, role, email from organization_invites
        where token_hash = ${hashToken(input.inviteToken)} and accepted_at is null and expires_at > now()`;
      if (!invite) throw new ApiError(400, "This invitation link is invalid or has expired.");
      if (invite.email.toLowerCase() !== input.email.toLowerCase()) throw new ApiError(400, "Please sign up with the email address the invitation was sent to.");
      await tx`insert into organization_members (organization_id, user_id, role) values (${invite.organization_id}, ${user.id}, ${invite.role})`;
      await tx`update users set email_verified_at = now() where id = ${user.id}`;
      await tx`update organization_invites set accepted_at = now() where id = ${invite.id}`;
      await audit(tx, { orgId: invite.organization_id, userId: user.id, action: "team.joined", entityType: "user", entityId: user.id, metadata: { role: invite.role } });
      return { userId: user.id, orgId: invite.organization_id };
    }

    // A one-time company link (from an approved access request) fixes the company name and quota.
    let companyInvite: { id: string; company_name: string; email: string; interview_quota: number | null } | undefined;
    if (input.companyInviteToken) {
      [companyInvite] = await tx<{ id: string; company_name: string; email: string; interview_quota: number | null }[]>`
        select id, company_name, email, interview_quota from company_invites
        where token_hash = ${hashToken(input.companyInviteToken)} and used_at is null and revoked_at is null and expires_at > now()
        for update`;
      if (!companyInvite) throw new ApiError(400, "This sign-up link is invalid or has expired. Please contact us for a new one.");
      if (companyInvite.email.toLowerCase() !== input.email.toLowerCase()) throw new ApiError(400, "Please sign up with the email address this link was created for.");
    }
    const orgName = companyInvite?.company_name ?? (input.orgName?.trim() || `${input.name.split(" ")[0]}'s Team`);
    const trial = !companyInvite ? input.trial : undefined;
    const quota = companyInvite ? companyInvite.interview_quota : trial ? trial.interviews : defaultQuota;
    const slug = `${slugify(orgName)}-${generateToken(6).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5)}`;
    const [org] = await tx<{ id: string }[]>`
      insert into organizations (name, slug, settings, interview_quota, quota_counted_from, plan, trial_ends_at, signup_domain)
      values (${orgName}, ${slug}, ${json(OrgSettingsSchema.parse({}))}, ${quota}, now(),
        ${trial ? "trial" : "standard"}, ${trial ? new Date(Date.now() + trial.days * 86_400_000) : null}, ${trial?.domain ?? null}) returning id`;
    // Approval links prove the address (we sent it there); a trial confirms it by email when that's switched on.
    if (companyInvite) await tx`update users set email_verified_at = now() where id = ${user.id}`;
    if (companyInvite) await tx`update company_invites set used_at = now(), organization_id = ${org.id} where id = ${companyInvite.id}`;
    await tx`insert into organization_members (organization_id, user_id, role) values (${org.id}, ${user.id}, 'owner')`;
    for (const [i, t] of DEFAULT_TEMPLATES.entries()) await insertTemplate(tx, org.id, user.id, t, i === 0);
    await audit(tx, { orgId: org.id, userId: user.id, action: "auth.signup", entityType: "organization", entityId: org.id });
    if (trial) await platformAudit(tx, { adminId: null, action: "company.trial_started", targetType: "organization", targetId: org.id, details: { company: orgName, email: input.email, domain: trial.domain } });
    return { userId: user.id, orgId: org.id };
  });
}

const DUMMY_HASH = "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

export async function authenticate(email: string, password: string) {
  const [user] = await withSystem((tx) => tx<{ id: string; password_hash: string; is_platform_admin: boolean; disabled_at: Date | null }[]>`
    select id, password_hash, is_platform_admin, disabled_at from users where email = ${email}`);
  // Always run a hash comparison to keep response timing uniform.
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw new ApiError(401, "Incorrect email or password.");
  if (user.disabled_at) throw new ApiError(403, "This account has been disabled. Please contact support.");
  const memberships = await withSystem((tx) => tx<{ organization_id: string; status: string }[]>`
    select m.organization_id, o.status from organization_members m join organizations o on o.id = m.organization_id
    where m.user_id = ${user.id} order by m.created_at`);
  const m = memberships.find((x) => x.status === "active");
  if (!m && memberships.length && !user.is_platform_admin) {
    throw new ApiError(403, "This company account is suspended. Please contact support.");
  }
  if (m) await withOrg(m.organization_id, (tx) => audit(tx, { orgId: m.organization_id, userId: user.id, action: "auth.login", entityType: "user", entityId: user.id }));
  return { userId: user.id, orgId: m?.organization_id ?? null, isPlatformAdmin: user.is_platform_admin };
}

export async function requestPasswordReset(email: string) {
  const [user] = await withSystem((tx) => tx<{ id: string }[]>`select id from users where email = ${email}`);
  if (!user) return; // Do not reveal whether an account exists.
  const token = generateToken();
  await withSystem((tx) => tx`
    insert into password_resets (user_id, token_hash, expires_at) values (${user.id}, ${hashToken(token)}, now() + interval '1 hour')`);
  const tpl = emailTemplates.passwordReset({ link: `${env().APP_URL}/reset-password?token=${token}` });
  await sendEmail({ to: email, ...tpl });
}

/** Email a link that confirms the user's address. */
export async function sendEmailVerification(userId: string) {
  const [user] = await withSystem((tx) => tx<{ email: string; name: string; email_verified_at: Date | null }[]>`
    select email, name, email_verified_at from users where id = ${userId}`);
  if (!user || user.email_verified_at) return { sent: false };
  const token = generateToken();
  await withSystem((tx) => tx`
    insert into email_verifications (user_id, token_hash, expires_at) values (${userId}, ${hashToken(token)}, now() + interval '3 days')`);
  const tpl = emailTemplates.verifyEmail({ name: user.name.split(" ")[0], link: `${env().APP_URL}/verify-email?token=${token}` });
  return { sent: (await sendEmail({ to: user.email, ...tpl })).ok };
}

/** Confirm an email address from a verification link. Safe to open twice. */
export async function verifyEmail(token: string) {
  return withSystem(async (tx) => {
    const [v] = await tx<{ id: string; user_id: string; used_at: Date | null }[]>`
      select id, user_id, used_at from email_verifications where token_hash = ${hashToken(token)} and expires_at > now()`;
    if (!v) return { ok: false as const };
    await tx`update users set email_verified_at = coalesce(email_verified_at, now()) where id = ${v.user_id}`;
    if (!v.used_at) await tx`update email_verifications set used_at = now() where id = ${v.id}`;
    return { ok: true as const };
  });
}

export async function resetPassword(token: string, password: string) {
  const passwordHash = await hashPassword(password);
  await withSystem(async (tx) => {
    const [r] = await tx<{ id: string; user_id: string }[]>`
      select id, user_id from password_resets where token_hash = ${hashToken(token)} and used_at is null and expires_at > now()`;
    if (!r) throw new ApiError(400, "This reset link is invalid or has expired.");
    await tx`update users set password_hash = ${passwordHash}, email_verified_at = coalesce(email_verified_at, now()) where id = ${r.user_id}`;
    await tx`update password_resets set used_at = now() where id = ${r.id}`;
    await tx`delete from sessions where user_id = ${r.user_id}`;
  });
}

export async function inviteMember(auth: { orgId: string; orgName: string; userId: string; name: string }, email: string, role: Role) {
  const token = generateToken();
  await withOrg(auth.orgId, async (tx) => {
    const members = await tx`select 1 from organization_members m join users u on u.id = m.user_id where m.organization_id = ${auth.orgId} and u.email = ${email}`;
    if (members.length) throw new ApiError(409, "This person is already a member.");
    await tx`delete from organization_invites where organization_id = ${auth.orgId} and email = ${email} and accepted_at is null`;
    await tx`insert into organization_invites (organization_id, email, role, token_hash, invited_by, expires_at)
      values (${auth.orgId}, ${email}, ${role}, ${hashToken(token)}, ${auth.userId}, now() + interval '7 days')`;
    await audit(tx, { orgId: auth.orgId, userId: auth.userId, action: "team.invited", entityType: "invite", metadata: { role } });
  });
  const link = `${env().APP_URL}/signup?invite=${token}`;
  const tpl = emailTemplates.teamInvite({ orgName: auth.orgName, inviter: auth.name, role, link });
  const sent = await sendEmail({ to: email, ...tpl, orgId: auth.orgId, replyTo: await replyToUser(auth.userId), brand: await companyBrand(auth.orgId) });
  return { link, emailFailed: failedRecipients([sent]) };
}

export async function getInvite(token: string) {
  const [invite] = await withSystem((tx) => tx<{ email: string; org_name: string; role: Role }[]>`
    select i.email, o.name as org_name, i.role from organization_invites i join organizations o on o.id = i.organization_id
    where i.token_hash = ${hashToken(token)} and i.accepted_at is null and i.expires_at > now()`);
  return invite ?? null;
}
