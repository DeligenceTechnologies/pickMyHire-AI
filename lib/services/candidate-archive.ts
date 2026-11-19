import "server-only";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { withOrg, type Tx } from "@/lib/database/db";

// Archived candidates leave the active Candidates list but keep all their data. The team archives with a
// reason, or it happens automatically once every job a person is in has them Rejected or Withdrawn (and is
// undone automatically if that changes). Inviting an archived candidate brings them back.

export const ARCHIVE_REASONS = ["Budget", "Location", "Not interested", "Not a fit", "Hired elsewhere", "Other"] as const;

export async function archiveCandidate(orgId: string, userId: string, candidateId: string, reason: string) {
  const clean = reason.trim().slice(0, 200);
  if (!clean) throw new ApiError(400, "Choose a reason.");
  await withOrg(orgId, async (tx) => {
    const [row] = await tx`update candidates set archived_at = now(), archived_reason = ${clean}, archived_auto = false, archived_by = ${userId}
      where id = ${candidateId} and organization_id = ${orgId} returning id`;
    if (!row) throw new ApiError(404, "Candidate not found");
    await audit(tx, { orgId, userId, action: "candidate.archived", entityType: "candidate", entityId: candidateId, metadata: { reason: clean } });
  });
}

export async function restoreCandidate(orgId: string, userId: string, candidateId: string) {
  await withOrg(orgId, async (tx) => {
    const [row] = await tx`update candidates set archived_at = null, archived_reason = null, archived_auto = false, archived_by = null
      where id = ${candidateId} and organization_id = ${orgId} returning id`;
    if (!row) throw new ApiError(404, "Candidate not found");
    await audit(tx, { orgId, userId, action: "candidate.restored", entityType: "candidate", entityId: candidateId });
  });
}

/**
 * After a stage change: archive the candidate when every job they're in has them Rejected or Withdrawn,
 * and bring back one that was archived that way when it's no longer true. Archives made by hand are left alone.
 */
export async function syncAutoArchive(tx: Tx, orgId: string, candidateId: string, userId: string | null) {
  const [s] = await tx<{ total: number; closed: number; withdrawn: number; archived_at: Date | null; archived_auto: boolean }[]>`
    select count(jc.*)::int as total,
      count(*) filter (where jc.stage in ('rejected', 'withdrawn'))::int as closed,
      count(*) filter (where jc.stage = 'withdrawn')::int as withdrawn,
      c.archived_at, c.archived_auto
    from candidates c left join job_candidates jc on jc.candidate_id = c.id
    where c.id = ${candidateId} and c.organization_id = ${orgId} group by c.id`;
  if (!s) return;
  const allClosed = s.total > 0 && s.closed === s.total;
  if (allClosed && !s.archived_at) {
    const reason = s.withdrawn === s.total ? "Withdrawn" : "Rejected";
    await tx`update candidates set archived_at = now(), archived_reason = ${reason}, archived_auto = true, archived_by = ${userId} where id = ${candidateId}`;
    await audit(tx, { orgId, userId, actorType: userId ? "user" : "system", action: "candidate.archived", entityType: "candidate", entityId: candidateId, metadata: { reason, auto: true } });
  } else if (!allClosed && s.archived_at && s.archived_auto) {
    await tx`update candidates set archived_at = null, archived_reason = null, archived_auto = false, archived_by = null where id = ${candidateId}`;
    await audit(tx, { orgId, userId, actorType: userId ? "user" : "system", action: "candidate.restored", entityType: "candidate", entityId: candidateId, metadata: { auto: true } });
  }
}

/** Inviting someone who was archived (for any reason) makes them active again. */
export async function restoreOnInvite(tx: Tx, orgId: string, candidateId: string, userId: string) {
  const [row] = await tx`update candidates set archived_at = null, archived_reason = null, archived_auto = false, archived_by = null
    where id = ${candidateId} and organization_id = ${orgId} and archived_at is not null returning id`;
  if (row) await audit(tx, { orgId, userId, action: "candidate.restored", entityType: "candidate", entityId: candidateId, metadata: { via: "invite" } });
}
