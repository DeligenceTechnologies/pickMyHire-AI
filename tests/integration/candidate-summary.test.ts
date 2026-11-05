import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, withSystem } from "@/lib/database/db";
import { DEFAULT_TEMPLATES } from "@/lib/interview/default-templates";
import { createInterview } from "@/lib/services/interviews";
import { saveScorecard, scheduleHumanInterview } from "@/lib/services/human-interviews";
import { getCandidatePipelines, setRoundDecision } from "@/lib/services/pipeline";
import { listRounds, saveRounds } from "@/lib/services/rounds";
import { insertTemplate } from "@/lib/services/templates";
import { buildCandidateSummary, getCandidateSummaries, summariesForPipelines } from "@/lib/services/candidate-summary";

// The overall result for a candidate who cleared every round (AI runs in demo mode in tests).
const id = Date.now().toString(36);
let orgId = "", owner = "", interviewer = "", jobId = "", candidateId = "", aiId = "", humanId = "";
const users: string[] = [];

beforeAll(async () => {
  await withSystem(async (tx) => {
    const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug, interview_quota) values (${`Summary Co ${id}`}, ${`summary-co-${id}`}, null) returning id`;
    orgId = o.id;
    for (const [name, role] of [["Olivia Owner", "owner"], ["Ivan Interviewer", "interviewer"]] as const) {
      const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`${role}-${id}@summary.test`}, ${name}, 'x') returning id`;
      users.push(u.id);
      await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${u.id}, ${role})`;
    }
    [owner, interviewer] = users;
    for (const [i, t] of DEFAULT_TEMPLATES.entries()) await insertTemplate(tx, orgId, owner, t, i === 0);
    const [tpl] = await tx<{ id: string }[]>`select id from interview_templates where organization_id = ${orgId} order by created_at limit 1`;
    const [j] = await tx<{ id: string }[]>`insert into jobs (organization_id, title, status, required_skills) values (${orgId}, 'Summary job', 'active', ${json(["React", "Node.js"])}) returning id`;
    jobId = j.id;
    await saveRounds(tx, orgId, jobId, [
      { name: "Screening", kind: "ai", template_id: tpl.id },
      { name: "Panel", kind: "human", criteria: ["System design", "Communication"], guide: null },
    ]);
    const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${orgId}, 'Hana Kim', ${`hana-${id}@summary.test`}) returning id`;
    candidateId = c.id;
  });
  aiId = (await createInterview(orgId, owner, { jobId, candidateId, sendInvite: false })).id;
  await withSystem(async (tx) => {
    await tx`update interviews set status = 'report_ready', completed_at = now() where id = ${aiId}`;
    const report = { version: 1, generated_by: "mock", prompt_version: "t", sections: [], refs: { S1: { segment_id: "x", start_ms: 61_000, end_ms: 70_000 } },
      final: { summary: "Solid React experience.", strengths: [{ point: "React", evidence_refs: ["S1"] }], areas_to_explore: [], key_evidence: [], missing_evidence: [], fact_vs_interpretation_note: "" } };
    await tx`insert into interview_reports (organization_id, interview_id, status, report_json) values (${orgId}, ${aiId}, 'completed', ${json(report)})`;
  });
  const humanRound = (await listRounds(orgId, jobId)).find((r) => r.kind === "human")!.id;
  humanId = (await scheduleHumanInterview(orgId, owner, {
    jobId, candidateId, roundId: humanRound, scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 45, timezone: "Asia/Kolkata",
    locationType: "video", location: "https://meet.google.com/abc-defg-hij", interviewerIds: [interviewer], message: null, sendEmail: false,
  })).id;
  await saveScorecard(orgId, interviewer, humanId, {
    ratings: [{ criterion: "System design", rating: 4 }, { criterion: "Communication", rating: 5, comment: "Explains trade-offs clearly" }],
    notes: "Strong ownership of past projects", recommendation: "qualified", submit: true,
  });
});

afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = any(${users})`;
  });
});

describe("overall result", () => {
  it("is only built once every round is Qualified", async () => {
    await setRoundDecision(orgId, owner, { kind: "ai", id: aiId, decision: "qualified" });
    await expect(buildCandidateSummary(orgId, jobId, candidateId)).rejects.toMatchObject({ status: 409 });
    const pipelines = await getCandidatePipelines(orgId, candidateId);
    expect((await summariesForPipelines(orgId, candidateId, pipelines)).size).toBe(0);
  });

  it("summarizes the rounds with the interviewers' own scores", async () => {
    await setRoundDecision(orgId, owner, { kind: "human", id: humanId, decision: "qualified" });
    await buildCandidateSummary(orgId, jobId, candidateId);
    const row = (await getCandidateSummaries(orgId, candidateId)).get(jobId)!;
    expect(row.status).toBe("completed");
    expect(row.summary!.headline).toMatchObject({ rounds: 2, ai_rounds: 1, human_rounds: 1, average_rating: 4.5, recommends: 1, scorecards: 1, requirements_total: 2 });
    // Built once: asking again with the same decisions doesn't redo it.
    await buildCandidateSummary(orgId, jobId, candidateId);
    expect((await getCandidateSummaries(orgId, candidateId)).get(jobId)!.updated_at).toEqual(row.updated_at);
  });

  it("is hidden after a round is reopened, and rebuilt when it's Qualified again", async () => {
    const before = (await getCandidateSummaries(orgId, candidateId)).get(jobId)!;
    await setRoundDecision(orgId, owner, { kind: "human", id: humanId, decision: null, note: "Second opinion" });
    expect((await summariesForPipelines(orgId, candidateId, await getCandidatePipelines(orgId, candidateId))).size).toBe(0);
    await setRoundDecision(orgId, owner, { kind: "human", id: humanId, decision: "qualified" });
    const shown = await summariesForPipelines(orgId, candidateId, await getCandidatePipelines(orgId, candidateId));
    expect(shown.get(jobId)?.status).toBe("processing"); // the old one is out of date, and is rebuilt in the background
    let after = (await getCandidateSummaries(orgId, candidateId)).get(jobId)!;
    for (let i = 0; i < 50 && (after.status !== "completed" || after.fingerprint === before.fingerprint); i++) {
      await new Promise((r) => setTimeout(r, 100));
      after = (await getCandidateSummaries(orgId, candidateId)).get(jobId)!;
    }
    expect(after.status).toBe("completed");
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });
});
