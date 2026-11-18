import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSystem } from "@/lib/database/db";
import { DEFAULT_TEMPLATES } from "@/lib/interview/default-templates";
import { inviteApplicant, setApplicationStatus } from "@/lib/services/applications";
import { cancelInterview, createInterview } from "@/lib/services/interviews";
import { DECLINED_NOTE, getJobPipeline, setRoundDecision, setStage } from "@/lib/services/pipeline";
import { saveRounds } from "@/lib/services/rounds";
import { insertTemplate } from "@/lib/services/templates";

// "Not qualified" and declined applications fill the job's Rejected tab (feedback: Rejected always showed 0).
const id = Date.now().toString(36);
let orgId = "", owner = "", jobId = "";

async function candidate(name: string) {
  const [c] = await withSystem((tx) => tx<{ id: string }[]>`
    insert into candidates (organization_id, name, email, resume_file_path) values (${orgId}, ${name}, ${`${name.toLowerCase().replace(/\s/g, ".")}-${id}@reject.test`}, 'test/resume.pdf') returning id`);
  return c.id;
}
async function finishedInterview(candidateId: string) {
  const { id: interviewId } = await createInterview(orgId, owner, { jobId, candidateId, sendInvite: false });
  await withSystem((tx) => tx`update interviews set status = 'report_ready', completed_at = now() where id = ${interviewId}`);
  return interviewId;
}
async function application(candidateId: string) {
  const [a] = await withSystem((tx) => tx<{ id: string }[]>`
    insert into job_applications (organization_id, job_id, candidate_id, consent_given) values (${orgId}, ${jobId}, ${candidateId}, true) returning id`);
  return a.id;
}
const row = async (candidateId: string) => (await getJobPipeline(orgId, jobId)).rows.find((r) => r.candidate_id === candidateId);

beforeAll(async () => {
  await withSystem(async (tx) => {
    const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug, interview_quota) values (${`Reject Co ${id}`}, ${`reject-co-${id}`}, null) returning id`;
    orgId = o.id;
    const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`owner-${id}@reject.test`}, 'Owner', 'x') returning id`;
    owner = u.id;
    await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${owner}, 'owner')`;
    for (const [i, t] of DEFAULT_TEMPLATES.entries()) await insertTemplate(tx, orgId, owner, t, i === 0);
    const [j] = await tx<{ id: string }[]>`insert into jobs (organization_id, title, status) values (${orgId}, 'Reject job', 'active') returning id`;
    jobId = j.id;
    const [tpl] = await tx<{ id: string }[]>`select id from interview_templates where organization_id = ${orgId} order by created_at limit 1`;
    await saveRounds(tx, orgId, jobId, [{ name: "Screening", kind: "ai", template_id: tpl.id }]);
  });
});
afterAll(async () => {
  // Other test files clean up at the same time; retry once if the deletes collide (deadlock).
  const clean = () => withSystem(async (tx) => {
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = ${owner}`;
  });
  await clean().catch(async () => { await new Promise((r) => setTimeout(r, 300)); await clean(); });
});

