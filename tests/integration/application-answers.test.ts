import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, withSystem } from "@/lib/database/db";
import { DEFAULT_FORM, type ApplicationForm, type HiringLimits, NO_LIMITS } from "@/lib/application-form";
import { answersForCandidate, fitForJob, saveAnswers } from "@/lib/services/application-answers";
import { getPublicJob, submitApplication } from "@/lib/services/applications";
import { getHrPanel, HrDetailsSchema, saveHrDetails } from "@/lib/services/candidate-notes";

// Application questions, answers and the fit check against the local database.
const id = Date.now().toString(36);
const slug = `qa-job-${id}`;
let orgId = "", userId = "", jobId = "";
const form: ApplicationForm = { ...DEFAULT_FORM, custom: [{ id: "permit01", label: "Valid work permit?", type: "yes_no", required: true, options: [], expected: "yes" }] };
const limits: HiringLimits = { ...NO_LIMITS, budget_min: 8, budget_max: 12, max_notice_days: 30 };
const resume = { name: "resume.txt", bytes: new TextEncoder().encode("Asha Rao\nSEO specialist with 4 years of experience in Google Search Console, Ahrefs and Semrush.") };
const applicant = (n: string) => ({ name: `Applicant ${n}`, email: `applicant-${n}-${id}@qa.test`, phone: null, linkedin_url: null, cover_note: null, consent: true as const });

beforeAll(async () => {
  await withSystem(async (tx) => {
    const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug, interview_quota) values (${`QA Co ${id}`}, ${`qa-co-${id}`}, null) returning id`;
    orgId = o.id;
    const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`rec-${id}@qa.test`}, 'Rita Recruiter', 'x') returning id`;
    userId = u.id;
    await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${userId}, 'recruiter')`;
    const [j] = await tx<{ id: string }[]>`
      insert into jobs (organization_id, title, status, apply_enabled, apply_slug, application_form, hiring_limits)
      values (${orgId}, 'SEO Executive', 'active', true, ${slug}, ${json(form)}, ${json(limits)}) returning id`;
    jobId = j.id;
  });
});

afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = ${userId}`;
  });
});

describe("application questions", () => {
  it("shows the questions on the public page, never the internal limits", async () => {
    const job = await getPublicJob(slug);
    expect(job?.application_form.custom[0].label).toBe("Valid work permit?");
    expect(JSON.stringify(job)).not.toMatch(/budget|hiring_limits|max_notice/);
  });

  it("rejects an application with missing or badly formatted answers, before saving anything", async () => {
    await expect(submitApplication(slug, applicant("bad"), resume, { expected_ctc: "lots", custom: {} })).rejects.toMatchObject({
      status: 400,
      issues: expect.arrayContaining([
        { path: "answers.expected_ctc", message: "Enter a number" },
        { path: "answers.notice_period", message: "This answer is required" },
        { path: "answers.custom.permit01", message: "This answer is required" },
      ]),
    });
    const left = await withSystem((tx) => tx`select 1 from candidates where email = ${`applicant-bad-${id}@qa.test`}`);
    expect(left).toHaveLength(0);
  });

  it("saves the applicant's answers, fills HR details and checks fit", async () => {
    await submitApplication(slug, applicant("ok"), resume, { expected_ctc: "13", notice_period: "15", custom: { permit01: "yes" } });
    const [c] = await withSystem((tx) => tx<{ id: string }[]>`select id from candidates where email = ${`applicant-ok-${id}@qa.test`}`);
    const [item] = await answersForCandidate(orgId, c.id);
    expect(item).toMatchObject({ job_title: "SEO Executive", answered_by_name: null, answers: { expected_ctc: 13, notice_period: "15" } });
    expect(item.fit.level).toBe("warn"); // 13 LPA is 8% over a 12 LPA budget
    expect((await getHrPanel(orgId, c.id)).details).toMatchObject({ expected_ctc: "13 LPA", notice_period: "15 days" });
    expect((await fitForJob(orgId, jobId)).get(c.id)?.level).toBe("warn");
  });

  it("lets a recruiter fill in answers for a direct invite, keeping other HR details", async () => {
    const [c] = await withSystem((tx) => tx<{ id: string }[]>`
      insert into candidates (organization_id, name, email) values (${orgId}, 'Direct Dev', ${`direct-${id}@qa.test`}) returning id`);
    await saveHrDetails(orgId, userId, c.id, HrDetailsSchema.parse({ other_details: "Referred by Priya" }));
    await expect(saveAnswers(orgId, userId, jobId, c.id, { expected_ctc: "10" })).rejects.toMatchObject({ status: 400 });
    await saveAnswers(orgId, userId, jobId, c.id, { expected_ctc: "10", notice_period: "immediate", custom: { permit01: "no" } });
    const [item] = await answersForCandidate(orgId, c.id);
    expect(item.answered_by_name).toBe("Rita Recruiter");
    expect(item.fit).toMatchObject({ level: "fail", items: expect.arrayContaining([expect.objectContaining({ key: "custom.permit01", level: "fail" })]) });
    expect((await getHrPanel(orgId, c.id)).details).toMatchObject({ expected_ctc: "10 LPA", notice_period: "Immediate", other_details: "Referred by Priya" });
  });
});
