import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSystem } from "@/lib/database/db";
import { changeUserEmail, companyDeletionPreview, deleteCompany, deleteUser, trialAlreadyUsed, userDeletionPreview } from "@/lib/services/admin";
import { storage } from "@/lib/storage";

// Platform admin: change email and permanent deletion, against the local database and storage.
const id = Date.now().toString(36);
const users: string[] = [];
const orgs: string[] = [];
let adminId = "";

async function user(name: string, opts: { admin?: boolean } = {}) {
  const [u] = await withSystem((tx) => tx<{ id: string }[]>`
    insert into users (email, name, password_hash, is_platform_admin) values (${`${name.toLowerCase()}-${id}@del.test`}, ${name}, 'x', ${!!opts.admin}) returning id`);
  users.push(u.id);
  return u.id;
}
async function org(name: string, members: [string, string][], opts: { trial?: boolean } = {}) {
  const [o] = await withSystem((tx) => tx<{ id: string }[]>`
    insert into organizations (name, slug, plan, signup_domain) values (${`${name} ${id}`}, ${`${name.toLowerCase()}-${id}`}, ${opts.trial ? "trial" : "standard"}, ${opts.trial ? "del.test" : null}) returning id`);
  orgs.push(o.id);
  for (const [uid, role] of members) await withSystem((tx) => tx`insert into organization_members (organization_id, user_id, role) values (${o.id}, ${uid}, ${role})`);
  return o.id;
}

beforeAll(async () => { adminId = await user("Admin", { admin: true }); });
afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from organizations where id = any(${orgs})`;
    await tx`delete from users where id = any(${users})`;
  });
});

describe("change email", () => {
  it("fixes a typo, but not to an email someone else uses", async () => {
    const a = await user("Typo");
    const b = await user("Taken");
    await expect(changeUserEmail(adminId, a, `taken-${id}@del.test`)).rejects.toMatchObject({ status: 409 });
    await expect(changeUserEmail(adminId, a, "not-an-email")).rejects.toMatchObject({ status: 400 });
    await changeUserEmail(adminId, a, `Fixed-${id}@DEL.test`);
    const [row] = await withSystem((tx) => tx<{ email: string; email_verified_at: Date | null }[]>`select email, email_verified_at from users where id = ${a}`);
    expect(row).toEqual({ email: `fixed-${id}@del.test`, email_verified_at: null });
    expect(b).toBeTruthy();
  });
});

describe("delete user", () => {
  it("explains what blocks it", async () => {
    const owner = await user("Owner");
    const teammate = await user("Teammate");
    await org("Shared", [[owner, "owner"], [teammate, "recruiter"]]);
    expect((await userDeletionPreview(adminId, owner)).blockers.join(" ")).toMatch(/transfer ownership/);
    expect((await userDeletionPreview(adminId, adminId)).blockers.join(" ")).toMatch(/your own account/);
    await expect(deleteUser(adminId, owner, `owner-${id}@del.test`)).rejects.toMatchObject({ status: 409 });
  });

  it("keeps scorecards of companies that stay: disable instead", async () => {
    const interviewer = await user("Interviewer");
    const boss = await user("Boss");
    const o = await org("Scored", [[boss, "owner"], [interviewer, "interviewer"]]);
    await withSystem(async (tx) => {
      const [j] = await tx<{ id: string }[]>`insert into jobs (organization_id, title) values (${o}, 'Job') returning id`;
      const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${o}, 'C', ${`c-${id}@del.test`}) returning id`;
      const [h] = await tx<{ id: string }[]>`insert into human_interviews (organization_id, job_id, candidate_id, round_name, scheduled_at, duration_minutes, timezone, location_type)
        values (${o}, ${j.id}, ${c.id}, 'Panel', now(), 30, 'UTC', 'video') returning id`;
      await tx`insert into human_interview_scorecards (organization_id, human_interview_id, user_id, submitted_at) values (${o}, ${h.id}, ${interviewer}, now())`;
    });
    expect((await userDeletionPreview(adminId, interviewer)).blockers.join(" ")).toMatch(/1 interview scorecard/);
  });

  it("deletes the account, their solo company and its files, frees the email and remembers the trial", async () => {
    const solo = await user("Solo");
    const o = await org("Solo", [[solo, "owner"]], { trial: true });
    await storage().put(`${o}/candidates/x/resume-1.txt`, new TextEncoder().encode("resume"), "text/plain");
    const preview = await userDeletionPreview(adminId, solo);
    expect(preview.companiesDeleted.map((c) => c.id)).toEqual([o]);
    await expect(deleteUser(adminId, solo, "wrong@del.test")).rejects.toMatchObject({ status: 400 });
    await deleteUser(adminId, solo, `SOLO-${id}@del.test`);
    const left = await withSystem((tx) => tx`select (select count(*) from users where id = ${solo})::int u, (select count(*) from organizations where id = ${o})::int o`);
    expect(left[0]).toEqual({ u: 0, o: 0 });
    expect(await storage().list(`${o}/`)).toEqual([]);
    expect(await trialAlreadyUsed(`solo-${id}@del.test`)).toBe(true);
    expect(await trialAlreadyUsed(`someone-else-${id}@del.test`)).toBe(false);
  });
});

describe("delete company", () => {
  it("needs the company suspended and its name typed, then removes it and its only-here members", async () => {
    const onlyHere = await user("OnlyHere");
    const alsoElsewhere = await user("Elsewhere");
    const o = await org("Gone", [[onlyHere, "owner"], [alsoElsewhere, "recruiter"]]);
    await org("Other", [[alsoElsewhere, "owner"]]);
    const preview = await companyDeletionPreview(o);
    expect(preview.onlyHere.map((u) => u.id)).toEqual([onlyHere]);
    await expect(deleteCompany(adminId, o, { confirmName: `Gone ${id}`, deleteMembers: true })).rejects.toMatchObject({ status: 409 });
    await withSystem((tx) => tx`update organizations set status = 'suspended' where id = ${o}`);
    await expect(deleteCompany(adminId, o, { confirmName: "Gone", deleteMembers: true })).rejects.toMatchObject({ status: 400 });
    await deleteCompany(adminId, o, { confirmName: `Gone ${id}`, deleteMembers: true });
    const left = await withSystem((tx) => tx<{ o: number; only: number; else: number }[]>`select (select count(*) from organizations where id = ${o})::int o,
      (select count(*) from users where id = ${onlyHere})::int only, (select count(*) from users where id = ${alsoElsewhere})::int "else"`);
    expect(left[0]).toEqual({ o: 0, only: 0, else: 1 });
    const [log] = await withSystem((tx) => tx<{ action: string }[]>`select action from platform_audit_logs where target_id = ${o} order by created_at desc limit 1`);
    expect(log.action).toBe("company.deleted");
  });
});