describe("the job's Rejected tab", () => {
  it("Not qualified with the option ticked moves the candidate to Rejected, with the round in the note", async () => {
    const c = await candidate("Ravi Rao");
    const iv = await finishedInterview(c);
    const r = await setRoundDecision(orgId, owner, { kind: "ai", id: iv, decision: "not_qualified", note: "Weak on SQL", reject: true });
    expect(r.rejected).toBe(true);
    expect(await row(c)).toMatchObject({ stage: "rejected" });
    expect((await row(c))!.stage_note).toMatch(/^Not qualified in .+: Weak on SQL$/);
  });

  it("Not qualified without the option keeps the candidate in progress", async () => {
    const c = await candidate("Nina Nair");
    const iv = await finishedInterview(c);
    expect((await setRoundDecision(orgId, owner, { kind: "ai", id: iv, decision: "not_qualified" })).rejected).toBe(false);
    expect(await row(c)).toMatchObject({ stage: "in_progress" });
  });

  it("never changes a hired candidate", async () => {
    const c = await candidate("Hari Hegde");
    const iv = await finishedInterview(c);
    await setStage(orgId, owner, { jobId, candidateId: c, stage: "hired", note: "Offer accepted" });
    expect((await setRoundDecision(orgId, owner, { kind: "ai", id: iv, decision: "not_qualified", reject: true })).rejected).toBe(false);
    expect(await row(c)).toMatchObject({ stage: "hired" });
  });

  it("a declined application shows under Rejected; reopening takes it out again", async () => {
    const c = await candidate("Dev Desai");
    const app = await application(c);
    expect(await row(c)).toBeUndefined();
    await setApplicationStatus(orgId, owner, app, "declined");
    expect(await row(c)).toMatchObject({ stage: "rejected", stage_note: DECLINED_NOTE });
    await setApplicationStatus(orgId, owner, app, "new");
    expect(await row(c)).toBeUndefined();
  });

  it("inviting a declined applicant after all moves them back to In progress", async () => {
    const c = await candidate("Ira Iyer");
    const app = await application(c);
    await setApplicationStatus(orgId, owner, app, "declined");
    await inviteApplicant(orgId, owner, app, false);
    expect(await row(c)).toMatchObject({ stage: "in_progress", stage_note: null });
  });

  it("reopening leaves a stage the team changed since then alone", async () => {
    const c = await candidate("Sam Sethi");
    const app = await application(c);
    await setApplicationStatus(orgId, owner, app, "declined");
    await setStage(orgId, owner, { jobId, candidateId: c, stage: "rejected", note: "Not a fit for the team" });
    await setApplicationStatus(orgId, owner, app, "new");
    expect(await row(c)).toMatchObject({ stage: "rejected", stage_note: "Not a fit for the team" });
  });

  it("an application can be closed once its interview is cancelled (the candidate lost interest)", async () => {
    const c = await candidate("Lea Lobo");
    const app = await application(c);
    const { interviewId } = await inviteApplicant(orgId, owner, app, false);
    await expect(setApplicationStatus(orgId, owner, app, "declined")).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Cancel it on the interview page first/) });
    await cancelInterview(orgId, owner, interviewId);
    await setApplicationStatus(orgId, owner, app, "declined");
    expect(await row(c)).toMatchObject({ stage: "rejected", stage_note: DECLINED_NOTE });
  });

  it("an application whose interview was deleted can be closed too", async () => {
    const c = await candidate("Om Oza");
    const app = await application(c);
    const { interviewId } = await inviteApplicant(orgId, owner, app, false);
    await withSystem((tx) => tx`delete from interviews where id = ${interviewId}`);
    await setApplicationStatus(orgId, owner, app, "declined");
    expect(await row(c)).toMatchObject({ stage: "rejected" });
  });

  it("a finished interview still blocks it: the round decision is the place for that", async () => {
    const c = await candidate("Pia Pal");
    const app = await application(c);
    const { interviewId } = await inviteApplicant(orgId, owner, app, false);
    await withSystem((tx) => tx`update interviews set status = 'report_ready', completed_at = now() where id = ${interviewId}`);
    await expect(setApplicationStatus(orgId, owner, app, "declined")).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Not qualified/) });
  });

  it("inviting a declined candidate from another page reopens the application too", async () => {
    const c = await candidate("Uma Udupi");
    const app = await application(c);
    await setApplicationStatus(orgId, owner, app, "declined");
    await createInterview(orgId, owner, { jobId, candidateId: c, sendInvite: false });
    expect(await row(c)).toMatchObject({ stage: "in_progress" });
    const [a] = await withSystem((tx) => tx<{ status: string }[]>`select status::text from job_applications where id = ${app}`);
    expect(a.status).toBe("interview_invited");
  });
});
