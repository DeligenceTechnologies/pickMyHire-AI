import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSystem } from "@/lib/database/db";
import { DEFAULT_TEMPLATES } from "@/lib/interview/default-templates";
import { createInterview } from "@/lib/services/interviews";
import { candidateRoundStates, listRounds, saveRounds } from "@/lib/services/rounds";
import { insertTemplate } from "@/lib/services/templates";

// Interview rounds against the local database (AI in mock mode). Each run uses a throwaway company.
const id = Date.now().toString(36);
let orgId = "";
let userId = "";
let jobId = "";
let candidateId = "";
let screeningTpl = "";
let technicalTpl = "";
let otherTpl = "";

const invite = (extra: Partial<Parameters<typeof createInterview>[2]> = {}) =>
  createInterview(orgId, userId, { jobId, candidateId, sendInvite: false, ...extra });

async function complete(interviewId: string) {
  await withSystem((tx) => tx`update interviews set status = 'completed', started_at = now() - interval '10 minutes', completed_at = now() where id = ${interviewId}`);
}

async function row(interviewId: string) {
  const [r] = await withSystem((tx) => tx<{ round_name: string; attempt: number; round_id: string | null }[]>`select round_name, attempt, round_id from interviews where id = ${interviewId}`);
  return r;
}

beforeAll(async () => {
  await withSystem(async (tx) => {
    const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug, interview_quota) values (${`Rounds Co ${id}`}, ${`rounds-co-${id}`}, null) returning id`;
    orgId = o.id;
    const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`rounds-${id}@rounds.test`}, 'Rounds Owner', 'x') returning id`;
    userId = u.id;
    await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${userId}, 'owner')`;
    for (const [i, t] of DEFAULT_TEMPLATES.entries()) await insertTemplate(tx, orgId, userId, t, i === 0);
    const tpls = await tx<{ id: string }[]>`select id from interview_templates where organization_id = ${orgId} order by created_at`;
    [screeningTpl, technicalTpl, otherTpl] = [tpls[0].id, tpls[1].id, tpls[2]?.id ?? tpls[0].id];
    const [j] = await tx<{ id: string }[]>`insert into jobs (organization_id, title, status) values (${orgId}, 'Rounds job', 'active') returning id`;
    jobId = j.id;
    await saveRounds(tx, orgId, jobId, [{ name: "Screening", template_id: screeningTpl }, { name: "Technical", template_id: technicalTpl }]);
    const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email, resume_file_path) values (${orgId}, 'Riya Rounds', ${`riya-${id}@rounds.test`}, 'test/resume.pdf') returning id`;
    candidateId = c.id;
  });
});

afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = ${userId}`;
  });
});

describe("interview rounds", () => {
  let first = "";

  it("invites to the first round by default and blocks a second unfinished invite for it", async () => {
    first = (await invite()).id;
    expect(await row(first)).toMatchObject({ round_name: "Screening", attempt: 1 });
    await expect(invite()).rejects.toMatchObject({ status: 409, code: "interview_pending" });
  });

  it("moves to the next round once the first is completed", async () => {
    await complete(first);
    const second = (await invite()).id;
    expect(await row(second)).toMatchObject({ round_name: "Technical", attempt: 1 });
    const states = await candidateRoundStates(orgId, jobId, candidateId);
    const rounds = await listRounds(orgId, jobId);
    expect(states[rounds[0].id]).toMatchObject({ completedCount: 1, pending: false });
    expect(states[rounds[1].id]).toMatchObject({ completedCount: 0, pending: true });
  });

  it("asks before repeating a completed round, then records attempt 2 and keeps attempt 1", async () => {
    const [screening] = await listRounds(orgId, jobId);
    await expect(invite({ roundId: screening.id })).rejects.toMatchObject({ status: 409, code: "already_completed" });
    const again = (await invite({ roundId: screening.id, reinvite: true, reason: "Audio dropped in the first attempt" })).id;
    expect(await row(again)).toMatchObject({ round_name: "Screening", attempt: 2 });
    expect(await row(first)).toMatchObject({ round_name: "Screening", attempt: 1 });
  });

  it("uses another template one-off, or saves it to the job as a new round", async () => {
    const [{ name: otherName }] = await withSystem((tx) => tx<{ name: string }[]>`select name from interview_templates where id = ${otherTpl}`);
    const oneOff = (await invite({ templateId: otherTpl })).id;
    expect(await row(oneOff)).toMatchObject({ round_name: otherName, round_id: null });
    expect((await listRounds(orgId, jobId)).map((r) => r.name)).toEqual(["Screening", "Technical"]);

    await complete(oneOff);
    const saved = (await invite({ templateId: technicalTpl, newRoundName: "Culture fit" })).id;
    expect(await row(saved)).toMatchObject({ round_name: "Culture fit", attempt: 1 });
    expect((await listRounds(orgId, jobId)).map((r) => r.name)).toEqual(["Screening", "Technical", "Culture fit"]);
  });

  it("keeps interview history when a round is removed from the job", async () => {
    const rounds = await listRounds(orgId, jobId);
    await withSystem((tx) => saveRounds(tx, orgId, jobId, rounds.filter((r) => r.name !== "Culture fit").map((r) => ({ id: r.id, name: r.name, template_id: r.template_id! }))));
    expect((await listRounds(orgId, jobId)).map((r) => r.name)).toEqual(["Screening", "Technical"]);
    const [kept] = await withSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from interviews where job_id = ${jobId} and round_name = 'Culture fit'`);
    expect(kept.n).toBe(1);
  });

  it("requires at least one round with a valid template", async () => {
    await expect(withSystem((tx) => saveRounds(tx, orgId, jobId, []))).rejects.toMatchObject({ status: 400 });
    await expect(withSystem((tx) => saveRounds(tx, orgId, jobId, [{ name: "X", template_id: "00000000-0000-0000-0000-000000000000" }]))).rejects.toMatchObject({ status: 400 });
  });
});
