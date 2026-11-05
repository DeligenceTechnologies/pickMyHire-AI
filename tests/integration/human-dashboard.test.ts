import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSystem } from "@/lib/database/db";
import { cancelHumanInterview, listMyHumanInterviews, saveScorecard, scheduleHumanInterview } from "@/lib/services/human-interviews";
import { setRoundDecision } from "@/lib/services/pipeline";
import { listRounds, saveRounds } from "@/lib/services/rounds";
import type { Role } from "@/lib/auth/permissions";

// The dashboard's "Human interviews" card shows only what still needs each person.
const id = Date.now().toString(36);
let orgId = "", jobId = "", humanRound = "";
const u: Record<"owner" | "recruiter" | "ivA" | "ivB" | "ivC", string> = { owner: "", recruiter: "", ivA: "", ivB: "", ivC: "" };
const role: Record<keyof typeof u, Role> = { owner: "owner", recruiter: "recruiter", ivA: "interviewer", ivB: "interviewer", ivC: "interviewer" };
const candidates: string[] = [];
const ratings = [{ criterion: "Communication", rating: 4 }];

beforeAll(async () => {
  await withSystem(async (tx) => {
    const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug, interview_quota) values (${`Dash Co ${id}`}, ${`dash-co-${id}`}, null) returning id`;
    orgId = o.id;
    for (const k of Object.keys(u) as (keyof typeof u)[]) {
      const [x] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`${k}-${id}@dash.test`}, ${k}, 'x') returning id`;
      u[k] = x.id;
      await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${x.id}, ${role[k]})`;
    }
    const [j] = await tx<{ id: string }[]>`insert into jobs (organization_id, title, status) values (${orgId}, 'Dash job', 'active') returning id`;
    jobId = j.id;
    await saveRounds(tx, orgId, jobId, [{ name: "Panel", kind: "human", criteria: ["Communication"] }]);
    for (const name of ["Past Pat", "Future Fay", "Early Eli", "Cancel Cy"]) {
      const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${orgId}, ${name}, ${`${name.split(" ")[1].toLowerCase()}-${id}@dash.test`}) returning id`;
      candidates.push(c.id);
    }
  });
  humanRound = (await listRounds(orgId, jobId)).find((r) => r.kind === "human")!.id;
});

afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = any(${Object.values(u)})`;
  });
});

const schedule = (candidateId: string, panel: string[], hoursFromNow: number) => scheduleHumanInterview(orgId, u.recruiter, {
  jobId, candidateId, roundId: humanRound, scheduledAt: new Date(Date.now() + hoursFromNow * 3_600_000).toISOString(), durationMinutes: 45, timezone: "UTC",
  locationType: "video", location: "https://meet.google.com/abc-defg-hij", interviewerIds: panel, message: null, sendEmail: false,
});
/** What person k sees on the card: interview id → reason. */
const card = async (k: keyof typeof u) =>
  Object.fromEntries((await listMyHumanInterviews(orgId, { userId: u[k], role: role[k] })).map((r) => [r.id, r.kind]));
const moveToPast = (hid: string, hoursAgo: number) =>
  withSystem((tx) => tx`update human_interviews set scheduled_at = now() - make_interval(hours => ${hoursAgo}) where id = ${hid}`);

describe("dashboard: human interviews that still need you", () => {
  let past = "", future = "", early = "";

  it("upcoming: the panel sees 'interviewing'; recruiters see it; other interviewers don't", async () => {
    future = (await schedule(candidates[1], [u.ivA, u.ivB], 48)).id;
    expect((await card("ivA"))[future]).toBe("upcoming");
    expect((await card("owner"))[future]).toBe("upcoming");
    expect((await card("ivC"))[future]).toBeUndefined();
  });

  it("after the interview, each panel member is asked for a scorecard until they submit it", async () => {
    past = (await schedule(candidates[0], [u.ivA, u.ivB], 72)).id;
    await moveToPast(past, 3);
    expect((await card("ivA"))[past]).toBe("scorecard_needed");
    expect((await card("ivB"))[past]).toBe("scorecard_needed");
    expect((await card("recruiter"))[past]).toBeUndefined(); // nothing for them to do yet
    await saveScorecard(orgId, u.ivA, past, { ratings, notes: null, recommendation: "qualified", submit: true });
    expect((await card("ivA"))[past]).toBeUndefined(); // the reported bug: it used to stay, as "You're interviewing"
    expect((await card("ivB"))[past]).toBe("scorecard_needed");
    expect((await card("recruiter"))[past]).toBeUndefined(); // one of two scorecards in
  });

  it("once every scorecard is in, people who decide see 'ready for a decision'; it goes when they decide", async () => {
    await saveScorecard(orgId, u.ivB, past, { ratings, notes: null, recommendation: "qualified", submit: true });
    expect((await card("ivB"))[past]).toBeUndefined();
    const rows = await listMyHumanInterviews(orgId, { userId: u.recruiter, role: "recruiter" });
    expect(rows.find((r) => r.id === past)).toMatchObject({ kind: "ready_to_decide", submitted: 2, panel_size: 2 });
    expect((await card("owner"))[past]).toBe("ready_to_decide");
    expect((await card("ivA"))[past]).toBeUndefined(); // interviewers can't decide
    expect(rows[0].id).toBe(past); // things to act on come before upcoming ones
    await setRoundDecision(orgId, u.recruiter, { kind: "human", id: past, decision: "qualified" });
    expect((await card("recruiter"))[past]).toBeUndefined();
  });

  it("a scorecard submitted before the scheduled time also clears it", async () => {
    early = (await schedule(candidates[2], [u.ivA], 24)).id;
    expect((await card("ivA"))[early]).toBe("upcoming");
    await saveScorecard(orgId, u.ivA, early, { ratings, notes: null, recommendation: "on_hold", submit: true });
    expect((await card("ivA"))[early]).toBeUndefined();
    expect((await card("recruiter"))[early]).toBe("ready_to_decide");
  });

  it("an interview that's over with no scorecards drops off for recruiters but not for the panel; cancelled ones go", async () => {
    await moveToPast(future, 2);
    expect((await card("owner"))[future]).toBeUndefined();
    expect((await card("ivA"))[future]).toBe("scorecard_needed");
    const cy = (await schedule(candidates[3], [u.ivA], 30)).id;
    await cancelHumanInterview(orgId, u.recruiter, cy, { reason: "Filled", sendEmail: false });
    expect((await card("ivA"))[cy]).toBeUndefined();
    expect((await card("owner"))[cy]).toBeUndefined();
  });
});
