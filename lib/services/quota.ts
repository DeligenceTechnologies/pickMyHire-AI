import "server-only";
import { ApiError } from "@/lib/api";
import { withOrg, type Tx } from "@/lib/database/db";
import { expirePurchases } from "./billing";
import { getTrialSettings } from "./platform";

// A company's interview balance. An interview is used when the candidate starts it (1, or 2 for
// templates longer than the pricing limit) and given back if it ends before the candidate answers
// anything. Invites don't hold anything: a company can invite with no interviews left, and the
// candidate sees a "can't start yet" page until more are added.

export type QuotaStatus = {
  /** null = unlimited */
  quota: number | null;
  /** Interviews used since countedFrom (an interview over the length limit counts as 2). */
  used: number;
  /** Invites waiting to be started, plus interviews running now (for display; they don't reduce `remaining`). */
  inProgress: number;
  /** Candidates who opened their link while the balance was too low and haven't started yet (link still valid). */
  onHold: number;
  /** null = unlimited */
  remaining: number | null;
  countedFrom: Date;
  plan: "standard" | "trial";
  trialEndsAt: Date | null;
  trialEnded: boolean;
  /** Whole days left in a trial (0 once ended); null when not a trial. */
  trialDaysLeft: number | null;
  /** Trial accounts waiting to confirm their email (only when verification is switched on). */
  needsVerification: boolean;
};

/** Interview statuses that mean the interview finished (used by the dashboard and admin counts). */
export const COUNTED_STATUSES = ["completed", "processing", "report_ready"];
/** Not-yet-started statuses (an invite waiting for the candidate). */
export const WAITING_STATUSES = ["created", "invited", "consent_pending", "device_check", "ready"];
export const RUNNING_STATUSES = ["in_progress", "completing"];

export { LOW_BALANCE } from "@/lib/pricing";

export const NO_INTERVIEWS_MESSAGE = "This interview can't start yet: the hiring company needs to add more interviews to their account. Your link stays valid.";
export const TRIAL_ENDED_MESSAGE = "Your free trial has ended. Buy interviews in Settings → Billing to keep interviewing.";
export const VERIFY_EMAIL_MESSAGE = "Confirm your email to start sending interviews. Check your inbox for the link.";

export async function readQuota(tx: Tx, orgId: string, opts: { lock?: boolean } = {}): Promise<QuotaStatus> {
  const [org] = await tx<{ interview_quota: number | null; quota_counted_from: Date; plan: "standard" | "trial"; trial_ends_at: Date | null; verified: boolean }[]>`
    select interview_quota, quota_counted_from, plan, trial_ends_at,
      exists (select 1 from organization_members m join users u on u.id = m.user_id
              where m.organization_id = organizations.id and u.email_verified_at is not null) as verified
    from organizations where id = ${orgId}
    ${opts.lock ? tx`for update` : tx``}`;
  if (!org) throw new ApiError(404, "Company not found");
  const [c] = await tx<{ used: number; in_progress: number; on_hold: number }[]>`
    select
      coalesce(sum(credits_used) filter (where credits_used > 0 and charged_at >= ${org.quota_counted_from}), 0)::int as used,
      count(*) filter (where status::text = any(${RUNNING_STATUSES})
        or (status::text = any(${WAITING_STATUSES}) and (token_expires_at is null or token_expires_at > now())))::int as in_progress,
      count(*) filter (where held_at is not null and status::text = any(${WAITING_STATUSES})
        and (token_expires_at is null or token_expires_at > now()))::int as on_hold
    from interviews
    where organization_id = ${orgId}`;
  const remaining = org.interview_quota == null ? null : Math.max(0, org.interview_quota - c.used);
  const trial = org.plan === "trial";
  const needsVerification = trial && !org.verified && (await getTrialSettings()).requireVerification;
  return {
    quota: org.interview_quota, used: c.used, inProgress: c.in_progress, onHold: c.on_hold, remaining, countedFrom: org.quota_counted_from,
    plan: org.plan, trialEndsAt: org.trial_ends_at, trialEnded: trial && !!org.trial_ends_at && org.trial_ends_at <= new Date(), needsVerification,
    trialDaysLeft: trial && org.trial_ends_at ? Math.max(0, Math.ceil((org.trial_ends_at.getTime() - Date.now()) / 86_400_000)) : null,
  };
}

export async function getQuotaStatus(orgId: string): Promise<QuotaStatus> {
  return withOrg(orgId, async (tx) => {
    // Purchased interviews past their validity come off first (an indexed no-op when none are due).
    await expirePurchases(tx, orgId);
    return readQuota(tx, orgId);
  });
}

/**
 * Throw when the company can't send invites at all: an ended trial, or an unconfirmed email.
 * A low or empty balance doesn't block invites (the candidate is asked to wait instead).
 */
export async function assertCanInvite(tx: Tx, orgId: string) {
  const q = await readQuota(tx, orgId);
  if (q.trialEnded) throw new ApiError(403, TRIAL_ENDED_MESSAGE, "trial_ended");
  if (q.needsVerification) throw new ApiError(403, VERIFY_EMAIL_MESSAGE, "email_unverified");
}
