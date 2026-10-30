import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, withSystem } from "@/lib/database/db";
import { generateToken, hashToken } from "@/lib/security/tokens";
import { closeIfAbandoned, getPublicInterview, LINK_USED_MESSAGE, startInterview } from "@/lib/interview/controller";
import { initialInterviewState } from "@/types/interview";

// A started interview can be reopened within 10 minutes of the candidate's last
// activity; after that it closes with the answers given so far and the link stops working.
const id = Date.now().toString(36);
const min = 60_000;
let orgId = "";
let jobId = "";
let n = 0;

async function interview(opts: { status: string; startedAgoMin?: number; lastActivityAgoMin?: number; endedReason?: "left" }) {
  n += 1;
  const token = generateToken();
  const started = opts.startedAgoMin != null ? new Date(Date.now() - opts.startedAgoMin * min) : null;
  const state = {
    ...initialInterviewState(),
    phase: started ? "in_progress" : "not_started",
    last_activity_at: opts.lastActivityAgoMin != null ? new Date(Date.now() - opts.lastActivityAgoMin * min).toISOString() : null,
    ...(opts.endedReason ? { ended_reason: opts.endedReason } : {}),
  };
  const ivId = await withSystem(async (tx) => {
    const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${orgId}, ${`Cand ${n}`}, ${`c${n}-${id}@reentry.test`}) returning id`;
    const [iv] = await tx<{ id: string }[]>`
      insert into interviews (organization_id, job_id, candidate_id, secure_token_hash, status, consent_given, started_at, state, token_expires_at)
      values (${orgId}, ${jobId}, ${c.id}, ${hashToken(token)}, ${opts.status}::interview_status, true, ${started}, ${json(state)}, ${new Date(Date.now() + 7 * 24 * 60 * min)})
      returning id`;
    await tx`insert into interview_sections (organization_id, interview_id, name, objective, sort_order, status, start_ms)
      values (${orgId}, ${iv.id}, 'Introduction', 'Background', 0, ${started ? "in_progress" : "pending"}, ${started ? 0 : null}),
             (${orgId}, ${iv.id}, 'Experience', 'Experience', 1, 'pending', null)`;
    return iv.id;
  });
  return { token, ivId };
}

const row = (ivId: string) => withSystem(async (tx) => {
  const [iv] = await tx<{ status: string; duration_seconds: number | null; ended: string | null }[]>`
    select status, duration_seconds, state->>'ended_reason' as ended from interviews where id = ${ivId}`;
  const sections = await tx<{ status: string }[]>`select status from interview_sections where interview_id = ${ivId} order by sort_order`;
  const [audit] = await tx<{ reason: string | null }[]>`select metadata->>'reason' as reason from audit_logs where entity_id = ${ivId} and action = 'interview.completed'`;
  return { ...iv, sections: sections.map((s) => s.status), reason: audit?.reason ?? null };
});

beforeAll(async () => {
  const [o] = await withSystem((tx) => tx<{ id: string }[]>`insert into organizations (name, slug) values (${`Reentry Co ${id}`}, ${`reentry-co-${id}`}) returning id`);
  orgId = o.id;
  const [j] = await withSystem((tx) => tx<{ id: string }[]>`insert into jobs (organization_id, title, status) values (${orgId}, 'Reentry job', 'active') returning id`);
  jobId = j.id;
});

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 1500)); // let background report processing settle
  await withSystem((tx) => tx`delete from organizations where id = ${orgId}`);
});

describe("reopening a started interview", () => {
  it("lets the candidate continue within 10 minutes of leaving", async () => {
    const { token, ivId } = await interview({ status: "in_progress", startedAgoMin: 12, lastActivityAgoMin: 4 });
    expect((await getPublicInterview(token)).status).toBe("in_progress");
    expect((await row(ivId)).status).toBe("in_progress");
  });

  it("closes the interview and the link after 10 minutes away (Khushi's case)", async () => {
    const { token, ivId } = await interview({ status: "in_progress", startedAgoMin: 19 * 60, lastActivityAgoMin: 19 * 60 - 1 });
    await expect(getPublicInterview(token)).rejects.toThrow(LINK_USED_MESSAGE);
    const r = await row(ivId);
    expect(["completed", "processing", "report_ready", "failed"]).toContain(r.status);
    expect(r.ended).toBe("left");
    expect(r.reason).toBe("left_unfinished");
    expect(r.duration_seconds).toBe(60); // up to the last activity, not 19 hours
    expect(r.sections).toEqual(["completed", "skipped"]);
    // Still refused on every later try, including the start call.
    await expect(getPublicInterview(token)).rejects.toThrow(LINK_USED_MESSAGE);
    await expect(startInterview(token)).rejects.toThrow(LINK_USED_MESSAGE);
  });

  it("closes it when the recruiter views it, without waiting for the candidate", async () => {
    const { ivId } = await interview({ status: "in_progress", startedAgoMin: 40, lastActivityAgoMin: 25 });
    expect(await closeIfAbandoned(orgId, ivId)).toBe(true);
    expect((await row(ivId)).duration_seconds).toBe(15 * 60);
  });

  it("never touches interviews that haven't started or ended normally", async () => {
    const waiting = await interview({ status: "device_check" });
    expect((await getPublicInterview(waiting.token)).status).toBe("device_check");
    expect(await closeIfAbandoned(orgId, waiting.ivId)).toBe(false);

    const done = await interview({ status: "report_ready", startedAgoMin: 120, lastActivityAgoMin: 90 });
    expect((await getPublicInterview(done.token)).status).toBe("report_ready");
    expect(await closeIfAbandoned(orgId, done.ivId)).toBe(false);
  });
});
