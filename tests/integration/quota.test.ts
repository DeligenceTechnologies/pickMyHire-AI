import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withOrg, withSystem } from "@/lib/database/db";
import { candidateContact, chargeAtStart, holdForBalance, refundIfNoAnswers, warnIfLow } from "@/lib/services/interview-balance";
import { assertCanInvite, getQuotaStatus } from "@/lib/services/quota";

// Runs against the local database. Each run uses its own throwaway company.
// Interviews are used when the candidate starts; invites never hold or block anything.
const id = Date.now().toString(36);
let orgId = "", jobId = "", ownerId = "", recruiterId = "";
let n = 0;

async function addInterview(status: string, extra: { credits?: number; chargedAt?: string; expiresAt?: string; createdBy?: string } = {}) {
  n += 1;
  return withSystem(async (tx) => {
    const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${orgId}, ${`Cand ${n}`}, ${`c${n}-${id}@quota.test`}) returning id`;
    const [i] = await tx<{ id: string }[]>`insert into interviews (organization_id, job_id, candidate_id, secure_token_hash, status, credits_used, charged_at, token_expires_at, created_by)
      values (${orgId}, ${jobId}, ${c.id}, ${`quota-${id}-${n}`}, ${status}::interview_status, ${extra.credits ?? 0},
              ${extra.chargedAt ?? null}::timestamptz, ${extra.expiresAt ?? null}::timestamptz, ${extra.createdBy ?? null}) returning id`;
    return i.id;
  });
}
const notices = (type: string) => withSystem((tx) => tx<{ user_id: string }[]>`select user_id from notifications where organization_id = ${orgId} and type = ${type}`);

beforeAll(async () => {
  await withSystem(async (tx) => {
    const [o] = await tx<{ id: string }[]>`
      insert into organizations (name, slug, interview_quota, quota_counted_from)
      values (${`Quota Co ${id}`}, ${`quota-co-${id}`}, 3, now() - interval '1 day') returning id`;
    orgId = o.id;
    for (const role of ["owner", "recruiter"] as const) {
      const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`${role}-${id}@quota.test`}, ${`${role} person`}, 'x') returning id`;
      await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${u.id}, ${role})`;
      if (role === "owner") ownerId = u.id; else recruiterId = u.id;
    }
    const [j] = await tx<{ id: string }[]>`insert into jobs (organization_id, title, status) values (${orgId}, 'Quota job', 'active') returning id`;
    jobId = j.id;
  });
});

afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = any(${[ownerId, recruiterId]})`;
  });
});

describe("interview balance", () => {
  it("counts interviews used since the start date (long ones as 2); waiting invites don't use any", async () => {
    await addInterview("completed", { credits: 1, chargedAt: new Date().toISOString() });
    await addInterview("report_ready", { credits: 1, chargedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }); // before counting started
    await addInterview("invited", { expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    await addInterview("cancelled");
    expect(await getQuotaStatus(orgId)).toMatchObject({ quota: 3, used: 1, inProgress: 1, remaining: 2, onHold: 0 });
    await addInterview("in_progress", { credits: 2, chargedAt: new Date().toISOString() }); // a template over 40 minutes
    expect(await getQuotaStatus(orgId)).toMatchObject({ used: 3, remaining: 0 });
  });

  it("never blocks invites for a low balance", async () => {
    await expect(withOrg(orgId, (tx) => assertCanInvite(tx, orgId))).resolves.toBeUndefined();
  });

  it("a candidate can't start with too few left; only one of two starts takes the last interview", async () => {
    const waiting = await addInterview("ready");
    const r = await withOrg(orgId, (tx) => chargeAtStart(tx, orgId, waiting, 1));
    expect(r).toEqual({ ok: false, before: 0 });

    await withSystem((tx) => tx`update organizations set interview_quota = 4 where id = ${orgId}`);
    const [a, b] = [await addInterview("ready"), await addInterview("ready")];
    const results = await Promise.all([a, b].map((iv) => withOrg(orgId, (tx) => chargeAtStart(tx, orgId, iv, 1))));
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect((await getQuotaStatus(orgId)).remaining).toBe(0);
  });

  it("gives the interview back when it ends before any answer", async () => {
    const started = await addInterview("completed", { credits: 1, chargedAt: new Date().toISOString() });
    const before = (await getQuotaStatus(orgId)).used;
    await withOrg(orgId, (tx) => refundIfNoAnswers(tx, orgId, started));
    expect((await getQuotaStatus(orgId)).used).toBe(before - 1);
  });

  it("a waiting candidate is remembered and the company told once; after interviews are added, the same link starts", async () => {
    await withSystem((tx) => tx`update organizations set interview_quota = (select coalesce(sum(credits_used), 0) from interviews where organization_id = ${orgId} and charged_at >= now() - interval '1 day') where id = ${orgId}`);
    const iv = await addInterview("ready", { createdBy: recruiterId, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    await holdForBalance(orgId, iv);
    await holdForBalance(orgId, iv); // opening the link again doesn't notify again
    expect((await notices("interview.on_hold")).map((x) => x.user_id).sort()).toEqual([ownerId, recruiterId].sort());
    expect((await getQuotaStatus(orgId)).onHold).toBe(1);
    const [{ hash: before }] = await withSystem((tx) => tx<{ hash: string }[]>`select secure_token_hash as hash from interviews where id = ${iv}`);

    await withSystem((tx) => tx`update organizations set interview_quota = interview_quota + 5 where id = ${orgId}`);
    expect((await withOrg(orgId, (tx) => chargeAtStart(tx, orgId, iv, 1))).ok).toBe(true);
    const [after] = await withSystem((tx) => tx<{ held_at: Date | null; hash: string }[]>`select held_at, secure_token_hash as hash from interviews where id = ${iv}`);
    expect(after).toEqual({ held_at: null, hash: before }); // nothing was re-sent: the candidate used the link they had
    expect((await getQuotaStatus(orgId)).onHold).toBe(0);
    const mails = await withSystem((tx) => tx`select 1 from email_outbox where organization_id = ${orgId} and to_email like ${`c%-${id}@quota.test`}`);
    expect(mails).toHaveLength(0); // candidates are never emailed automatically
  });

  it("candidates see the company's contact phone and email, or else the person who invited them", async () => {
    const iv = await addInterview("invited", { createdBy: recruiterId });
    expect(await candidateContact(orgId, iv)).toEqual({ name: "recruiter person", email: `recruiter-${id}@quota.test`, phone: null });
    await withSystem((tx) => tx`update organizations set settings = settings || ${tx.json({ candidate_contact_email: "jobs@quota.test", candidate_contact_phone: "+91 98765 43210" })} where id = ${orgId}`);
    expect(await candidateContact(orgId, iv)).toEqual({ name: null, email: "jobs@quota.test", phone: "+91 98765 43210" });
  });

  it("warns owners when the balance drops to the warning level or to zero, not on every interview", async () => {
    await warnIfLow(orgId, 9, 8);
    expect(await notices("balance.low")).toHaveLength(0);
    await warnIfLow(orgId, 6, 5);
    await warnIfLow(orgId, 1, 0);
    expect((await notices("balance.low")).map((x) => x.user_id)).toEqual([ownerId, ownerId]); // owners and admins only
  });

  it("treats a null quota as unlimited", async () => {
    await withSystem((tx) => tx`update organizations set interview_quota = null where id = ${orgId}`);
    expect((await getQuotaStatus(orgId)).remaining).toBeNull();
    const iv = await addInterview("ready");
    expect((await withOrg(orgId, (tx) => chargeAtStart(tx, orgId, iv, 2))).ok).toBe(true);
  });
});
