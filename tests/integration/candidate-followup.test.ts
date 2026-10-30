import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, withSystem } from "@/lib/database/db";
import { hashToken, generateToken } from "@/lib/security/tokens";
import { sendCandidateFollowup } from "@/lib/interview/candidate-followup";

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

async function interview(opts: { completedAgoHours?: number; answers?: number; endedReason?: "left"; feedbackSetting?: boolean } = {}) {
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
    await tx`insert into interview_reports (organization_id, interview_id, status, report_json) values (${orgId}, ${iv.id}, 'completed', ${json(report)})`;
    return iv.id;
  });
  return { ivId, email };
}

const outbox = (email: string) => withSystem((tx) => tx<{ subject: string; body_text: string }[]>`select subject, body_text from email_outbox where to_email = ${email}`);
const saved = (ivId: string) => withSystem(async (tx) => (await tx<{ sent: Date | null; feedback: string | null }[]>`
  select candidate_email_sent_at as sent, candidate_feedback as feedback from interviews where id = ${ivId}`)[0]);

beforeAll(async () => {
  const [o] = await withSystem((tx) => tx<{ id: string }[]>`insert into organizations (name, slug) values (${`Acme Hiring ${id}`}, ${`acme-followup-${id}`}) returning id`);
  orgId = o.id;
  const [j] = await withSystem((tx) => tx<{ id: string }[]>`insert into jobs (organization_id, title, status) values (${orgId}, 'Sr. SEO Executive', 'active') returning id`);
  jobId = j.id;
});

afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from email_outbox where to_email like ${`%-${id}@followup.test`}`;
    await tx`delete from organizations where id = ${orgId}`;
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
});
