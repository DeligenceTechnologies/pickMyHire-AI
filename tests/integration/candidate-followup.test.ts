import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, withSystem } from "@/lib/database/db";
import { hashToken, generateToken } from "@/lib/security/tokens";
import { sendCandidateFollowup, sendHeldFeedback } from "@/lib/interview/candidate-followup";
import { buildSimpleReport } from "@/lib/interview/simple-report";

// The email a candidate gets once their interview is processed (AI in demo mode, email logged to the outbox).
const id = Date.now().toString(36);
let orgId = "";
let jobId = "";
let n = 0;
const report = {
  version: 1, generated_by: "mock", prompt_version: "t",
  final: {
    summary: "Clear, specific answers about technical SEO work.",
    strengths: [{ point: "Hands-on technical SEO with schema and canonicals", evidence_refs: [] }],
    areas_to_explore: [{ point: "Linking work to measurable outcomes", reason: "Few baselines given" }],
    key_evidence: [], missing_evidence: [], fact_vs_interpretation_note: "",
  },
  sections: [], refs: {},
};

async function interview(opts: { completedAgoHours?: number; answers?: number; endedReason?: "left"; feedbackSetting?: boolean; strength?: string } = {}) {
  n += 1;
  const email = `cand${n}-${id}@followup.test`;
  const ivId = await withSystem(async (tx) => {
    if (opts.feedbackSetting === false) await tx`update organizations set settings = settings || '{"candidate_feedback_email": false}'::jsonb where id = ${orgId}`;
    else await tx`update organizations set settings = settings || '{"candidate_feedback_email": true}'::jsonb where id = ${orgId}`;
    const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${orgId}, ${`Riya Sharma`}, ${email}) returning id`;
    const completed = new Date(Date.now() - (opts.completedAgoHours ?? 0.1) * 3_600_000);
    const [iv] = await tx<{ id: string }[]>`
      insert into interviews (organization_id, job_id, candidate_id, secure_token_hash, status, started_at, completed_at, state, round_name)
      values (${orgId}, ${jobId}, ${c.id}, ${hashToken(generateToken())}, 'report_ready', ${new Date(completed.getTime() - 1_800_000)}, ${completed},
        ${json(opts.endedReason ? { ended_reason: opts.endedReason } : {})}, 'Screening')
      returning id`;
    const [s] = await tx<{ id: string }[]>`insert into interview_sections (organization_id, interview_id, name, objective, sort_order, status)
      values (${orgId}, ${iv.id}, 'Experience', 'Experience', 0, 'completed') returning id`;
    for (let i = 0; i < (opts.answers ?? 4); i++) {
      const [q] = await tx<{ id: string }[]>`insert into interview_questions (organization_id, interview_id, section_id, question_text, spoken_text, sequence_number)
        values (${orgId}, ${iv.id}, ${s.id}, ${`Q${i}`}, ${`Q${i}`}, ${i + 1}) returning id`;
      await tx`insert into interview_answers (organization_id, interview_id, question_id, transcript_text) values (${orgId}, ${iv.id}, ${q.id}, 'An answer about schema markup.')`;
    }
    const r = opts.strength ? { ...report, final: { ...report.final, strengths: [{ point: opts.strength, evidence_refs: [] }] } } : report;
    await tx`insert into interview_reports (organization_id, interview_id, status, report_json) values (${orgId}, ${iv.id}, 'completed', ${json(r)})`;
    return iv.id;
  });
  return { ivId, email };
}

const outbox = (email: string) => withSystem((tx) => tx<{ subject: string; body_text: string }[]>`select subject, body_text from email_outbox where to_email = ${email}`);
const saved = (ivId: string) => withSystem(async (tx) => (await tx<{ sent: Date | null; feedback: string | null; draft: string | null; reason: string | null; manual: Date | null }[]>`
  select candidate_email_sent_at as sent, candidate_feedback as feedback, candidate_feedback_draft as draft,
    candidate_feedback_held_reason as reason, candidate_feedback_sent_at as manual from interviews where id = ${ivId}`)[0]);
let userId = "";

beforeAll(async () => {
  const [o] = await withSystem((tx) => tx<{ id: string }[]>`insert into organizations (name, slug) values (${`Acme Hiring ${id}`}, ${`acme-followup-${id}`}) returning id`);
  orgId = o.id;
  const [j] = await withSystem((tx) => tx<{ id: string }[]>`insert into jobs (organization_id, title, status) values (${orgId}, 'Sr. SEO Executive', 'active') returning id`);
  jobId = j.id;
  const [u] = await withSystem((tx) => tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`rec-${id}@followup.test`}, 'Recruiter', 'x') returning id`);
  userId = u.id;
});

afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from email_outbox where to_email like ${`%-${id}@followup.test`}`;
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = ${userId}`;
  });
});

