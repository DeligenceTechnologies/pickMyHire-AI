import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, withOrg, withSystem } from "@/lib/database/db";
import { sendEmailVerification, signup, verifyEmail } from "@/lib/services/accounts";
import { updateCompany } from "@/lib/services/admin";
import { DEFAULT_TRIAL } from "@/lib/services/platform";
import { assertCanInvite as canInvite, getQuotaStatus } from "@/lib/services/quota";

// Free trial against the local database. The trial setting is restored afterwards.
const id = Date.now().toString(36);
const email = `owner-${id}@trial-${id}.test`;
let orgId = "";
let userId = "";
let saved: unknown = null;

async function setTrial(patch: Partial<typeof DEFAULT_TRIAL>) {
  await withSystem((tx) => tx`
    insert into platform_settings (key, value) values ('free_trial', ${json({ ...DEFAULT_TRIAL, ...patch })})
    on conflict (key) do update set value = excluded.value`);
}
const assertCanInvite = () => withOrg(orgId, (tx) => canInvite(tx, orgId));

beforeAll(async () => {
  [{ value: saved } = { value: null }] = await withSystem((tx) => tx<{ value: unknown }[]>`select value from platform_settings where key = 'free_trial'`);
  await setTrial({ requireVerification: false });
  ({ orgId, userId } = await signup({ name: "Tara Trial", email, password: "pw-trial-test-secret", orgName: `Trial Co ${id}`, trial: { interviews: 3, days: 14, domain: `trial-${id}.test` } }));
});

afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = ${userId}`;
    if (saved) await tx`update platform_settings set value = ${json(saved)} where key = 'free_trial'`;
    else await tx`delete from platform_settings where key = 'free_trial'`;
  });
});

describe("free trial", () => {
  it("creates a trial company with 3 interviews for 14 days", async () => {
    const q = await getQuotaStatus(orgId);
    expect(q).toMatchObject({ plan: "trial", quota: 3, remaining: 3, trialEnded: false, trialDaysLeft: 14, needsVerification: false });
    await expect(assertCanInvite()).resolves.toBeUndefined();
  });

  it("asks for email confirmation once that's switched on, and accepts the emailed link", async () => {
    await setTrial({ requireVerification: true });
    expect((await getQuotaStatus(orgId)).needsVerification).toBe(true);
    await expect(assertCanInvite()).rejects.toMatchObject({ status: 403, code: "email_unverified" });

    await sendEmailVerification(userId);
    const [mail] = await withSystem((tx) => tx<{ body_text: string }[]>`select body_text from email_outbox where to_email = ${email} order by created_at desc limit 1`);
    const token = mail.body_text.match(/verify-email\?token=([\w-]+)/)![1];
    expect(await verifyEmail(token)).toEqual({ ok: true });
    expect(await verifyEmail(token)).toEqual({ ok: true }); // opening the link twice is fine
    expect(await verifyEmail("not-a-real-token")).toEqual({ ok: false });
    expect((await getQuotaStatus(orgId)).needsVerification).toBe(false);
    await expect(assertCanInvite()).resolves.toBeUndefined();
  });

  it("stops new invites when the trial ends, until an admin extends it", async () => {
    await withSystem((tx) => tx`update organizations set trial_ends_at = now() - interval '1 hour' where id = ${orgId}`);
    expect(await getQuotaStatus(orgId)).toMatchObject({ trialEnded: true, trialDaysLeft: 0 });
    await expect(assertCanInvite()).rejects.toMatchObject({ status: 403, code: "trial_ended" });

    const [admin] = await withSystem((tx) => tx<{ id: string }[]>`select id from users limit 1`);
    await updateCompany(admin.id, orgId, { extendTrialDays: 7 });
    expect(await getQuotaStatus(orgId)).toMatchObject({ trialEnded: false, trialDaysLeft: 7 });
    await expect(assertCanInvite()).resolves.toBeUndefined();
  });

  it("converts to a full account", async () => {
    const [admin] = await withSystem((tx) => tx<{ id: string }[]>`select id from users limit 1`);
    await updateCompany(admin.id, orgId, { convertTrial: true });
    expect(await getQuotaStatus(orgId)).toMatchObject({ plan: "standard", trialEnded: false, trialDaysLeft: null, quota: 3 });
    await expect(updateCompany(admin.id, orgId, { extendTrialDays: 7 })).rejects.toMatchObject({ status: 400 });
  });
});
