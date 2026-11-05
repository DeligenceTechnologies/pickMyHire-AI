import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Emails go through the real Resend provider code, with the network call answered here:
// 403 (as on 22 Oct 2026, before the domain was verified) or 200. Nothing is really sent.
vi.mock("@/lib/env", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/env")>();
  return { ...m, env: () => ({ ...m.env(), EMAIL_PROVIDER: "resend", EMAIL_PROVIDER_API_KEY: "test-key", EMAIL_FROM: "PickMyHire.ai <noreply@example.test>" }) };
});

import { withSystem } from "@/lib/database/db";
import { sendEmail } from "@/lib/email";
import { DEFAULT_TEMPLATES } from "@/lib/interview/default-templates";
import { cancelHumanInterview, rescheduleHumanInterview, scheduleHumanInterview } from "@/lib/services/human-interviews";
import { createInterview, rotateLink, sendReminder } from "@/lib/services/interviews";
import { listRounds, saveRounds } from "@/lib/services/rounds";
import { insertTemplate } from "@/lib/services/templates";

const id = Date.now().toString(36);
let orgId = "", owner = "", admin = "", recruiter = "", jobId = "", candidateId = "", humanRound = "";
const users: string[] = [];
const candidateEmail = `cand-${id}@mail.test`;
let providerStatus = 403;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
    String(input instanceof Request ? input.url : input).startsWith("https://api.resend.com/") ? new Response("{}", { status: providerStatus }) : realFetch(input, init));
  await withSystem(async (tx) => {
    const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug, interview_quota) values (${`Mail Co ${id}`}, ${`mail-co-${id}`}, null) returning id`;
    orgId = o.id;
    for (const role of ["owner", "admin", "recruiter"] as const) {
      const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`${role}-${id}@mail.test`}, ${`${role} person`}, 'x') returning id`;
      users.push(u.id);
      await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${u.id}, ${role})`;
    }
    [owner, admin, recruiter] = users;
    for (const [i, t] of DEFAULT_TEMPLATES.entries()) await insertTemplate(tx, orgId, owner, t, i === 0);
    const [tpl] = await tx<{ id: string }[]>`select id from interview_templates where organization_id = ${orgId} order by created_at limit 1`;
    const [j] = await tx<{ id: string }[]>`insert into jobs (organization_id, title, status) values (${orgId}, 'Mail job', 'active') returning id`;
    jobId = j.id;
    await saveRounds(tx, orgId, jobId, [{ name: "Screening", kind: "ai", template_id: tpl.id }, { name: "Panel", kind: "human", criteria: ["Communication"] }]);
    const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${orgId}, 'Mai Lee', ${candidateEmail}) returning id`;
    candidateId = c.id;
  });
  humanRound = (await listRounds(orgId, jobId)).find((r) => r.kind === "human")!.id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await withSystem(async (tx) => {
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = any(${users})`;
  });
});

beforeEach(() => { providerStatus = 403; });

const notices = (userId: string) => withSystem((tx) => tx<{ payload: { to: string; subject: string } }[]>`
  select payload from notifications where organization_id = ${orgId} and user_id = ${userId} and type = 'email.failed'`);

describe("when an email can't be sent", () => {
  it("says so, records why, and tells owners and admins once an hour", async () => {
    const r = await sendEmail({ to: "someone@mail.test", subject: "Hello", text: "Hi", orgId });
    expect(r).toEqual({ ok: false, to: "someone@mail.test" });
    const [row] = await withSystem((tx) => tx<{ status: string; error: string }[]>`
      select status, error from email_outbox where organization_id = ${orgId} and to_email = 'someone@mail.test'`);
    expect(row).toEqual({ status: "failed", error: "Email provider returned 403" });
    expect((await notices(owner)).map((n) => n.payload)).toEqual([{ to: "someone@mail.test", subject: "Hello" }]);
    expect(await notices(admin)).toHaveLength(1);
    expect(await notices(recruiter)).toHaveLength(0);
    await sendEmail({ to: "other@mail.test", subject: "Again", text: "Hi", orgId });
    expect(await notices(owner)).toHaveLength(1); // no flood
  });

  it("an AI interview is still created, and the invite result names the address that failed", async () => {
    const res = await createInterview(orgId, recruiter, { jobId, candidateId, sendInvite: true });
    expect(res.emailFailed).toEqual([candidateEmail]);
    const [iv] = await withSystem((tx) => tx<{ status: string }[]>`select status from interviews where id = ${res.id}`);
    expect(iv.status).toBe("invited");
    expect((await rotateLink(orgId, recruiter, res.id, true)).emailFailed).toEqual([candidateEmail]);
    expect((await rotateLink(orgId, recruiter, res.id, false)).emailFailed).toEqual([]); // no email asked for
    expect((await sendReminder(orgId, recruiter, res.id)).emailFailed).toEqual([candidateEmail]);
    providerStatus = 200;
    expect((await sendReminder(orgId, recruiter, res.id)).emailFailed).toEqual([]);
  });

  it("a human interview is still scheduled, and the result names every email that failed", async () => {
    const base = { jobId, candidateId, roundId: humanRound, scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, timezone: "UTC",
      locationType: "video" as const, location: "https://meet.google.com/abc-defg-hij", interviewerIds: [admin], message: null, sendEmail: true };
    const res = await scheduleHumanInterview(orgId, owner, base);
    expect(res.id).toBeTruthy();
    expect(res.emailFailed).toEqual([candidateEmail, `admin-${id}@mail.test`]);
    providerStatus = 200;
    expect((await rescheduleHumanInterview(orgId, owner, res.id, { ...base, durationMinutes: 45 })).emailFailed).toEqual([]);
    providerStatus = 403;
    expect((await cancelHumanInterview(orgId, owner, res.id, { reason: "Filled", sendEmail: true })).emailFailed).toEqual([candidateEmail, `admin-${id}@mail.test`]);
  });
});
