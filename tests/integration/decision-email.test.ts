import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSystem } from "@/lib/database/db";
import { archiveCandidate } from "@/lib/services/candidate-archive";
import { decisionEmailText, getDecisionEmailDraft, listDecisionEmails, sendDecisionEmail } from "@/lib/services/decision-email";

// Decision emails: only for a saved decision, once per candidate, job and kind, and never with the reason.
const id = Date.now().toString(36);
let orgId = "", owner = "", jobA = "", jobB = "", cand = "", other = "";
const users: string[] = [];
const outbox = async (to: string) => withSystem((tx) => tx<{ subject: string; body_text: string }[]>`
  select subject, body_text from email_outbox where organization_id = ${orgId} and to_email = ${to} order by created_at`);

beforeAll(async () => {
  await withSystem(async (tx) => {
    const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug, interview_quota) values (${`Decide Co ${id}`}, ${`decide-co-${id}`}, null) returning id`;
    orgId = o.id;
    const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`owner-${id}@decide.test`}, 'Olivia Owner', 'x') returning id`;
    owner = u.id; users.push(u.id);
    await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${owner}, 'owner')`;
    const job = async (t: string) => (await tx<{ id: string }[]>`insert into jobs (organization_id, title, status) values (${orgId}, ${t}, 'active') returning id`)[0].id;
    jobA = await job("Data Analyst"); jobB = await job("BI Developer");
    const person = async (name: string) => (await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${orgId}, ${name}, ${`${name.split(" ")[0].toLowerCase()}-${id}@decide.test`}) returning id`)[0].id;
    cand = await person("Noah Mehta"); other = await person("Ravi Shah");
    for (const j of [jobA, jobB]) await tx`insert into job_candidates (organization_id, job_id, candidate_id, stage) values (${orgId}, ${j}, ${cand}, 'in_progress')`;
    await tx`insert into job_candidates (organization_id, job_id, candidate_id, stage) values (${orgId}, ${jobA}, ${other}, 'in_progress')`;
  });
});

afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = any(${users})`;
  });
});

describe("decision emails", () => {
  it("writes a plain default text naming the role, or the roles when there are several", () => {
    const one = decisionEmailText("rejected", { firstName: "Noah", company: "Northwind", jobs: ["Data Analyst"] });
    expect(one.subject).toBe("Your application for Data Analyst at Northwind");
    expect(one.text).toContain("not to move forward");
    expect(decisionEmailText("rejected", { firstName: "Noah", company: "Northwind", jobs: ["A", "B"] }).text).toContain("the roles you applied for");
    expect(decisionEmailText("shortlisted", { firstName: "Noah", company: "Northwind", jobs: ["Data Analyst"] }).text).toContain("move forward with your application");
  });

  it("refuses to send before the decision is saved", async () => {
    await expect(sendDecisionEmail(orgId, owner, cand, { kind: "rejected", jobIds: [jobA], subject: "Your application", text: "Hi Noah, we're not moving forward at this time." }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("sends once for a rejection, and says it was already sent after that", async () => {
    await withSystem((tx) => tx`update job_candidates set stage = 'rejected' where job_id = ${jobA} and candidate_id = ${cand}`);
    const draft = await getDecisionEmailDraft(orgId, cand, "rejected", [jobA]);
    expect(draft.jobs.map((j) => j.title)).toEqual(["Data Analyst"]);
    await sendDecisionEmail(orgId, owner, cand, { kind: "rejected", jobIds: [jobA], subject: draft.subject, text: draft.text });
    expect(await outbox(draft.to)).toHaveLength(1);
    await expect(sendDecisionEmail(orgId, owner, cand, { kind: "rejected", jobIds: [jobA], subject: draft.subject, text: draft.text }))
      .rejects.toMatchObject({ status: 409, code: "already_sent" });
    const again = await getDecisionEmailDraft(orgId, cand, "rejected", [jobA]);
    expect(again.jobs).toEqual([]);
    expect(again.sent[0]).toMatchObject({ job_title: "Data Analyst" });
    expect(await listDecisionEmails(orgId, cand)).toEqual([expect.objectContaining({ kind: "rejected", job_title: "Data Analyst", sent_by_name: "Olivia Owner" })]);
  });

  it("on archive, covers only the jobs not emailed yet, and never for the candidate's own reasons", async () => {
    // "Not interested" is the candidate's choice: no email.
    await archiveCandidate(orgId, owner, other, "Not interested");
    await expect(sendDecisionEmail(orgId, owner, other, { kind: "rejected", jobIds: [jobA], subject: "Your application", text: "Hi Ravi, we're not moving forward at this time." }))
      .rejects.toMatchObject({ status: 409 });
    // Budget: the team's decision. Job A was already emailed, so only job B is left.
    await archiveCandidate(orgId, owner, cand, "Budget");
    const draft = await getDecisionEmailDraft(orgId, cand, "rejected", null);
    expect(draft.jobs.map((j) => j.title)).toEqual(["BI Developer"]);
    expect(draft.text).not.toMatch(/budget/i);
    await sendDecisionEmail(orgId, owner, cand, { kind: "rejected", jobIds: draft.jobs.map((j) => j.id), subject: draft.subject, text: draft.text });
    expect((await listDecisionEmails(orgId, cand)).map((e) => e.job_title).sort()).toEqual(["BI Developer", "Data Analyst"]);
  });
});
