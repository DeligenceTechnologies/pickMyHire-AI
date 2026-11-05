import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSystem } from "@/lib/database/db";
import { DEFAULT_TEMPLATES } from "@/lib/interview/default-templates";
import { createInterview } from "@/lib/services/interviews";
import { calendarFile, cancelHumanInterview, CreateHumanSchema, getHumanInterview, rescheduleHumanInterview, saveScorecard, scheduleHumanInterview } from "@/lib/services/human-interviews";
import { getCandidatePipelines, getJobPipeline, setRoundDecision, setStage } from "@/lib/services/pipeline";
import { listRounds, saveRounds } from "@/lib/services/rounds";
import { insertTemplate } from "@/lib/services/templates";

// Round decisions, the shortlist pipeline and human interviews against the local database.
const id = Date.now().toString(36);
let orgId = "", owner = "", interviewer = "", outsider = "", viewer = "", jobId = "", candidateId = "", humanRound = "";
const users: string[] = [];
const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const schedule = (extra: Partial<Parameters<typeof scheduleHumanInterview>[2]> = {}) => scheduleHumanInterview(orgId, owner, {
  jobId, candidateId, roundId: humanRound, scheduledAt: at(2), durationMinutes: 45, timezone: "Asia/Kolkata", locationType: "video",
  location: "https://zoom.us/j/123", interviewerIds: [owner, interviewer], message: null, sendEmail: true, ...extra,
});

beforeAll(async () => {
  await withSystem(async (tx) => {
    const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug, interview_quota) values (${`Hiring Co ${id}`}, ${`hiring-co-${id}`}, null) returning id`;
    orgId = o.id;
    for (const [name, role] of [["Olivia Owner", "owner"], ["Ivan Interviewer", "interviewer"], ["Otto Outsider", "interviewer"], ["Vera Viewer", "viewer"]] as const) {
      const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`${role}-${users.length}-${id}@hiring.test`}, ${name}, 'x') returning id`;
      users.push(u.id);
      await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${u.id}, ${role})`;
    }
    [owner, interviewer, outsider, viewer] = users;
    for (const [i, t] of DEFAULT_TEMPLATES.entries()) await insertTemplate(tx, orgId, owner, t, i === 0);
    const [tpl] = await tx<{ id: string }[]>`select id from interview_templates where organization_id = ${orgId} order by created_at limit 1`;
    const [j] = await tx<{ id: string }[]>`insert into jobs (organization_id, title, status) values (${orgId}, 'Hiring job', 'active') returning id`;
    jobId = j.id;
    await saveRounds(tx, orgId, jobId, [
      { name: "Screening", kind: "ai", template_id: tpl.id },
      { name: "Panel", kind: "human", criteria: ["System design", "Communication"], guide: "Ask about scaling" },
    ]);
    const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${orgId}, 'Hana Kim', ${`hana-${id}@hiring.test`}) returning id`;
    candidateId = c.id;
  });
  humanRound = (await listRounds(orgId, jobId)).find((r) => r.kind === "human")!.id;
});

afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = any(${users})`;
  });
});

describe("hiring decisions and human interviews", () => {
  let aiId = "", humanId = "";

  it("puts an invited candidate in the job's pipeline and keeps AI invites off human rounds", async () => {
    await expect(createInterview(orgId, owner, { jobId, candidateId, roundId: humanRound, sendInvite: false })).rejects.toMatchObject({ status: 400 });
    aiId = (await createInterview(orgId, owner, { jobId, candidateId, sendInvite: false })).id;
    const [p] = await getCandidatePipelines(orgId, candidateId);
    expect(p).toMatchObject({ stage: "in_progress", allQualified: false });
    expect(p.results.map((r) => [r.round.name, r.round.kind, r.state])).toEqual([["Screening", "ai", "waiting"], ["Panel", "human", "none"]]);
  });

  it("records the team's decision on the AI round", async () => {
    await withSystem((tx) => tx`update interviews set status = 'report_ready', completed_at = now() where id = ${aiId}`);
    await setRoundDecision(orgId, owner, { kind: "ai", id: aiId, decision: "qualified", note: "Clear communicator" });
    const [p] = await getCandidatePipelines(orgId, candidateId);
    expect(p.results[0]).toMatchObject({ decision: "qualified", state: "done" });
  });

  it("schedules a human interview with a panel, and only once at a time", async () => {
    await expect(schedule({ interviewerIds: [viewer] })).rejects.toMatchObject({ status: 400 });
    humanId = (await schedule()).id;
    await expect(schedule()).rejects.toMatchObject({ status: 409, code: "already_scheduled" });
    const h = await getHumanInterview(orgId, humanId, { userId: owner, role: "owner" });
    expect(h).toMatchObject({ status: "scheduled", round_name: "Panel", criteria: ["System design", "Communication"], guide: "Ask about scaling", sequence: 0 });
    expect(h!.panel.map((p) => p.user_id).sort()).toEqual([owner, interviewer].sort());
    // Interviewers only see interviews they're on.
    expect(await getHumanInterview(orgId, humanId, { userId: interviewer, role: "interviewer" })).not.toBeNull();
    expect(await getHumanInterview(orgId, humanId, { userId: outsider, role: "interviewer" })).toBeNull();
    // Invites go to the candidate and each interviewer (outbox while email isn't set up).
    const [{ n }] = await withSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from email_outbox where organization_id = ${orgId} and subject like '%Panel interview%'`);
    expect(n).toBe(3);
    // Each one carries the calendar file, and replies go to whoever scheduled it.
    const mails = await withSystem((tx) => tx<{ body_text: string }[]>`select body_text from email_outbox where organization_id = ${orgId} and subject like '%Panel interview%'`);
    for (const m of mails) {
      expect(m.body_text).toContain("Attached: invite.ics");
      expect(m.body_text).toMatch(/Reply-to: Olivia Owner <owner-\d+-\w+@hiring\.test>/);
    }
    const [assigned] = await withSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from notifications where organization_id = ${orgId} and type = 'human_interview.assigned' and user_id = ${interviewer}`);
    expect(assigned.n).toBe(1);
  });

  it("reschedules, updating the calendar invite and history", async () => {
    await rescheduleHumanInterview(orgId, owner, humanId, { scheduledAt: at(3), durationMinutes: 60, timezone: "Asia/Kolkata", locationType: "video", location: "https://zoom.us/j/456", interviewerIds: [interviewer], message: null, sendEmail: false, reason: "Clash" });
    const h = (await getHumanInterview(orgId, humanId, { userId: owner, role: "owner" }))!;
    expect(h).toMatchObject({ sequence: 1, duration_minutes: 60, location: "https://zoom.us/j/456" });
    expect(h.panel.map((p) => p.user_id)).toEqual([interviewer]);
    expect(h.history.map((e) => e.type)).toEqual(["scheduled", "rescheduled"]);
    expect(calendarFile(h, "candidate")).toContain("SEQUENCE:1");
  });

  it("takes scorecards only from the panel, and submitting one completes the interview", async () => {
    const ratings = [{ criterion: "System design", rating: 4 }, { criterion: "Communication", rating: 5, comment: "Very clear" }];
    await expect(saveScorecard(orgId, owner, humanId, { ratings, notes: null, recommendation: "qualified", submit: true })).rejects.toMatchObject({ status: 403 });
    await expect(saveScorecard(orgId, interviewer, humanId, { ratings: ratings.slice(0, 1), notes: null, recommendation: "qualified", submit: true })).rejects.toMatchObject({ status: 400 });
    await saveScorecard(orgId, interviewer, humanId, { ratings, notes: "Hire", recommendation: "qualified", submit: true });
    const h = (await getHumanInterview(orgId, humanId, { userId: owner, role: "owner" }))!;
    expect(h.status).toBe("completed");
    expect(h.scorecards[0]).toMatchObject({ user_id: interviewer, recommendation: "qualified", notes: "Hire" });
    expect(h.scorecards[0].ratings).toEqual([{ criterion: "System design", rating: 4, comment: null }, { criterion: "Communication", rating: 5, comment: "Very clear" }]);
  });

  it("asks for a reason to shortlist early, then shortlists once every round is qualified", async () => {
    await expect(setStage(orgId, owner, { jobId, candidateId, stage: "shortlisted" })).rejects.toMatchObject({ status: 400, code: "needs_reason" });
    await setRoundDecision(orgId, owner, { kind: "human", id: humanId, decision: "qualified" });
    // Deciding locks scorecards; clearing the decision unlocks them.
    const ratings = [{ criterion: "System design", rating: 3 }, { criterion: "Communication", rating: 3 }];
    await expect(saveScorecard(orgId, interviewer, humanId, { ratings, notes: null, recommendation: "on_hold", submit: true })).rejects.toMatchObject({ status: 409, code: "scorecard_locked" });
    // Reopening needs a reason; an edit afterwards keeps the earlier version and is flagged for the team.
    await expect(setRoundDecision(orgId, owner, { kind: "human", id: humanId, decision: null })).rejects.toMatchObject({ status: 400, code: "needs_reason" });
    await setRoundDecision(orgId, owner, { kind: "human", id: humanId, decision: null, note: "Reference check raised a question" });
    await saveScorecard(orgId, interviewer, humanId, { ratings, notes: "Changed my mind", recommendation: "on_hold", submit: true });
    const edited = (await getHumanInterview(orgId, humanId, { userId: owner, role: "owner" }))!;
    expect(edited.scorecards[0]).toMatchObject({ recommendation: "on_hold", edited_after_decision: true });
    expect(edited.scorecards[0].versions).toEqual([expect.objectContaining({ recommendation: "qualified", notes: "Hire" })]);
    expect(edited.history.map((e) => e.type)).toEqual(expect.arrayContaining(["decided", "decision_cleared", "scorecard_edited"]));
    expect(edited.history.find((e) => e.type === "decision_cleared")).toMatchObject({ reason: "Reference check raised a question", decision: "qualified" });
    expect(edited.history.find((e) => e.type === "scorecard_edited")).toMatchObject({ afterDecision: true, detail: "recommendation Qualified → On hold" });
    const [{ n }] = await withSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from audit_logs where entity_id = ${humanId} and action = 'human_interview.scorecard_updated'`);
    expect(n).toBe(1);
    await setRoundDecision(orgId, owner, { kind: "human", id: humanId, decision: "qualified" });
    await setStage(orgId, owner, { jobId, candidateId, stage: "shortlisted" });
    const { rows } = await getJobPipeline(orgId, jobId);
    expect(rows).toEqual([expect.objectContaining({ candidate_id: candidateId, stage: "shortlisted", allQualified: true })]);
    await setStage(orgId, owner, { jobId, candidateId, stage: "hired", note: "Offer accepted" });
    expect((await getCandidatePipelines(orgId, candidateId))[0]).toMatchObject({ stage: "hired", stage_note: "Offer accepted" });
  });

  it("schedules an extra one-off interview for one candidate without changing the job's rounds", async () => {
    const extra = { name: "Founder chat", criteria: ["Ownership", "Motivation"], guide: "Why this role?" };
    const first = (await schedule({ roundId: undefined, extra, interviewerIds: [owner] })).id;
    const h = (await getHumanInterview(orgId, first, { userId: owner, role: "owner" }))!;
    expect(h).toMatchObject({ round_id: null, round_name: "Founder chat", criteria: ["Ownership", "Motivation"], guide: "Why this role?", attempt: 1 });
    expect((await listRounds(orgId, jobId)).map((r) => r.name)).toEqual(["Screening", "Panel"]);
    const [p] = await getCandidatePipelines(orgId, candidateId);
    expect(p.extras.map((e) => e.round_name)).toContain("Founder chat");
    // The same extra interview again is attempt 2.
    await cancelHumanInterview(orgId, owner, first, { reason: "Moved", sendEmail: false });
    await withSystem((tx) => tx`update human_interviews set status = 'completed' where id = ${first}`);
    const second = (await schedule({ roundId: undefined, extra: { ...extra, name: "founder chat" }, interviewerIds: [owner] })).id;
    expect((await getHumanInterview(orgId, second, { userId: owner, role: "owner" }))!.attempt).toBe(2);
    await cancelHumanInterview(orgId, owner, second, { reason: "Not needed", sendEmail: false });
  });

  it("refuses an interview without the link, phone number or address its type needs", async () => {
    const extra = (n: string) => ({ roundId: undefined, extra: { name: `Check ${n} ${id}`, criteria: ["Communication"] } });
    await expect(schedule({ ...extra("a"), locationType: "video", location: null })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/meeting link/) });
    await expect(schedule({ ...extra("b"), locationType: "phone", location: "  " })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/phone number/) });
    await expect(schedule({ ...extra("c"), locationType: "in_person", location: "" })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/address/) });
    await expect(schedule({ ...extra("d"), locationType: "phone", location: "call me" })).rejects.toMatchObject({ status: 400 });
    const ok = await schedule({ ...extra("e"), locationType: "video", location: "zoom.us/j/777" });
    expect((await getHumanInterview(orgId, ok.id, { userId: owner, role: "owner" }))!.location).toBe("https://zoom.us/j/777");
    await expect(rescheduleHumanInterview(orgId, owner, ok.id, { scheduledAt: at(4), durationMinutes: 30, timezone: "UTC", locationType: "in_person", location: null, interviewerIds: [owner], message: null, sendEmail: false }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/address/) });
    await cancelHumanInterview(orgId, owner, ok.id, { reason: "Test", sendEmail: false });
  });

  it("needs either a job round or an extra interview, not both", () => {
    const base = { jobId, candidateId, scheduledAt: at(1), durationMinutes: 30, timezone: "UTC", locationType: "video", interviewerIds: [owner] };
    expect(CreateHumanSchema.safeParse(base).success).toBe(false);
    expect(CreateHumanSchema.safeParse({ ...base, roundId: humanRound, extra: { name: "X", criteria: ["Y"] } }).success).toBe(false);
    expect(CreateHumanSchema.safeParse({ ...base, extra: { name: "X", criteria: [] } }).success).toBe(false);
    expect(CreateHumanSchema.safeParse({ ...base, extra: { name: "X", criteria: ["Y"] } }).success).toBe(true);
  });

  it("cancels a scheduled interview and the calendar file removes it", async () => {
    await withSystem((tx) => tx`delete from human_interview_scorecards where human_interview_id = ${humanId}`);
    const again = (await schedule({ interviewerIds: [owner] })).id;
    await cancelHumanInterview(orgId, owner, again, { reason: "Position filled", sendEmail: false });
    const h = (await getHumanInterview(orgId, again, { userId: owner, role: "owner" }))!;
    expect(h).toMatchObject({ status: "cancelled", cancel_reason: "Position filled", sequence: 1, attempt: 2 });
    expect(calendarFile(h, "team")).toContain("METHOD:CANCEL");
    // A cancelled interview doesn't change the round's result.
    expect((await getCandidatePipelines(orgId, candidateId))[0].results[1].decision).toBe("qualified");
  });
});
