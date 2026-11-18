import "server-only";
import { audit } from "@/lib/audit";
import { json, withOrg, withSystem, type Tx } from "@/lib/database/db";
import { emailTemplates, platformBrand, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { totalPlannedMs } from "@/lib/interview/state-machine";
import { log } from "@/lib/logger";
import { interviewsFor, LOW_BALANCE } from "@/lib/pricing";
import type { StoredPlan } from "@/types/interview";
import { readSettings } from "./org-settings";
import { getPricing } from "./pricing";
import { expirePurchases } from "./billing";
import { readQuota } from "./quota";

// Using interviews when candidates start, giving them back, and telling people when the balance runs low.
// Nothing here throws into the candidate's flow except chargeAtStart's "not enough" answer.
// A candidate who can't start contacts the company themselves; once interviews are added, their same link works.

const billingLink = () => `${env().APP_URL}/settings/billing`;

/** How many interviews one interview with this plan uses (2 when it's longer than the pricing limit). */
export async function creditsForPlan(plan: StoredPlan | null): Promise<number> {
  if (!plan) return 1;
  const pricing = await getPricing();
  return interviewsFor(Math.round(totalPlannedMs(plan) / 60_000), pricing);
}

/**
 * Use the interviews for one that's starting, inside the start transaction. Locks the company row so two
 * candidates starting together can't both take the last one. Returns the balance before and after, or
 * `ok: false` when there aren't enough left (nothing is changed then).
 */
export async function chargeAtStart(tx: Tx, orgId: string, interviewId: string, credits: number) {
  await expirePurchases(tx, orgId);
  const q = await readQuota(tx, orgId, { lock: true });
  if (q.remaining !== null && q.remaining < credits) return { ok: false as const, before: q.remaining };
  await tx`update interviews set credits_used = ${credits}, charged_at = now(), credits_refunded_at = null, held_at = null where id = ${interviewId}`;
  return { ok: true as const, before: q.remaining, after: q.remaining === null ? null : q.remaining - credits };
}

/** True when this not-yet-started interview can't start because the balance is too low. */
export async function cannotStart(orgId: string, plan: StoredPlan | null): Promise<boolean> {
  const q = await withOrg(orgId, (tx) => readQuota(tx, orgId));
  return q.remaining !== null && q.remaining < (await creditsForPlan(plan));
}

/** Give back the interviews used, when it ended before the candidate answered anything. Inside the ending transaction. */
export async function refundIfNoAnswers(tx: Tx, orgId: string, interviewId: string) {
  const [r] = await tx<{ credits: number }[]>`
    update interviews i set credits_used = 0, credits_refunded_at = now()
    from (select credits_used as credits from interviews where id = ${interviewId}) old
    where i.id = ${interviewId} and i.credits_used > 0
      and not exists (select 1 from interview_answers a where a.interview_id = ${interviewId})
    returning old.credits`;
  if (r) await audit(tx, { orgId, actorType: "system", action: "interview.credits_refunded", entityType: "interview", entityId: interviewId, metadata: { credits: r.credits, reason: "no_answers" } });
}

/** Owners and admins, plus whoever sent this invite (if given). */
async function people(tx: Tx, orgId: string, inviterId: string | null) {
  return tx<{ id: string; email: string }[]>`
    select distinct u.id, u.email from organization_members m join users u on u.id = m.user_id
    where m.organization_id = ${orgId} and u.disabled_at is null and (m.role in ('owner', 'admin') or u.id = ${inviterId})`;
}

/**
 * The candidate opened their link but the balance is too low: remember it (the company sees who's
 * waiting) and, the first time, tell the company. Never throws.
 */
export async function holdForBalance(orgId: string, interviewId: string) {
  try {
    const first = await withSystem(async (tx) => {
      const [row] = await tx<{ candidate: string; job: string; created_by: string | null }[]>`
        update interviews i set held_at = now() from candidates c, jobs j
        where i.id = ${interviewId} and i.held_at is null and c.id = i.candidate_id and j.id = i.job_id
        returning c.name as candidate, j.title as job, i.created_by`;
      if (!row) return null;
      const to = await people(tx, orgId, row.created_by);
      for (const p of to) {
        await tx`insert into notifications (organization_id, user_id, type, payload)
          values (${orgId}, ${p.id}, 'interview.on_hold', ${json({ interview_id: interviewId, candidate: row.candidate, job: row.job })})`;
      }
      // Email at most once an hour per company, so a busy day doesn't flood anyone.
      const [{ recent }] = await tx<{ recent: boolean }[]>`
        select exists (select 1 from interviews where organization_id = ${orgId} and id <> ${interviewId} and held_at > now() - interval '1 hour') as recent`;
      const [{ more }] = await tx<{ more: number }[]>`
        select count(*)::int as more from interviews where organization_id = ${orgId} and id <> ${interviewId} and held_at is not null
          and status in ('created','invited','consent_pending','device_check','ready')`;
      return recent ? null : { ...row, to, more };
    });
    if (!first) return;
    const tpl = emailTemplates.interviewOnHold({ candidateName: first.candidate, jobTitle: first.job, link: billingLink(), more: first.more });
    for (const p of first.to) await sendEmail({ to: p.email, ...tpl, orgId, brand: platformBrand() });
  } catch (err) {
    log.warn("balance.hold_notice_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

/** After an interview is used: warn owners and admins when the balance drops to the warning level or to zero. Never throws. */
export async function warnIfLow(orgId: string, before: number | null, after: number | null) {
  if (before === null || after === null) return;
  const crossed = (before > 0 && after <= 0) || (before > LOW_BALANCE && after <= LOW_BALANCE);
  if (!crossed) return;
  try {
    const left = Math.max(0, after);
    const { name, to } = await withSystem(async (tx) => {
      const [o] = await tx<{ name: string }[]>`select name from organizations where id = ${orgId}`;
      const to = await people(tx, orgId, null);
      for (const p of to) {
        await tx`insert into notifications (organization_id, user_id, type, payload) values (${orgId}, ${p.id}, 'balance.low', ${json({ left: String(left) })})`;
      }
      return { name: o?.name ?? "Your company", to };
    });
    const tpl = emailTemplates.balanceLow({ companyName: name, left, link: billingLink() });
    for (const p of to) await sendEmail({ to: p.email, ...tpl, orgId, brand: platformBrand() });
  } catch (err) {
    log.warn("balance.low_notice_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Who the candidate should call or email: the company's candidate contact (Settings → Interview) if set,
 * otherwise the person who invited them (or the company owner).
 */
export async function candidateContact(orgId: string, interviewId: string): Promise<{ name: string | null; email: string | null; phone: string | null }> {
  return withSystem(async (tx) => {
    const [org] = await tx<{ settings: unknown }[]>`select settings from organizations where id = ${orgId}`;
    const set = readSettings(org?.settings);
    const [person] = await tx<{ name: string; email: string }[]>`
      select u.name, u.email from users u
      where u.disabled_at is null and (u.id = (select created_by from interviews where id = ${interviewId} and organization_id = ${orgId})
        or u.id = (select m.user_id from organization_members m where m.organization_id = ${orgId} and m.role = 'owner' order by m.created_at limit 1))
      order by (u.id = (select created_by from interviews where id = ${interviewId})) desc
      limit 1`;
    return {
      name: set.candidate_contact_email ? null : person?.name ?? null,
      email: set.candidate_contact_email ?? person?.email ?? null,
      phone: set.candidate_contact_phone,
    };
  });
}
