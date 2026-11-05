import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { audit, notify } from "@/lib/audit";
import { can, type Role } from "@/lib/auth/permissions";
import { json, withOrg, type Tx } from "@/lib/database/db";
import { companyBrand, emailTemplates, failedRecipients, replyToUser, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { checkLocation, DECISION_LABEL, DECISIONS, formatInZone, LOCATION_LABEL, LOCATION_TYPES, MAX_CRITERIA, type Decision, type HumanStatus, type LocationType } from "@/lib/hiring";
import { buildIcs } from "@/lib/ics";
import { ensurePipeline } from "./pipeline";

// Human interviews: scheduled with a meeting link (Zoom, Meet, Teams…), a
// phone number or an address, run by team members who each fill a scorecard.
// No recording or transcript yet. Emails go through sendEmail, so they're
// stored in the outbox today and delivered once an email provider is set up.

const when = z.string().datetime({ offset: true, message: "Choose a date and time" });

export const ScheduleSchema = z.object({
  scheduledAt: when,
  durationMinutes: z.number().int().min(5).max(480),
  timezone: z.string().min(1).max(64),
  locationType: z.enum(LOCATION_TYPES),
  location: z.string().trim().max(500).nullable().optional(),
  interviewerIds: z.array(z.string().uuid()).min(1, "Choose at least one interviewer").max(8),
  message: z.string().trim().max(2000).nullable().optional(),
  sendEmail: z.boolean().default(true),
});

export const CreateHumanSchema = ScheduleSchema.extend({
  jobId: z.string().uuid(),
  candidateId: z.string().uuid(),
  /** One of the job's human rounds… */
  roundId: z.string().uuid().optional(),
  /** …or a one-off interview for this candidate only (the job's rounds don't change). */
  extra: z.object({
    name: z.string().trim().min(1, "Name the interview").max(80),
    criteria: z.array(z.string().trim().min(1).max(80)).min(1, "Add at least one skill to rate").max(MAX_CRITERIA),
    guide: z.string().trim().max(4000).nullable().optional(),
  }).optional(),
}).refine((v) => !!v.roundId !== !!v.extra, { message: "Choose a round or describe the extra interview", path: ["roundId"] });

export const ScorecardSchema = z.object({
  ratings: z.array(z.object({ criterion: z.string().min(1).max(80), rating: z.number().int().min(1).max(5).nullable(), comment: z.string().trim().max(1000).nullable().optional() })).max(20),
  notes: z.string().trim().max(5000).nullable().optional(),
  recommendation: z.enum(DECISIONS).nullable().optional(),
  submit: z.boolean().default(false),
});

type HistoryItem = {
  type: "scheduled" | "rescheduled" | "cancelled" | "completed" | "no_show" | "reopened" | "decided" | "decision_cleared" | "scorecard_edited";
  at: string; by: string; from?: string; to?: string; reason?: string;
  decision?: Decision | null; detail?: string; afterDecision?: boolean;
};
export type ScorecardVersion = { ratings: { criterion: string; rating: number | null; comment?: string | null }[]; notes: string | null; recommendation: Decision | null; submitted_at: string | null; replaced_at: string };

export type HumanInterview = {
  id: string; job_id: string; job_title: string; candidate_id: string; candidate_name: string; candidate_email: string; company_name: string;
  round_id: string | null; round_name: string; attempt: number; status: HumanStatus; scheduled_at: Date; duration_minutes: number; timezone: string;
  location_type: LocationType; location: string | null; message: string | null; criteria: string[]; guide: string | null;
  sequence: number; history: HistoryItem[]; cancel_reason: string | null;
  decision: Decision | null; decision_note: string | null; decided_at: Date | null; decided_by_name: string | null;
  created_at: Date; created_by_name: string | null;
  panel: { user_id: string; name: string; email: string }[];
  scorecards: {
    user_id: string; name: string; ratings: { criterion: string; rating: number | null; comment?: string | null }[]; notes: string | null; recommendation: Decision | null;
    submitted_at: Date | null; updated_at: Date; versions: ScorecardVersion[]; edited_after_decision: boolean;
  }[];
};

async function loadPanel(tx: Tx, orgId: string, ids: string[]) {
  const members = await tx<{ user_id: string; name: string; email: string; role: Role }[]>`
    select m.user_id, u.name, u.email, m.role from organization_members m join users u on u.id = m.user_id
    where m.organization_id = ${orgId} and m.user_id = any(${ids}) and u.disabled_at is null`;
  if (members.length !== new Set(ids).size) throw new ApiError(400, "An interviewer is no longer in your team.");
  const viewers = members.filter((m) => m.role === "viewer");
  if (viewers.length) throw new ApiError(400, `${viewers.map((v) => v.name).join(", ")} ${viewers.length === 1 ? "has" : "have"} view-only access and can't fill in a scorecard. Change their role in Settings → Team first.`);
  return members;
}

async function load(tx: Tx, orgId: string, id: string): Promise<HumanInterview | null> {
  const [h] = await tx<Omit<HumanInterview, "panel" | "scorecards">[]>`
    select h.id, h.job_id, j.title as job_title, h.candidate_id, c.name as candidate_name, c.email as candidate_email, o.name as company_name,
      h.round_id, h.round_name, h.attempt, h.status, h.scheduled_at, h.duration_minutes, h.timezone, h.location_type, h.location, h.message,
      h.criteria, h.guide, h.sequence, h.history, h.cancel_reason, h.decision, h.decision_note, h.decided_at, d.name as decided_by_name,
      h.created_at, cb.name as created_by_name
    from human_interviews h
    join jobs j on j.id = h.job_id join candidates c on c.id = h.candidate_id join organizations o on o.id = h.organization_id
    left join users d on d.id = h.decided_by left join users cb on cb.id = h.created_by
    where h.id = ${id} and h.organization_id = ${orgId}`;
  if (!h) return null;
  const panel = await tx<HumanInterview["panel"]>`
    select p.user_id, u.name, u.email from human_interview_panel p join users u on u.id = p.user_id where p.human_interview_id = ${id} order by u.name`;
  const scorecards = await tx<HumanInterview["scorecards"]>`
    select s.user_id, u.name, s.ratings, s.notes, s.recommendation, s.submitted_at, s.updated_at, s.versions, s.edited_after_decision
    from human_interview_scorecards s join users u on u.id = s.user_id where s.human_interview_id = ${id} order by s.submitted_at nulls last, u.name`;
  return { ...h, panel, scorecards };
}

/** Interviewers only see human interviews they're on the panel of. */
export async function getHumanInterview(orgId: string, id: string, viewer: { userId: string; role: Role }) {
  const h = await withOrg(orgId, (tx) => load(tx, orgId, id));
  if (!h) return null;
  if (viewer.role === "interviewer" && !h.panel.some((p) => p.user_id === viewer.userId)) return null;
  return h;
}

function interviewLink(id: string) {
  return `${env().APP_URL}/interviews/human/${id}`;
}

function where(h: Pick<HumanInterview, "location_type" | "location">) {
  return `${LOCATION_LABEL[h.location_type]}${h.location ? `: ${h.location}` : ""}`;
}

export function inviteMessage(h: HumanInterview) {
  return `Hi ${h.candidate_name.split(" ")[0]},

Thank you for your interest in the ${h.job_title} role at ${h.company_name}. We'd like to invite you to the ${h.round_name} interview.

When: ${formatInZone(h.scheduled_at, h.timezone, { withYear: true })} (${h.duration_minutes} minutes)
Where: ${where(h)}
With: ${h.panel.map((p) => p.name).join(", ")}
${h.message ? `\n${h.message}\n` : ""}
Please let us know if this time doesn't work for you.

${h.company_name}`;
}

export function calendarFile(h: HumanInterview, audience: "candidate" | "team") {
  return buildIcs({
    uid: `${h.id}@pickmyhire.ai`,
    sequence: h.sequence,
    method: h.status === "cancelled" ? "CANCEL" : "REQUEST",
    start: h.scheduled_at,
    minutes: h.duration_minutes,
    title: audience === "candidate" ? `${h.round_name} interview: ${h.job_title} at ${h.company_name}` : `${h.round_name} interview: ${h.candidate_name} (${h.job_title})`,
    description: audience === "candidate" ? inviteMessage(h) : `Interview guide, criteria and scorecard: ${interviewLink(h.id)}`,
    location: h.location ?? LOCATION_LABEL[h.location_type],
  });
}

/** Email the candidate and the panel, with a calendar file attached; replies go to whoever scheduled it. */
async function emailEveryone(h: HumanInterview, kind: "invite" | "rescheduled" | "cancelled", orgId: string, userId: string, reason?: string | null) {
  const replyTo = await replyToUser(userId);
  const brand = await companyBrand(orgId);
  const ics = (audience: "candidate" | "team") => [{
    filename: "invite.ics", content: calendarFile(h, audience),
    contentType: `text/calendar; charset=utf-8; method=${h.status === "cancelled" ? "CANCEL" : "REQUEST"}`,
  }];
  const whenText = `${formatInZone(h.scheduled_at, h.timezone, { withYear: true })} (${h.duration_minutes} minutes)`;
  const base = { jobTitle: h.job_title, companyName: h.company_name, roundName: h.round_name, when: whenText, where: where(h), reason: reason ?? null };
  const toCandidate = emailTemplates.humanInterview({ ...base, kind, name: h.candidate_name.split(" ")[0], message: h.message, with: h.panel.map((p) => p.name).join(", ") });
  const results = [await sendEmail({ to: h.candidate_email, ...toCandidate, orgId, replyTo, brand, attachments: ics("candidate") })];
  for (const p of h.panel) {
    const t = emailTemplates.humanInterview({ ...base, kind, name: p.name.split(" ")[0], message: null, with: h.candidate_name, link: interviewLink(h.id), team: true });
    results.push(await sendEmail({ to: p.email, ...t, orgId, replyTo, brand, attachments: ics("team") }));
  }
  return failedRecipients(results);
}

/** The meeting link, phone number or address the interview type needs (400 when missing or invalid). */
function requireLocation(type: LocationType, location: string | null | undefined) {
  const r = checkLocation(type, location);
  if (r.error !== undefined) throw new ApiError(400, r.error, "location_required");
  return r.value;
}

/** Schedule a human interview for a job's human round. */
export async function scheduleHumanInterview(orgId: string, userId: string, input: z.infer<typeof CreateHumanSchema>) {
  const location = requireLocation(input.locationType, input.location);
  const id = await withOrg(orgId, async (tx) => {
    const [job] = await tx<{ id: string; title: string; status: string }[]>`select id, title, status from jobs where id = ${input.jobId} and organization_id = ${orgId}`;
    if (!job) throw new ApiError(404, "Job not found");
    if (job.status === "closed") throw new ApiError(409, "This job is closed.");
    const [cand] = await tx<{ id: string; name: string }[]>`select id, name from candidates where id = ${input.candidateId} and organization_id = ${orgId}`;
    if (!cand) throw new ApiError(404, "Candidate not found");
    let round: { id: string | null; name: string; criteria: string[]; guide: string | null };
    if (input.roundId) {
      const [r] = await tx<{ id: string; name: string; kind: string; criteria: string[]; guide: string | null }[]>`
        select id, name, kind, criteria, guide from job_rounds where id = ${input.roundId} and job_id = ${job.id}`;
      if (!r) throw new ApiError(404, "Interview round not found");
      if (r.kind !== "human") throw new ApiError(400, `${r.name} is an AI interview round. Send an AI interview invite instead.`);
      round = r;
    } else {
      const e = input.extra!;
      round = { id: null, name: e.name, criteria: Array.from(new Set(e.criteria)), guide: e.guide || null };
    }
    // Earlier interviews in the same round (or extra interviews with the same name) for attempt numbering.
    const existing = await tx<{ status: string }[]>`
      select status from human_interviews where candidate_id = ${cand.id} and job_id = ${job.id}
        and ${round.id ? tx`round_id = ${round.id}` : tx`round_id is null and lower(round_name) = lower(${round.name})`}`;
    if (existing.some((e) => e.status === "scheduled")) throw new ApiError(409, `${cand.name} already has a ${round.name} interview scheduled. Reschedule it instead.`, "already_scheduled");
    await loadPanel(tx, orgId, input.interviewerIds);
    const attempt = 1 + existing.filter((e) => e.status !== "cancelled").length;
    const history: HistoryItem[] = [{ type: "scheduled", at: new Date().toISOString(), by: userId, to: input.scheduledAt }];
    const [row] = await tx<{ id: string }[]>`
      insert into human_interviews (organization_id, job_id, candidate_id, round_id, round_name, criteria, guide, attempt, scheduled_at, duration_minutes,
        timezone, location_type, location, message, history, created_by)
      values (${orgId}, ${job.id}, ${cand.id}, ${round.id}, ${round.name}, ${json(round.criteria)}, ${round.guide}, ${attempt}, ${input.scheduledAt},
        ${input.durationMinutes}, ${input.timezone}, ${input.locationType}, ${location}, ${input.message || null}, ${json(history)}, ${userId})
      returning id`;
    for (const uid of new Set(input.interviewerIds)) {
      await tx`insert into human_interview_panel (human_interview_id, user_id, organization_id) values (${row.id}, ${uid}, ${orgId})`;
      await notify(tx, { orgId, userId: uid, type: "human_interview.assigned", payload: { human_interview_id: row.id, candidate: cand.name, job: job.title, round: round.name, at: input.scheduledAt, tz: input.timezone } });
    }
    await ensurePipeline(tx, orgId, job.id, cand.id);
    await audit(tx, { orgId, userId, action: "human_interview.scheduled", entityType: "human_interview", entityId: row.id, metadata: { job_id: job.id, candidate_id: cand.id, round: round.name, at: input.scheduledAt } });
    return row.id;
  });
  const h = (await withOrg(orgId, (tx) => load(tx, orgId, id)))!;
  const emailFailed = input.sendEmail ? await emailEveryone(h, "invite", orgId, userId) : [];
  return { id, emailFailed };
}

async function change(orgId: string, userId: string, id: string, fn: (tx: Tx, h: HumanInterview) => Promise<void>) {
  await withOrg(orgId, async (tx) => {
    await tx`select id from human_interviews where id = ${id} and organization_id = ${orgId} for update`;
    const h = await load(tx, orgId, id);
    if (!h) throw new ApiError(404, "Interview not found");
    await fn(tx, h);
  });
  return (await withOrg(orgId, (tx) => load(tx, orgId, id)))!;
}

const push = (tx: Tx, id: string, item: HistoryItem) => tx`update human_interviews set history = history || ${json([item])} where id = ${id}`;

export async function rescheduleHumanInterview(orgId: string, userId: string, id: string, input: z.infer<typeof ScheduleSchema> & { reason?: string | null }) {
  const location = requireLocation(input.locationType, input.location);
  const h = await change(orgId, userId, id, async (tx, h) => {
    if (h.status !== "scheduled") throw new ApiError(409, "Only scheduled interviews can be rescheduled.");
    await loadPanel(tx, orgId, input.interviewerIds);
    await tx`update human_interviews set scheduled_at = ${input.scheduledAt}, duration_minutes = ${input.durationMinutes}, timezone = ${input.timezone},
      location_type = ${input.locationType}, location = ${location}, message = ${input.message || null}, sequence = sequence + 1 where id = ${id}`;
    const before = new Set(h.panel.map((p) => p.user_id));
    await tx`delete from human_interview_panel where human_interview_id = ${id} and user_id <> all(${input.interviewerIds})`;
    for (const uid of new Set(input.interviewerIds)) {
      await tx`insert into human_interview_panel (human_interview_id, user_id, organization_id) values (${id}, ${uid}, ${orgId}) on conflict do nothing`;
      if (!before.has(uid)) await notify(tx, { orgId, userId: uid, type: "human_interview.assigned", payload: { human_interview_id: id, candidate: h.candidate_name, job: h.job_title, round: h.round_name, at: input.scheduledAt, tz: input.timezone } });
    }
    await push(tx, id, { type: "rescheduled", at: new Date().toISOString(), by: userId, from: h.scheduled_at.toISOString(), to: input.scheduledAt, ...(input.reason ? { reason: input.reason.slice(0, 300) } : {}) });
    await audit(tx, { orgId, userId, action: "human_interview.rescheduled", entityType: "human_interview", entityId: id, metadata: { from: h.scheduled_at, to: input.scheduledAt } });
  });
  return { emailFailed: input.sendEmail ? await emailEveryone(h, "rescheduled", orgId, userId, input.reason) : [] };
}

export async function cancelHumanInterview(orgId: string, userId: string, id: string, input: { reason: string; sendEmail: boolean }) {
  const h = await change(orgId, userId, id, async (tx, h) => {
    if (h.status !== "scheduled") throw new ApiError(409, "Only scheduled interviews can be cancelled.");
    await tx`update human_interviews set status = 'cancelled', cancel_reason = ${input.reason}, sequence = sequence + 1 where id = ${id}`;
    await push(tx, id, { type: "cancelled", at: new Date().toISOString(), by: userId, reason: input.reason.slice(0, 300) });
    await audit(tx, { orgId, userId, action: "human_interview.cancelled", entityType: "human_interview", entityId: id, metadata: { reason: input.reason.slice(0, 300) } });
  });
  return { emailFailed: input.sendEmail ? await emailEveryone(h, "cancelled", orgId, userId, input.reason) : [] };
}

/** Record what happened: completed, no-show, or back to scheduled (undo). */
export async function setHumanOutcome(orgId: string, userId: string, id: string, status: "completed" | "no_show" | "scheduled") {
  await change(orgId, userId, id, async (tx, h) => {
    if (h.status === "cancelled") throw new ApiError(409, "This interview was cancelled.");
    if (h.status === status) return;
    await tx`update human_interviews set status = ${status} where id = ${id}`;
    await push(tx, id, { type: status === "scheduled" ? "reopened" : status, at: new Date().toISOString(), by: userId });
    await audit(tx, { orgId, userId, action: `human_interview.${status === "scheduled" ? "reopened" : status}`, entityType: "human_interview", entityId: id });
  });
}

/** Save (or submit) the signed-in interviewer's scorecard. */
export async function saveScorecard(orgId: string, userId: string, id: string, input: z.infer<typeof ScorecardSchema>) {
  await change(orgId, userId, id, async (tx, h) => {
    if (!h.panel.some((p) => p.user_id === userId)) throw new ApiError(403, "Only interviewers on this interview's panel can fill in a scorecard.");
    if (h.status === "cancelled") throw new ApiError(409, "This interview was cancelled.");
    // Once the team has decided the round, scorecards are locked so they always match the decision.
    if (h.decision) throw new ApiError(409, "Scorecards are locked because the round decision has been made. Ask a recruiter to clear the decision if you need to change yours.", "scorecard_locked");
    const ratings = h.criteria.map((criterion) => {
      const r = input.ratings.find((x) => x.criterion === criterion);
      return { criterion, rating: r?.rating ?? null, comment: r?.comment || null };
    });
    if (input.submit) {
      if (ratings.some((r) => r.rating === null)) throw new ApiError(400, "Rate every skill before submitting.");
      if (!input.recommendation) throw new ApiError(400, "Choose your recommendation before submitting.");
    }
    const [prev] = await tx<{ ratings: ScorecardVersion["ratings"]; notes: string | null; recommendation: Decision | null; submitted_at: Date | null }[]>`
      select ratings, notes, recommendation, submitted_at from human_interview_scorecards where human_interview_id = ${id} and user_id = ${userId}`;
    const notes = input.notes || null;
    const recommendation = input.recommendation ?? null;
    const changed = !!prev?.submitted_at && (JSON.stringify(prev.ratings) !== JSON.stringify(ratings) || prev.notes !== notes || prev.recommendation !== recommendation);
    // An edit to a submitted scorecard keeps the earlier version; editing after a decision was reopened is flagged for the team.
    const reopened = changed && h.history.some((e) => e.type === "decision_cleared" && new Date(e.at) > prev!.submitted_at!);
    const version: ScorecardVersion | null = changed ? { ratings: prev!.ratings, notes: prev!.notes, recommendation: prev!.recommendation, submitted_at: prev!.submitted_at!.toISOString(), replaced_at: new Date().toISOString() } : null;
    await tx`
      insert into human_interview_scorecards (organization_id, human_interview_id, user_id, ratings, notes, recommendation, submitted_at, updated_at)
      values (${orgId}, ${id}, ${userId}, ${json(ratings)}, ${notes}, ${recommendation}, ${input.submit ? new Date() : null}, now())
      on conflict (human_interview_id, user_id) do update set ratings = excluded.ratings, notes = excluded.notes, recommendation = excluded.recommendation,
        submitted_at = coalesce(excluded.submitted_at, human_interview_scorecards.submitted_at), updated_at = now(),
        versions = human_interview_scorecards.versions || ${json(version ? [version] : [])},
        edited_after_decision = human_interview_scorecards.edited_after_decision or ${reopened}`;
    if (version) {
      const label = (d: Decision | null) => (d ? DECISION_LABEL[d] : "none");
      const detail = prev!.recommendation !== recommendation ? `recommendation ${label(prev!.recommendation)} → ${label(recommendation)}` : "ratings or notes changed";
      await push(tx, id, { type: "scorecard_edited", at: new Date().toISOString(), by: userId, detail, afterDecision: reopened });
      await audit(tx, { orgId, userId, action: "human_interview.scorecard_updated", entityType: "human_interview", entityId: id, metadata: { from: prev!.recommendation, to: recommendation, after_decision_reopened: reopened } });
    }
    if (input.submit && !prev?.submitted_at) {
      // Submitting a scorecard means the interview took place.
      if (h.status === "scheduled") {
        await tx`update human_interviews set status = 'completed' where id = ${id}`;
        await push(tx, id, { type: "completed", at: new Date().toISOString(), by: userId });
      }
      const [me] = await tx<{ name: string }[]>`select name from users where id = ${userId}`;
      await notify(tx, { orgId, type: "human_interview.scorecard", payload: { human_interview_id: id, candidate: h.candidate_name, job: h.job_title, round: h.round_name, interviewer: me?.name ?? "", recommendation: input.recommendation ?? "" } });
      await audit(tx, { orgId, userId, action: "human_interview.scorecard_submitted", entityType: "human_interview", entityId: id, metadata: { recommendation: input.recommendation } });
    }
  });
}

/** Why a human interview is on someone's dashboard. */
export type HumanCardKind = "scorecard_needed" | "ready_to_decide" | "upcoming";

export type HumanListRow = {
  id: string; job_id: string; job_title: string; candidate_id: string; candidate_name: string; round_name: string; status: HumanStatus;
  scheduled_at: Date; duration_minutes: number; timezone: string; location_type: LocationType; location: string | null;
  on_panel: boolean; my_scorecard_submitted: boolean;
  /** The interview's end time has passed. */
  is_past: boolean;
  /** Panel members, and how many of them have submitted a scorecard. */
  panel_size: number; submitted: number;
  kind: HumanCardKind;
};

/**
 * The dashboard's human-interview card: only what still needs this person.
 * - scorecard_needed: they're on the panel, the interview is over (or marked completed) and their scorecard isn't in.
 * - ready_to_decide: everyone on the panel has submitted and no round decision is made yet (people who can decide).
 * - upcoming: scheduled and not over yet (interviewers: only their own).
 * Something drops off once it's done: scorecard submitted, decision made, interview over, cancelled or a no-show.
 */
export async function listMyHumanInterviews(orgId: string, viewer: { userId: string; role: Role }) {
  const onlyMine = viewer.role === "interviewer";
  const canDecide = can(viewer.role, "decision:write");
  return withOrg(orgId, (tx) => tx<HumanListRow[]>`
    select * from (
      select b.*,
        case
          when b.on_panel and not b.my_scorecard_submitted and (b.status = 'completed' or b.is_past) then 'scorecard_needed'
          when ${canDecide} and b.status = 'completed' and b.panel_size > 0 and b.submitted >= b.panel_size then 'ready_to_decide'
          when b.status = 'scheduled' and not b.is_past and (b.on_panel or not ${onlyMine}) then 'upcoming'
        end as kind
      from (
        select h.id, h.job_id, j.title as job_title, h.candidate_id, c.name as candidate_name, h.round_name, h.status, h.scheduled_at,
          h.duration_minutes, h.timezone, h.location_type, h.location,
          (h.scheduled_at + make_interval(mins => h.duration_minutes)) < now() as is_past,
          exists (select 1 from human_interview_panel p where p.human_interview_id = h.id and p.user_id = ${viewer.userId}) as on_panel,
          exists (select 1 from human_interview_scorecards s where s.human_interview_id = h.id and s.user_id = ${viewer.userId} and s.submitted_at is not null) as my_scorecard_submitted,
          (select count(*)::int from human_interview_panel p where p.human_interview_id = h.id) as panel_size,
          (select count(*)::int from human_interview_scorecards s join human_interview_panel p on p.human_interview_id = s.human_interview_id and p.user_id = s.user_id
            where s.human_interview_id = h.id and s.submitted_at is not null) as submitted
        from human_interviews h join jobs j on j.id = h.job_id join candidates c on c.id = h.candidate_id
        where h.organization_id = ${orgId} and h.status in ('scheduled', 'completed') and h.decision is null
      ) b
    ) r
    where r.kind is not null
    -- Things to act on first (oldest first), then what's coming up (soonest first).
    order by case r.kind when 'upcoming' then 1 else 0 end, r.scheduled_at
    limit 20`);
}

/** Team members who can be on an interview panel (everyone except view-only). */
export async function listPanelCandidates(orgId: string) {
  return withOrg(orgId, (tx) => tx<{ user_id: string; name: string; email: string; role: Role }[]>`
    select m.user_id, u.name, u.email, m.role from organization_members m join users u on u.id = m.user_id
    where m.organization_id = ${orgId} and m.role <> 'viewer' and u.disabled_at is null order by u.name`);
}

export const HUMAN_PAGE_SIZE = 25;
export type HumanTableRow = {
  id: string; job_id: string; job_title: string; candidate_id: string; candidate_name: string; candidate_email: string; round_name: string; attempt: number;
  status: HumanStatus; scheduled_at: Date; timezone: string; interviewers: string; decision: Decision | null; scorecards: number; panel_size: number;
};

/** All human interviews, newest first; interviewers see only those they're on. */
export async function listHumanInterviews(orgId: string, viewer: { userId: string; role: Role }, opts: { q?: string; jobId?: string; status?: string; page?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
  const status = opts.status && ["scheduled", "completed", "cancelled", "no_show"].includes(opts.status) ? opts.status : null;
  return withOrg(orgId, async (tx) => {
    const where = tx`
      h.organization_id = ${orgId}
      ${opts.jobId ? tx`and h.job_id = ${opts.jobId}` : tx``}
      ${status ? tx`and h.status = ${status}` : tx``}
      ${q ? tx`and (c.name ilike ${q} or c.email::text ilike ${q} or j.title ilike ${q})` : tx``}
      ${viewer.role === "interviewer" ? tx`and exists (select 1 from human_interview_panel p where p.human_interview_id = h.id and p.user_id = ${viewer.userId})` : tx``}`;
    const [{ total }] = await tx<{ total: number }[]>`select count(*)::int as total from human_interviews h join candidates c on c.id = h.candidate_id join jobs j on j.id = h.job_id where ${where}`;
    const rows = await tx<HumanTableRow[]>`
      select h.id, h.job_id, j.title as job_title, h.candidate_id, c.name as candidate_name, c.email as candidate_email, h.round_name, h.attempt,
        h.status, h.scheduled_at, h.timezone, h.decision,
        coalesce((select string_agg(u.name, ', ' order by u.name) from human_interview_panel p join users u on u.id = p.user_id where p.human_interview_id = h.id), '') as interviewers,
        (select count(*)::int from human_interview_panel p where p.human_interview_id = h.id) as panel_size,
        (select count(*)::int from human_interview_scorecards s where s.human_interview_id = h.id and s.submitted_at is not null) as scorecards
      from human_interviews h join candidates c on c.id = h.candidate_id join jobs j on j.id = h.job_id
      where ${where}
      order by h.scheduled_at desc
      limit ${HUMAN_PAGE_SIZE} offset ${(page - 1) * HUMAN_PAGE_SIZE}`;
    return { rows, total, pageSize: HUMAN_PAGE_SIZE };
  });
}
