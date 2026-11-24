import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSystem } from "@/lib/database/db";
import { assertCandidateAccess, assertInterviewAccess, candidateJobsInScope, jobScope } from "@/lib/auth/job-scope";
import { jobEmailRecipients, listJobTeam, setJobTeam } from "@/lib/services/job-team";
import { scheduleHumanInterview } from "@/lib/services/human-interviews";
import { saveRounds } from "@/lib/services/rounds";
import { visibleHrPanel, getHrPanel, addNote } from "@/lib/services/candidate-notes";

// A job's hiring team: who gets its emails, and which jobs an Interviewer can see.
const id = Date.now().toString(36);
let orgId = "", owner = "", recruiter = "", otherRecruiter = "", interviewer = "", outsider = "";
let jobA = "", jobB = "", candA = "", candB = "", ivA = "", ivB = "", humanRound = "";
const users: string[] = [];
const asInterviewer = () => ({ orgId, userId: interviewer, role: "interviewer" as const });
const asOutsider = () => ({ orgId, userId: outsider, role: "interviewer" as const });

beforeAll(async () => {
  await withSystem(async (tx) => {
    const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug, interview_quota) values (${`Team Co ${id}`}, ${`team-co-${id}`}, null) returning id`;
    orgId = o.id;
    for (const role of ["owner", "recruiter", "recruiter", "interviewer", "interviewer"] as const) {
      const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`${role}-${users.length}-${id}@team.test`}, ${`${role} ${users.length}`}, 'x') returning id`;
      users.push(u.id);
      await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${u.id}, ${role})`;
    }
    [owner, recruiter, otherRecruiter, interviewer, outsider] = users;
    const job = async (title: string) => (await tx<{ id: string }[]>`insert into jobs (organization_id, title, status, created_by) values (${orgId}, ${title}, 'active', ${owner}) returning id`)[0].id;
    jobA = await job("Job A");
    jobB = await job("Job B");
    await saveRounds(tx, orgId, jobA, [{ name: "Panel", kind: "human", criteria: ["Design"], guide: null }]);
    const cand = async (name: string, jobId: string) => {
      const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${orgId}, ${name}, ${`${name.toLowerCase()}-${id}@team.test`}) returning id`;
      const [i] = await tx<{ id: string }[]>`insert into interviews (organization_id, job_id, candidate_id, status, secure_token_hash) values (${orgId}, ${jobId}, ${c.id}, 'report_ready', ${`tok-${c.id}`}) returning id`;
      return [c.id, i.id];
    };
    [candA, ivA] = await cand("Asha", jobA);
    [candB, ivB] = await cand("Bilal", jobB);
    [{ id: humanRound }] = await tx<{ id: string }[]>`select id from job_rounds where job_id = ${jobA}`;
  });
});

afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = any(${users})`;
  });
});

describe("job hiring team", () => {
  it("emails only the recruiters on the team, and everyone when the team has none", async () => {
    // No team yet: falls back to every Owner, Admin and Recruiter.
    const before = await withSystem((tx) => jobEmailRecipients(tx, orgId, jobA));
    expect(before).toHaveLength(3);
    await withSystem((tx) => setJobTeam(tx, orgId, jobA, [recruiter, interviewer], owner));
    const after = await withSystem((tx) => jobEmailRecipients(tx, orgId, jobA));
    // The interviewer is on the team but doesn't get recruiter emails.
    expect(after.map((r) => r.email)).toEqual([expect.stringContaining("recruiter-1-")]);
    expect((await listJobTeam(orgId, jobA)).map((m) => m.user_id).sort()).toEqual([recruiter, interviewer].sort());
  });

  it("lets an interviewer see only the jobs they're on", async () => {
    expect(await jobScope(asInterviewer())).toEqual([jobA]);
    expect(await jobScope({ orgId, userId: otherRecruiter, role: "recruiter" })).toBeNull();
    await expect(assertInterviewAccess(asInterviewer(), ivA)).resolves.toBeUndefined();
    await expect(assertInterviewAccess(asInterviewer(), ivB)).rejects.toMatchObject({ status: 404 });
    await expect(assertCandidateAccess(asInterviewer(), candA)).resolves.toBeUndefined();
    await expect(assertCandidateAccess(asInterviewer(), candB)).rejects.toMatchObject({ status: 404 });
    await expect(assertInterviewAccess(asOutsider(), ivA)).rejects.toMatchObject({ status: 404 });
  });

  it("hides salary details and other jobs' notes from interviewers", async () => {
    await addNote(orgId, owner, candA, { body: "On job A", job_id: jobA });
    await addNote(orgId, owner, candA, { body: "On job B", job_id: jobB });
    await addNote(orgId, owner, candA, { body: "General", job_id: null });
    await withSystem((tx) => tx`insert into candidate_hr_details (candidate_id, organization_id, expected_ctc) values (${candA}, ${orgId}, '30 LPA')`);
    const panel = await getHrPanel(orgId, candA);
    const seen = visibleHrPanel(panel, false, await candidateJobsInScope(asInterviewer(), candA));
    expect(seen.details).toBeNull();
    expect(seen.notes.map((n) => n.body).sort()).toEqual(["General", "On job A"]);
    expect(visibleHrPanel(panel, true, null).details).toMatchObject({ expected_ctc: "30 LPA" });
  });

  it("adds a live round's panel to the job's team, and removing them takes access away", async () => {
    await scheduleHumanInterview(orgId, owner, {
      jobId: jobA, candidateId: candA, roundId: humanRound, scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), durationMinutes: 45,
      timezone: "UTC", locationType: "video", location: "https://meet.example/x", interviewerIds: [outsider], message: null, sendEmail: false,
    });
    expect(await jobScope(asOutsider())).toEqual([jobA]);
    await withSystem((tx) => setJobTeam(tx, orgId, jobA, [recruiter, interviewer], owner));
    expect(await jobScope(asOutsider())).toEqual([]);
  });
});