describe("email to the candidate after the interview", () => {
  it("sends a confirmation with labelled AI feedback, once", async () => {
    const { ivId, email } = await interview();
    await sendCandidateFollowup(orgId, ivId);
    await sendCandidateFollowup(orgId, ivId); // regenerated report / second processing run
    const mails = await outbox(email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("Thank you for your interview: Sr. SEO Executive");
    expect(mails[0].body_text).toContain("Hi Riya,");
    expect(mails[0].body_text).toContain("Thank you for taking your Screening interview for the Sr. SEO Executive role");
    expect(mails[0].body_text).toContain("Feedback on your interview");
    expect(mails[0].body_text).toContain("Hands-on technical SEO with schema and canonicals came through clearly");
    expect(mails[0].body_text).toContain("This feedback was generated by AI from your interview answers. It is not a hiring decision");
    const row = await saved(ivId);
    expect(row.sent).not.toBeNull();
    expect(row.feedback).toContain("Hands-on technical SEO");
  });

  it("sends only the confirmation when the company turned feedback off, or there's too little to go on", async () => {
    for (const opts of [{ feedbackSetting: false }, { answers: 2 }, { endedReason: "left" as const }]) {
      const { ivId, email } = await interview(opts);
      await sendCandidateFollowup(orgId, ivId);
      const mails = await outbox(email);
      expect(mails).toHaveLength(1);
      expect(mails[0].body_text).not.toContain("Feedback on your interview");
      expect((await saved(ivId)).feedback).toBeNull();
    }
  });

  it("never emails candidates about old interviews (e.g. when a report is regenerated later)", async () => {
    const { ivId, email } = await interview({ completedAgoHours: 48 });
    await sendCandidateFollowup(orgId, ivId);
    expect(await outbox(email)).toHaveLength(0);
    expect((await saved(ivId)).sent).toBeNull();
  });

  it("holds back feedback that mentions a result, and a recruiter can send that exact text once", async () => {
    const { ivId, email } = await interview({ strength: "You scored well on technical SEO" });
    await sendCandidateFollowup(orgId, ivId);
    let mails = await outbox(email);
    expect(mails).toHaveLength(1);
    expect(mails[0].body_text).not.toContain("Feedback on your interview");
    let row = await saved(ivId);
    expect(row.feedback).toBeNull();
    expect(row.reason).toBe("You scored");
    expect(row.draft).toContain("You scored well on technical SEO");

    expect(await sendHeldFeedback(orgId, userId, ivId)).toBe(true);
    expect(await sendHeldFeedback(orgId, userId, ivId)).toBe(false); // double click / second recruiter
    mails = await outbox(email);
    expect(mails).toHaveLength(2);
    const manual = mails.find((m) => m.subject === "Feedback on your interview: Sr. SEO Executive")!;
    expect(manual.body_text).toContain("You scored well on technical SEO");
    expect(manual.body_text).toContain("reviewed by the Acme Hiring");
    row = await saved(ivId);
    expect(row.feedback).toContain("You scored well on technical SEO");
    expect(row.draft).toBeNull();
    expect(row.manual).not.toBeNull();
  });

  it("lets ordinary job words through instead of holding the feedback", async () => {
    const { ivId, email } = await interview({ strength: "Raising the site's SEO score and app ratings" });
    await sendCandidateFollowup(orgId, ivId);
    const mails = await outbox(email);
    expect(mails[0].body_text).toContain("Feedback on your interview");
    expect((await saved(ivId)).draft).toBeNull();
  });

  it("nothing to send when no feedback was held back", async () => {
    const { ivId } = await interview({ feedbackSetting: false });
    await sendCandidateFollowup(orgId, ivId);
    expect(await sendHeldFeedback(orgId, userId, ivId)).toBe(false);
  });
});

describe("simple report", () => {
  it("is written from the finished report, one line per section, and saved", async () => {
    const { ivId } = await interview();
    await withSystem((tx) => tx`update jobs set parsed_requirements = ${json({ summary: "SEO", skills: [{ name: "Technical SEO", importance: "required" }, { name: "GA4", importance: "required" }], experience: { minimum_years: null, maximum_years: null }, responsibilities: [], seniority: "senior" })} where id = ${jobId}`);
    await withSystem((tx) => tx`update interview_reports set report_json = jsonb_set(report_json, '{sections}', ${json([{ section_id: "x", name: "Experience", objective: "Experience", status: "completed", assessment: "strong", score: 4, summary: "Gave clear examples of schema work. Mentioned audits." }])}) where interview_id = ${ivId}`);
    const simple = await buildSimpleReport(orgId, ivId);
    expect(simple.headline).toBe("Clear, specific answers about technical SEO work.");
    expect(simple.requirements.map((r) => [r.requirement, r.status])).toEqual([["Technical SEO", "shown"], ["GA4", "not_asked"]]);
    expect(simple.sections).toEqual([{ name: "Experience", note: "Gave clear examples of schema work." }]);
    const [row] = await withSystem((tx) => tx<{ simple_report: { headline: string } | null }[]>`select simple_report from interview_reports where interview_id = ${ivId}`);
    expect(row.simple_report?.headline).toBe(simple.headline);
  });

  it("refuses while the detailed report isn't ready", async () => {
    const { ivId } = await interview();
    await withSystem((tx) => tx`update interview_reports set status = 'processing' where interview_id = ${ivId}`);
    await expect(buildSimpleReport(orgId, ivId)).rejects.toThrow("isn't ready");
  });
});
