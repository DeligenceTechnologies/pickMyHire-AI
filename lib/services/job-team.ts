import "server-only";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { withOrg, type Tx } from "@/lib/database/db";
import type { Role } from "@/lib/auth/permissions";

// A job's hiring team (job_members). Owners, Admins and Recruiters on it get the job's emails; Interviewers
// on it can see the job. Managed in the job form; panel members of a live round join it on their own.

export type JobTeamMember = { user_id: string; name: string; email: string; role: Role };

/** Roles whose members get a job's emails when they're on its team. */
const EMAIL_ROLES: Role[] = ["owner", "admin", "recruiter"];

export async function listJobTeam(orgId: string, jobId: string) {
  return withOrg(orgId, (tx) => tx<JobTeamMember[]>`
    select jm.user_id, u.name, u.email, m.role from job_members jm
    join organization_members m on m.user_id = jm.user_id and m.organization_id = jm.organization_id
    join users u on u.id = jm.user_id
    where jm.job_id = ${jobId} and jm.organization_id = ${orgId} and u.disabled_at is null
    order by array_position(array['owner','admin','recruiter','interviewer','viewer']::text[], m.role::text), lower(u.name)`);
}

/** Everyone who can be put on a hiring team (all active members of the company). */
export async function listTeamOptions(orgId: string) {
  return withOrg(orgId, (tx) => tx<JobTeamMember[]>`
    select m.user_id, u.name, u.email, m.role from organization_members m join users u on u.id = m.user_id
    where m.organization_id = ${orgId} and u.disabled_at is null order by lower(u.name)`);
}

async function assertMembers(tx: Tx, orgId: string, userIds: string[]) {
  if (!userIds.length) return;
  const found = await tx<{ user_id: string }[]>`
    select user_id from organization_members where organization_id = ${orgId} and user_id = any(${userIds})`;
  if (found.length !== new Set(userIds).size) throw new ApiError(400, "Someone on the hiring team isn't in your company.");
}

/** Add people to a job's team (already-added people are left as they are). */
export async function addToJobTeam(tx: Tx, orgId: string, jobId: string, userIds: string[], addedBy: string | null) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  await assertMembers(tx, orgId, ids);
  for (const uid of ids) {
    await tx`insert into job_members (job_id, user_id, organization_id, added_by) values (${jobId}, ${uid}, ${orgId}, ${addedBy}) on conflict do nothing`;
  }
}

/** Replace a job's team with exactly these people. */
export async function setJobTeam(tx: Tx, orgId: string, jobId: string, userIds: string[], by: string) {
  const ids = [...new Set(userIds)];
  await assertMembers(tx, orgId, ids);
  const before = await tx<{ user_id: string }[]>`select user_id from job_members where job_id = ${jobId} and organization_id = ${orgId}`;
  const had = new Set(before.map((r) => r.user_id));
  const added = ids.filter((id) => !had.has(id));
  const removed = [...had].filter((id) => !ids.includes(id));
  if (removed.length) await tx`delete from job_members where job_id = ${jobId} and organization_id = ${orgId} and user_id = any(${removed})`;
  await addToJobTeam(tx, orgId, jobId, added, by);
  if (added.length || removed.length) {
    await audit(tx, { orgId, userId: by, action: "job.team_changed", entityType: "job", entityId: jobId, metadata: { added, removed } });
  }
}

/**
 * Who gets a job's emails: the Owners, Admins and Recruiters on its team. A job with none of them on
 * its team (e.g. its creator left) falls back to every Owner, Admin and Recruiter, so no email is lost.
 */
export async function jobEmailRecipients(tx: Tx, orgId: string, jobId: string) {
  const team = await tx<{ email: string }[]>`
    select u.email from job_members jm
    join organization_members m on m.user_id = jm.user_id and m.organization_id = jm.organization_id
    join users u on u.id = jm.user_id
    where jm.job_id = ${jobId} and jm.organization_id = ${orgId} and m.role::text = any(${EMAIL_ROLES}) and u.disabled_at is null`;
  if (team.length) return team;
  return tx<{ email: string }[]>`
    select u.email from organization_members m join users u on u.id = m.user_id
    where m.organization_id = ${orgId} and m.role::text = any(${EMAIL_ROLES}) and u.disabled_at is null`;
}
