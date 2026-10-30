import "server-only";
// InterviewController: the single authority over a live interview. Every
// candidate action goes through here; the LLM only supplies analysis and
// suggested wording, which is validated by the state machine.

import { json, withOrg, withSystem, type Tx } from "@/lib/database/db";
import { audit, notify } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { analyzeAnswer } from "@/lib/ai/answer-analyzer";
import { getBrand } from "@/lib/services/branding";
import { buildTranscriptionPrompt } from "@/prompts/transcription/v1";
import { analyzeTurn } from "@/lib/ai/answer-turn";
import { mockAnalyzeAnswer } from "@/lib/ai/mock";
import { createRealtimeCredentials, type RealtimeCredentials } from "@/lib/ai/realtime-session";
import { runInBackground } from "@/lib/background";
import { aiIsLive, env } from "@/lib/env";
import { emailTemplates, sendEmail } from "@/lib/email";
import { log } from "@/lib/logger";
import { hashToken, isWellFormedToken } from "@/lib/security/tokens";
import type { AnswerAnalysis, FollowupDecision } from "@/lib/validation/ai-schemas";
import { readSettings } from "@/lib/services/org-settings";
import {
  InterviewStateSchema,
  initialInterviewState,
  StoredPlanSchema,
  type CandidateProgress,
  type InterviewState,
  type InterviewStatus,
  type PendingUtterance,
  type StoredPlan,
} from "@/types/interview";
import { advanceState, canTransition, computeAllowed, resolveNextStep, sanitizeSpoken, stripThanks, totalPlannedMs } from "./state-machine";
import { processInterview } from "./processing";
import { hasFaceReference } from "./face";
import { REENTRY_WINDOW_MS } from "./outcome";
import { MAX_REPEATS, type RequestKind } from "./repeat";
import { rephraseQuestion } from "@/lib/ai/question-rephrase";

export const CONSENT_VERSION = "2026-09-v1";
/** Consent text that also covers the identity (face) check. */
export const FACE_CONSENT_VERSION = "2026-10-face-v1";

type InterviewCtx = {
  id: string;
  orgId: string;
  status: InterviewStatus;
  planStatus: string;
  plan: StoredPlan | null;
  state: InterviewState;
  startedAt: Date | null;
  consentGiven: boolean;
  tokenExpiresAt: Date | null;
  candidateName: string;
  jobTitle: string;
  companyName: string;
  interviewerName: string;
  /** Whether this interview checks the candidate's face against a reference selfie. */
  faceVerification: boolean;
};

const ACTIVE: InterviewStatus[] = ["in_progress", "completing"];
const FINISHED: InterviewStatus[] = ["completed", "processing", "report_ready"];

/** Resolve a public token (hash lookup in system context) to its interview. */
export async function resolveToken(token: string): Promise<InterviewCtx> {
  if (!isWellFormedToken(token)) throw new ApiError(404, "This interview link is invalid.");
  const [row] = await withSystem((tx) => tx<{
    id: string; organization_id: string; status: InterviewStatus; plan_status: string; interview_plan: unknown; state: unknown;
    started_at: Date | null; consent_given: boolean; token_expires_at: Date | null; candidate_name: string; job_title: string;
    org_name: string; settings: unknown; org_status: string; face_verification: boolean; consent_version: string | null;
  }[]>`
    select i.id, i.organization_id, i.status, i.plan_status, i.interview_plan, i.state, i.started_at, i.consent_given, i.consent_version, i.token_expires_at,
      c.name as candidate_name, j.title as job_title, o.name as org_name, o.settings, o.status as org_status,
      case when i.started_at is null then j.face_verification else i.face_verification end as face_verification
    from interviews i join candidates c on c.id = i.candidate_id join jobs j on j.id = i.job_id join organizations o on o.id = i.organization_id
    where i.secure_token_hash = ${hashToken(token)}`);
  if (!row) throw new ApiError(404, "This interview link is invalid or has been replaced by a newer link.");
  if (row.status === "cancelled") throw new ApiError(410, "This interview has been cancelled.");
  if (row.org_status !== "active") throw new ApiError(403, "This interview isn't available right now. Please contact the recruiter.");
  const notStarted = !ACTIVE.includes(row.status) && !FINISHED.includes(row.status);
  if (notStarted && row.token_expires_at && row.token_expires_at.getTime() < Date.now()) {
    throw new ApiError(410, "This interview link has expired. Please contact the recruiter for a new link.");
  }
  const plan = row.interview_plan ? StoredPlanSchema.safeParse(row.interview_plan) : null;
  const state = InterviewStateSchema.safeParse(row.state);
  return {
    id: row.id,
    orgId: row.organization_id,
    status: row.status,
    planStatus: row.plan_status,
    plan: plan?.success ? plan.data : null,
    state: state.success ? state.data : initialInterviewState(),
    startedAt: row.started_at,
    // Identity check needs consent to the text that describes it.
    consentGiven: row.consent_given && (!row.face_verification || row.consent_version === FACE_CONSENT_VERSION),
    tokenExpiresAt: row.token_expires_at,
    candidateName: row.candidate_name,
    jobTitle: row.job_title,
    companyName: row.org_name,
    interviewerName: readSettings(row.settings).interviewer_name,
    faceVerification: row.face_verification,
  };
}

function progressOf(ctx: { plan: StoredPlan | null; state: InterviewState }): CandidateProgress | null {
  if (!ctx.plan) return null;
  const idx = Math.min(ctx.state.section_index, ctx.plan.sections.length - 1);
  return {
    section_index: idx,
    section_count: ctx.plan.sections.length,
    section_name: ctx.plan.sections[idx].name,
    total_minutes: Math.round(totalPlannedMs(ctx.plan) / 60_000),
  };
}

export const LINK_USED_MESSAGE = "This interview link has already been used and can't be opened again. Please contact the recruiter if you need a new link.";

/** The latest time anything arrived from the candidate's browser during a started interview. */
async function lastSignalAt(tx: Tx, interviewId: string, state: InterviewState, startedAt: Date): Promise<Date> {
  const [{ last }] = await tx<{ last: Date | null }[]>`
    select greatest(
      (select max(created_at) from interview_events where interview_id = ${interviewId}),
      (select max(created_at) from transcript_segments where interview_id = ${interviewId}),
      (select max(c.created_at) from recording_chunks c join recordings r on r.id = c.recording_id where r.interview_id = ${interviewId}),
      (select max(created_at) from face_checks where interview_id = ${interviewId})
    ) as last`;
  const activity = state.last_activity_at ? new Date(state.last_activity_at) : null;
  return [last, activity, startedAt].filter((d): d is Date => !!d && !Number.isNaN(d.getTime())).sort((a, b) => b.getTime() - a.getTime())[0];
}

/**
 * A candidate who leaves a started interview can come back within 10 minutes
 * (a refresh, a dropped connection) and continue. After that the interview is
 * closed with the answers given so far, and the link no longer works.
 * Returns true when the interview is (now, or already) closed this way.
 * Interviews that haven't started, or ended normally, are never touched.
 */
export async function closeIfAbandoned(orgId: string, interviewId: string): Promise<boolean> {
  const closed = await withOrg(orgId, async (tx) => {
    const [iv] = await tx<{ status: InterviewStatus; state: unknown; started_at: Date | null }[]>`
      select status, state, started_at from interviews where id = ${interviewId} and organization_id = ${orgId} for update`;
    if (!iv) return null;
    const parsed = InterviewStateSchema.safeParse(iv.state);
    if (iv.status !== "in_progress" || !iv.started_at || !parsed.success) return parsed.success && parsed.data.ended_reason === "left" ? "already" : null;
    const state = parsed.data;
    const last = await lastSignalAt(tx, interviewId, state, iv.started_at);
    if (Date.now() - last.getTime() < REENTRY_WINDOW_MS) return null;
    const lastMs = Math.max(0, last.getTime() - iv.started_at.getTime());
    const duration = Math.round(lastMs / 1000);
    await tx`update interviews set status = 'completed', completed_at = ${last}, duration_seconds = ${duration} where id = ${interviewId}`;
    await tx`update interview_sections set status = 'completed', completed_at = ${last}, end_ms = ${lastMs} where interview_id = ${interviewId} and status = 'in_progress'`;
    await tx`update interview_sections set status = 'skipped' where interview_id = ${interviewId} and status = 'pending'`;
    await tx`update interviews set state = ${json({ ...state, phase: "finished", pending_utterance: null, ended_reason: "left" })} where id = ${interviewId}`;
    await audit(tx, { orgId, actorType: "system", action: "interview.completed", entityType: "interview", entityId: interviewId, metadata: { reason: "left_unfinished", duration, left_at: last.toISOString() } });
    const [info] = await tx<{ candidate: string; job: string }[]>`select c.name as candidate, j.title as job from interviews i
      join candidates c on c.id = i.candidate_id join jobs j on j.id = i.job_id where i.id = ${interviewId}`;
    await notify(tx, { orgId, type: "interview.completed", payload: { interview_id: interviewId, candidate: info.candidate, job: info.job, reason: "left_unfinished" } });
    return "now";
  });
  if (closed === "now") {
    log.info("interview.closed_after_leaving", { interviewId });
    runInBackground("interview.process", () => processInterview(orgId, interviewId));
  }
  return closed !== null;
}

/** Throws "link already used" if the candidate left this started interview more than 10 minutes ago. */
async function assertLinkUsable(ctx: InterviewCtx) {
  const left = ctx.state.ended_reason === "left" || (ctx.status === "in_progress" && await closeIfAbandoned(ctx.orgId, ctx.id));
  if (left) throw new ApiError(410, LINK_USED_MESSAGE);
}

/** Candidate-safe public view. Never includes plan questions, criteria or evaluations. */
export async function getPublicInterview(token: string) {
  const ctx = await resolveToken(token);
  await assertLinkUsable(ctx);
  return {
    status: ctx.status,
    candidate_first_name: ctx.candidateName.split(" ")[0],
    job_title: ctx.jobTitle,
    company_name: ctx.companyName,
    interviewer_name: ctx.interviewerName,
    consent_given: ctx.consentGiven,
    consent_version: ctx.faceVerification ? FACE_CONSENT_VERSION : CONSENT_VERSION,
    face_verification: ctx.faceVerification,
    plan_ready: ctx.planStatus === "completed" && !!ctx.plan,
    plan_failed: ctx.planStatus === "failed",
    total_minutes: ctx.plan ? Math.round(totalPlannedMs(ctx.plan) / 60_000) : null,
    section_names: ctx.plan?.sections.map((s) => s.name) ?? [],
    progress: progressOf(ctx),
    demo_mode: !aiIsLive(),
    brand: await getBrand(ctx.orgId),
  };
}

async function setStatus(tx: Tx, ctx: { id: string; status: InterviewStatus }, to: InterviewStatus) {
  if (!canTransition(ctx.status, to)) throw new ApiError(409, "This action isn't available right now.");
  await tx`update interviews set status = ${to} where id = ${ctx.id}`;
}

export async function giveConsent(token: string, input: { consent: boolean; version: string }) {
  if (!input.consent) throw new ApiError(400, "Consent is required to continue.");
  const ctx = await resolveToken(token);
  const expected = ctx.faceVerification ? FACE_CONSENT_VERSION : CONSENT_VERSION;
  if (input.version !== expected) throw new ApiError(409, "The consent text has been updated. Please reload the page.");
  if (ACTIVE.includes(ctx.status) || FINISHED.includes(ctx.status)) return { status: ctx.status };
  await withOrg(ctx.orgId, async (tx) => {
    await tx`update interviews set consent_given = true, consent_timestamp = now(), consent_version = ${expected} where id = ${ctx.id}`;
    if (["created", "invited", "consent_pending"].includes(ctx.status)) await setStatus(tx, ctx, "device_check");
    await audit(tx, { orgId: ctx.orgId, actorType: "candidate", action: "interview.consent_given", entityType: "interview", entityId: ctx.id, metadata: { version: expected } });
  });
  return { status: "device_check" as const };
}

export async function completeDeviceCheck(token: string, result: { camera: boolean; microphone: boolean; browser: string }) {
  const ctx = await resolveToken(token);
  if (!ctx.consentGiven) throw new ApiError(409, "Please give consent first.");
  if (!result.camera || !result.microphone) throw new ApiError(400, "A working camera and microphone are required.");
  if (ctx.faceVerification && !(await hasFaceReference(ctx))) throw new ApiError(400, "Please take your photo for the identity check first.");
  if (["device_check", "invited", "consent_pending", "created"].includes(ctx.status)) {
    await withOrg(ctx.orgId, async (tx) => {
      if (ctx.status !== "device_check") await setStatus(tx, ctx, "device_check");
      await tx`update interviews set status = 'ready' where id = ${ctx.id}`;
      await logEventTx(tx, ctx, `device-check-${Date.now()}`, "device_check_passed", { browser: result.browser.slice(0, 200) });
    });
  }
  return { status: "ready" as const };
}

function composeIntro(ctx: InterviewCtx, plan: StoredPlan, firstQuestion: string) {
  const minutes = Math.round(totalPlannedMs(plan) / 60_000);
  const first = ctx.candidateName.split(" ")[0];
  return `Hi ${first}, I'm ${ctx.interviewerName}, an AI interviewer for the ${ctx.jobTitle} role at ${ctx.companyName}. `
    + `This interview has ${plan.sections.length} parts and takes about ${minutes} minutes. I'll ask one question at a time. `
    + `Take your time, and when you've finished an answer, just pause or select "Done answering". `
    + `If you'd like me to repeat or rephrase a question at any time, just ask. `
    + `Let's begin with ${plan.sections[0].name.toLowerCase()}. ${firstQuestion}`;
}

function clockMs(startedAt: Date | null): number {
  return startedAt ? Math.max(0, Date.now() - startedAt.getTime()) : 0;
}

async function insertQuestion(tx: Tx, ctx: { id: string; orgId: string }, q: {
  sectionId: string; text: string; spoken: string; type: "planned" | "followup"; intent: string | null; criteria: string[];
  planKey: string | null; parentId: string | null; decision: unknown; askedAtMs: number;
}): Promise<string> {
  const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(sequence_number), 0) + 1 as next from interview_questions where interview_id = ${ctx.id}`;
  const [row] = await tx<{ id: string }[]>`
    insert into interview_questions (organization_id, interview_id, section_id, question_text, spoken_text, question_type, intent,
      evaluation_criteria, plan_question_key, sequence_number, parent_question_id, is_followup, decision, asked_at_ms)
    values (${ctx.orgId}, ${ctx.id}, ${q.sectionId}, ${q.text}, ${q.spoken}, ${q.type}, ${q.intent}, ${json(q.criteria)}, ${q.planKey},
      ${next}, ${q.parentId}, ${q.type === "followup"}, ${q.decision ? json(q.decision) : null}, ${q.askedAtMs})
    returning id`;
  await audit(tx, { orgId: ctx.orgId, actorType: "system", action: q.type === "followup" ? "interview.followup_generated" : "interview.question_asked", entityType: "interview_question", entityId: row.id });
  return row.id;
}

async function saveState(tx: Tx, id: string, state: InterviewState) {
  await tx`update interviews set state = ${json({ ...state, last_activity_at: new Date().toISOString() })},
    current_section_index = ${state.section_index}, current_question_index = ${state.question_index} where id = ${id}`;
}

export type SessionPayload = {
  status: InterviewStatus;
  utterance: PendingUtterance | null;
  progress: CandidateProgress | null;
  started_at: string | null;
  server_now: number;
  finished: boolean;
};

function payload(ctx: InterviewCtx, state: InterviewState, status: InterviewStatus, startedAt: Date | null): SessionPayload {
  return {
    status,
    utterance: state.pending_utterance,
    progress: progressOf({ plan: ctx.plan, state }),
    started_at: startedAt?.toISOString() ?? null,
    server_now: Date.now(),
    finished: state.phase === "finished",
  };
}

/** Start (or resume after refresh/reconnect) the live interview. Idempotent. */
export async function startInterview(token: string): Promise<SessionPayload & { resumed: boolean }> {
  const ctx = await resolveToken(token);
  await assertLinkUsable(ctx);
  if (FINISHED.includes(ctx.status)) return { ...payload(ctx, ctx.state, ctx.status, ctx.startedAt), finished: true, resumed: true };
  if (!ctx.consentGiven) throw new ApiError(409, "Please give consent first.");
  if (!ctx.plan) throw new ApiError(425, ctx.planStatus === "failed" ? "Your interview couldn't be prepared. Please contact the recruiter." : "Your interview is still being prepared. Please wait a moment.");
  const plan = ctx.plan;

  return withOrg(ctx.orgId, async (tx) => {
    // Row lock serializes concurrent starts (double clicks, two tabs).
    const [locked] = await tx<{ status: InterviewStatus; state: unknown; started_at: Date | null }[]>`
      select status, state, started_at from interviews where id = ${ctx.id} for update`;
    const status = locked.status;
    const current = InterviewStateSchema.safeParse(locked.state);
    if (ACTIVE.includes(status) && current.success && current.data.phase !== "not_started") {
      const state = current.data;
      if (state.pending_utterance && state.pending_utterance.kind !== "closing") {
        state.pending_utterance = { ...state.pending_utterance, text: `Welcome back. Let's pick up where we left off. ${stripIntro(state.pending_utterance.text)}` };
      }
      await logEventTx(tx, ctx, `resume-${Date.now()}`, "session_resumed", {});
      return { ...payload(ctx, state, status, locked.started_at), resumed: true };
    }
    if (!["ready", "device_check"].includes(status)) throw new ApiError(409, "Please complete the device check first.");

    const startedAt = new Date();
    await tx`update interviews set status = 'in_progress', started_at = ${startedAt} where id = ${ctx.id}`;
    const section = plan.sections[0];
    const q = section.questions[0];
    await tx`update interview_sections set status = 'in_progress', started_at = now(), start_ms = 0 where id = ${section.section_id}`;
    const spoken = composeIntro(ctx, plan, q.question);
    const questionId = await insertQuestion(tx, ctx, {
      sectionId: section.section_id, text: q.question, spoken, type: "planned", intent: q.intent, criteria: q.evaluation_criteria,
      planKey: q.key, parentId: null, decision: null, askedAtMs: 0,
    });
    const state: InterviewState = {
      ...initialInterviewState(),
      phase: "in_progress",
      section_started_ms: 0,
      current_question_id: questionId,
      current_planned_question_id: questionId,
      pending_utterance: { question_id: questionId, text: spoken, kind: "question" },
    };
    await saveState(tx, ctx.id, state);
    await audit(tx, { orgId: ctx.orgId, actorType: "candidate", action: "interview.started", entityType: "interview", entityId: ctx.id });
    log.info("interview.started", { interviewId: ctx.id });
    return { ...payload(ctx, state, "in_progress", startedAt), resumed: false };
  });
}

function stripIntro(text: string) {
  return text.replace(/^Welcome back\. Let's pick up where we left off\. /, "");
}

export async function getRealtimeCredentials(token: string): Promise<RealtimeCredentials> {
  const ctx = await resolveToken(token);
  if (!ACTIVE.includes(ctx.status) && !["ready", "device_check"].includes(ctx.status)) throw new ApiError(409, "The interview is not active.");
  // Names and terms from the job and the parsed resume help speech-to-text spell them correctly.
  const [ref] = await withOrg(ctx.orgId, (tx) => tx<{ required_skills: string[]; preferred_skills: string[]; profile: { skills?: string[]; companies?: string[]; projects?: { name?: string }[] } | null }[]>`
    select j.required_skills, j.preferred_skills, c.parsed_profile as profile
    from interviews i join jobs j on j.id = i.job_id join candidates c on c.id = i.candidate_id where i.id = ${ctx.id}`);
  const terms = [
    ...(ref?.profile?.companies ?? []), ...(ref?.profile?.projects ?? []).map((p) => p.name ?? ""),
    ...(ref?.required_skills ?? []), ...(ref?.preferred_skills ?? []), ...(ref?.profile?.skills ?? []),
  ].filter((t): t is string => typeof t === "string");
  return createRealtimeCredentials({
    orgId: ctx.orgId, interviewerName: ctx.interviewerName, companyName: ctx.companyName, jobTitle: ctx.jobTitle,
    transcriptionPrompt: buildTranscriptionPrompt({ jobTitle: ctx.jobTitle, companyName: ctx.companyName, candidateName: ctx.candidateName, terms }),
  });
}

export async function getSessionState(token: string): Promise<SessionPayload> {
  const ctx = await resolveToken(token);
  return payload(ctx, ctx.state, ctx.status, ctx.startedAt);
}

/**
 * Handle a completed candidate answer. Three phases so no DB lock is held
 * during AI calls: (1) persist answer idempotently, (2) analyze + decide,
 * (3) re-lock, verify nothing moved, and advance.
 */
export type AnswerTrigger = "button" | "silence" | "no_answer_timeout";

export async function submitAnswer(token: string, input: {
  question_id: string; text: string; start_ms: number | null; end_ms: number | null;
  /** What ended the answer (for diagnostics). */
  trigger?: AnswerTrigger;
  /** The client already said a short "thank you" while we decide. */
  ack_spoken?: boolean;
}): Promise<SessionPayload & { duplicate?: boolean }> {
  const ctx = await resolveToken(token);
  if (!ACTIVE.includes(ctx.status) || !ctx.plan) throw new ApiError(409, "The interview is not in progress.");
  const plan = ctx.plan;
  const text = input.text.trim().slice(0, 8000);

  // Phase 1: persist answer (unique per question → idempotent).
  const phase1 = await withOrg(ctx.orgId, async (tx) => {
    const [iv] = await tx<{ state: unknown }[]>`select state from interviews where id = ${ctx.id}`;
    const state = InterviewStateSchema.parse(iv.state);
    const [q] = await tx<{ id: string; section_id: string; question_text: string; intent: string | null; evaluation_criteria: string[]; parent_question_id: string | null; asked_at_ms: number | null }[]>`
      select id, section_id, question_text, intent, evaluation_criteria, parent_question_id, asked_at_ms from interview_questions
      where id = ${input.question_id} and interview_id = ${ctx.id}`;
    if (!q) throw new ApiError(404, "Unknown question.");
    const inserted = await tx`
      insert into interview_answers (organization_id, interview_id, question_id, transcript_text, start_ms, end_ms, duration_seconds)
      values (${ctx.orgId}, ${ctx.id}, ${q.id}, ${text}, ${input.start_ms}, ${input.end_ms},
        ${input.start_ms != null && input.end_ms != null ? Math.max(0, Math.round((input.end_ms - input.start_ms) / 1000)) : null})
      on conflict (question_id) do nothing returning id`;
    if (!inserted.length || state.current_question_id !== q.id) return { duplicate: true as const, state };
    await audit(tx, { orgId: ctx.orgId, actorType: "candidate", action: "interview.answer_received", entityType: "interview_question", entityId: q.id });
    return { duplicate: false as const, state, question: q };
  });
  if (phase1.duplicate) return { ...payload(ctx, phase1.state, ctx.status, ctx.startedAt), duplicate: true };

  const { state, question } = phase1;
  const section = plan.sections[state.section_index];
  const planned = section.questions[state.question_index];
  const nowMs = clockMs(ctx.startedAt);

  // Phase 2: analysis + follow-up suggestion (outside any transaction). One
  // fast AI call, and none at all when a follow-up isn't possible or there was
  // no answer — then we advance immediately and analyze in the background.
  const thread = await withOrg(ctx.orgId, (tx) => tx<{ question_text: string; transcript_text: string | null }[]>`
    select q.question_text, a.transcript_text from interview_questions q left join interview_answers a on a.question_id = q.id
    where q.id = ${state.current_planned_question_id ?? question.id} or q.parent_question_id = ${state.current_planned_question_id ?? question.id}
    order by q.sequence_number`);
  const priorContext = thread.filter((t) => t.question_text !== question.question_text && t.transcript_text)
    .map((t) => `Q: ${t.question_text}\nA: ${t.transcript_text!.slice(0, 1200)}`).join("\n\n") || null;

  const allowed = computeAllowed({ plan, state, nowMs });
  const turnInput = {
    orgId: ctx.orgId,
    sectionName: section.name,
    sectionObjective: section.objective,
    question: question.question_text,
    intent: question.intent,
    criteria: question.evaluation_criteria,
    followupTopics: planned?.followup_topics ?? [],
    answer: text,
    priorContext,
  };
  // A short reply may be a request to repeat or explain the question that the browser
  // didn't recognise (e.g. garbled by speech-to-text), so the AI still looks at it.
  const repeatsLeft = repeatsUsed(state, question.id) < MAX_REPEATS;
  const checkRequest = !!text && repeatsLeft && text.split(/\s+/).length <= 25;
  const fastPath = (!allowed.follow_up && !checkRequest) || !text;
  let analysis: (AnswerAnalysis & { source: string }) | null = text ? null : { ...mockAnalyzeAnswer(""), source: "rule" };
  let decision: FollowupDecision | null = null;
  let aiMs = 0;
  if (!fastPath) {
    const turn = await analyzeTurn({
      ...turnInput,
      alreadyAsked: thread.map((t) => t.question_text),
      followupsRemaining: section.max_followups - state.followups_used,
    });
    analysis = turn.analysis;
    decision = turn.decision;
    aiMs = turn.ms;
  }
  // The candidate asked for the question again, or said nothing usable: ask the same
  // question again (simpler if they didn't understand) instead of moving on.
  const askAgain: RequestKind | null = text && repeatsLeft && analysis
    ? analysis.candidate_asked_for_clarification ? "clarify" : (analysis as { answer_unclear?: boolean }).answer_unclear ? "unclear" : null
    : null;
  if (askAgain) {
    const simpler = askAgain === "clarify"
      ? sanitizeSpoken(decision?.question) ?? sanitizeSpoken(await rephraseQuestion({
        orgId: ctx.orgId, jobTitle: ctx.jobTitle, sectionName: section.name, question: question.question_text, intent: question.intent, request: text,
      }))
      : null;
    const again = await withOrg(ctx.orgId, async (tx) => {
      const [locked] = await tx<{ state: unknown; status: InterviewStatus }[]>`select state, status from interviews where id = ${ctx.id} for update`;
      const fresh = InterviewStateSchema.parse(locked.state);
      if (fresh.current_question_id !== question.id || !ACTIVE.includes(locked.status)) return null;
      // Not an answer: the candidate answers this question again.
      await tx`delete from interview_answers where question_id = ${question.id}`;
      const next = { ...fresh, repeats: { question_id: question.id, count: repeatsUsed(fresh, question.id) + 1 } };
      await saveState(tx, ctx.id, next);
      await logEventTx(tx, ctx, `again-${question.id}-${next.repeats.count}`, "question_repeated", { kind: askAgain, by: "server" });
      return { state: next, status: locked.status };
    });
    if (again) {
      const utterance: PendingUtterance = {
        question_id: question.id,
        kind: question.parent_question_id ? "followup" : "question",
        text: againText(askAgain, question.question_text, simpler),
      };
      return { ...payload(ctx, again.state, again.status, ctx.startedAt), utterance };
    }
  }
  const step = resolveNextStep(allowed, decision);

  // Phase 3: advance under lock.
  const result = await withOrg(ctx.orgId, async (tx) => {
    const [locked] = await tx<{ state: unknown; status: InterviewStatus }[]>`select state, status from interviews where id = ${ctx.id} for update`;
    const fresh = InterviewStateSchema.parse(locked.state);
    if (analysis) await tx`update interview_answers set analysis = ${json(analysis)} where question_id = ${question.id}`;
    if (fresh.current_question_id !== question.id) {
      return { state: fresh, status: locked.status, completedSection: null as number | null };
    }
    const adv = advanceState(plan, fresh, step.action, nowMs);
    const next = { ...adv.state, answered_count: fresh.answered_count + 1 };
    const decisionRecord = {
      action: step.action, reason: step.reason, overridden: step.overridden, missing_evidence: decision?.missing_evidence ?? [],
      ai_suggested: decision?.action ?? null, ai_ms: aiMs, fast_path: fastPath, trigger: input.trigger ?? null,
    };
    // If the client already thanked the candidate, don't open with another "thank you".
    const transition = input.ack_spoken ? stripThanks(step.transition) : step.transition;

    if (adv.sectionCompleted != null) {
      await tx`update interview_sections set status = 'completed', completed_at = now(), end_ms = ${nowMs}
        where id = ${plan.sections[adv.sectionCompleted].section_id}`;
      await audit(tx, { orgId: ctx.orgId, actorType: "system", action: "interview.section_completed", entityType: "interview_section", entityId: plan.sections[adv.sectionCompleted].section_id });
    }

    if (adv.finished) {
      const first = ctx.candidateName.split(" ")[0];
      next.pending_utterance = {
        question_id: null,
        kind: "closing",
        text: `${transition ? transition + " " : ""}That brings us to the end of the interview. Thank you for your time, ${first}. The hiring team at ${ctx.companyName} will review your interview and be in touch about next steps. Please keep this window open for a few seconds while your interview is saved.`,
      };
      await tx`update interviews set status = 'completing' where id = ${ctx.id}`;
    } else if (step.action === "follow_up") {
      const spoken = [transition, step.followupQuestion].filter(Boolean).join(" ");
      const id = await insertQuestion(tx, ctx, {
        sectionId: section.section_id, text: step.followupQuestion!, spoken, type: "followup", intent: "Follow-up",
        criteria: question.evaluation_criteria, planKey: null, parentId: fresh.current_planned_question_id, decision: decisionRecord, askedAtMs: nowMs,
      });
      next.current_question_id = id;
      next.pending_utterance = { question_id: id, text: spoken, kind: "followup" };
    } else if (adv.planned) {
      const s = plan.sections[adv.planned.sectionIndex];
      const q = s.questions[adv.planned.questionIndex];
      const newSection = adv.planned.sectionIndex !== fresh.section_index;
      if (newSection) {
        await tx`update interview_sections set status = 'in_progress', started_at = now(), start_ms = ${nowMs} where id = ${s.section_id}`;
      }
      const lead = transition ?? (input.ack_spoken ? "" : "Thank you.");
      const spoken = [lead, newSection ? `Let's move on to ${s.name.toLowerCase()}.` : "", q.question].filter(Boolean).join(" ");
      const id = await insertQuestion(tx, ctx, {
        sectionId: s.section_id, text: q.question, spoken, type: "planned", intent: q.intent, criteria: q.evaluation_criteria,
        planKey: q.key, parentId: null, decision: decisionRecord, askedAtMs: nowMs,
      });
      next.current_question_id = id;
      next.current_planned_question_id = id;
      next.pending_utterance = { question_id: id, text: spoken, kind: "question" };
    }
    await saveState(tx, ctx.id, next);
    return { state: next, status: (adv.finished ? "completing" : locked.status) as InterviewStatus, completedSection: adv.sectionCompleted };
  });

  if (fastPath && text) {
    runInBackground("answer.analyze", async () => {
      const a = await analyzeAnswer(turnInput);
      await withOrg(ctx.orgId, (tx) => tx`update interview_answers set analysis = ${json(a)} where question_id = ${question.id}`);
    });
  }

  if (result.completedSection != null) {
    const sectionId = plan.sections[result.completedSection].section_id;
    runInBackground("section.evaluate", async () => {
      const { evaluateInterviewSection } = await import("./processing");
      await evaluateInterviewSection(ctx.orgId, ctx.id, sectionId);
    });
  }
  return payload(ctx, result.state, result.status, ctx.startedAt);
}

function repeatsUsed(state: InterviewState, questionId: string) {
  return state.repeats?.question_id === questionId ? state.repeats.count : 0;
}

function againText(kind: RequestKind, question: string, simpler: string | null) {
  if (kind === "unclear") return "Sorry, I didn't catch that clearly. Could you please say your answer again?";
  if (kind === "clarify" && simpler) return `Sure, let me put it more simply. ${simpler}`;
  return `Sure, here it is again. ${question}`;
}

/**
 * The candidate asked to hear the current question again ("repeat"), to have it
 * explained more simply ("clarify"), or said nothing usable ("unclear"). Their
 * reply is not an answer and doesn't use a follow-up; up to MAX_REPEATS per
 * question. Returns utterance: null when no more repeats are allowed (the reply
 * is then submitted as a normal answer).
 */
export async function repeatQuestion(token: string, input: { question_id: string; kind: RequestKind; text: string }): Promise<{ utterance: PendingUtterance | null }> {
  const ctx = await resolveToken(token);
  if (ctx.status !== "in_progress" || !ctx.plan) throw new ApiError(409, "The interview is not in progress.");
  const plan = ctx.plan;
  const [q] = await withOrg(ctx.orgId, (tx) => tx<{ question_text: string; intent: string | null; parent_question_id: string | null }[]>`
    select question_text, intent, parent_question_id from interview_questions where id = ${input.question_id} and interview_id = ${ctx.id}`);
  if (!q) throw new ApiError(404, "Unknown question.");
  if (ctx.state.current_question_id !== input.question_id || repeatsUsed(ctx.state, input.question_id) >= MAX_REPEATS) return { utterance: null };

  const simpler = input.kind === "clarify"
    ? sanitizeSpoken(await rephraseQuestion({
      orgId: ctx.orgId, jobTitle: ctx.jobTitle, sectionName: plan.sections[ctx.state.section_index]?.name ?? "", question: q.question_text, intent: q.intent, request: input.text,
    }))
    : null;

  const ok = await withOrg(ctx.orgId, async (tx) => {
    const [locked] = await tx<{ state: unknown; status: InterviewStatus }[]>`select state, status from interviews where id = ${ctx.id} for update`;
    const fresh = InterviewStateSchema.parse(locked.state);
    const used = repeatsUsed(fresh, input.question_id);
    if (locked.status !== "in_progress" || fresh.current_question_id !== input.question_id || used >= MAX_REPEATS) return false;
    await saveState(tx, ctx.id, { ...fresh, repeats: { question_id: input.question_id, count: used + 1 } });
    await logEventTx(tx, ctx, `again-${input.question_id}-${used + 1}`, "question_repeated", { kind: input.kind, by: "browser", rephrased: !!simpler });
    return true;
  });
  if (!ok) return { utterance: null };
  return { utterance: { question_id: input.question_id, kind: q.parent_question_id ? "followup" : "question", text: againText(input.kind, q.question_text, simpler) } };
}

/** Finish the interview (normally after the closing line, or candidate ends early). Idempotent. */
export async function completeInterview(token: string, input: { reason: "finished" | "candidate_ended" | "time_limit" }) {
  const ctx = await resolveToken(token);
  if (FINISHED.includes(ctx.status)) return { status: ctx.status };
  if (!ACTIVE.includes(ctx.status)) throw new ApiError(409, "The interview hasn't started.");
  const recruiters = await withOrg(ctx.orgId, async (tx) => {
    const [locked] = await tx<{ status: InterviewStatus; started_at: Date | null }[]>`select status, started_at from interviews where id = ${ctx.id} for update`;
    if (FINISHED.includes(locked.status)) return null;
    const duration = locked.started_at ? Math.round((Date.now() - locked.started_at.getTime()) / 1000) : null;
    const endMs = clockMs(locked.started_at);
    await tx`update interviews set status = 'completed', completed_at = now(), duration_seconds = ${duration} where id = ${ctx.id}`;
    await tx`update interview_sections set status = 'completed', completed_at = now(), end_ms = ${endMs} where interview_id = ${ctx.id} and status = 'in_progress'`;
    await tx`update interview_sections set status = 'skipped' where interview_id = ${ctx.id} and status = 'pending'`;
    await tx`update interviews set state = jsonb_set(state, '{phase}', '"finished"') where id = ${ctx.id}`;
    await audit(tx, { orgId: ctx.orgId, actorType: "candidate", action: "interview.completed", entityType: "interview", entityId: ctx.id, metadata: { reason: input.reason, duration } });
    await notify(tx, { orgId: ctx.orgId, type: "interview.completed", payload: { interview_id: ctx.id, candidate: ctx.candidateName, job: ctx.jobTitle, reason: input.reason } });
    const [org] = await tx<{ settings: unknown }[]>`select settings from organizations where id = ${ctx.orgId}`;
    if (!readSettings(org?.settings).notify_on_completion) return [];
    return tx<{ email: string }[]>`select u.email from organization_members m join users u on u.id = m.user_id
      where m.organization_id = ${ctx.orgId} and m.role in ('owner','admin','recruiter')`;
  });
  if (recruiters === null) return { status: "completed" as const };
  log.info("interview.completed", { interviewId: ctx.id, reason: input.reason });
  runInBackground("interview.process", () => processInterview(ctx.orgId, ctx.id));
  runInBackground("interview.notify", async () => {
    const tpl = emailTemplates.completed({ candidateName: ctx.candidateName, jobTitle: ctx.jobTitle, link: `${env().APP_URL}/interviews/${ctx.id}` });
    for (const r of recruiters) await sendEmail({ to: r.email, ...tpl, orgId: ctx.orgId });
  });
  return { status: "completed" as const };
}

export type SegmentInput = {
  client_event_id: string;
  speaker: "interviewer" | "candidate";
  text: string;
  start_ms: number;
  end_ms: number;
  question_id: string | null;
};

/** Persist transcript segments; duplicates (same client_event_id) are ignored. */
export async function addTranscriptSegments(token: string, segments: SegmentInput[]) {
  const ctx = await resolveToken(token);
  if (!ACTIVE.includes(ctx.status) && ctx.status !== "completed") throw new ApiError(409, "The interview is not active.");
  if (!ctx.plan) return { saved: 0 };
  const fallbackSection = ctx.plan.sections[Math.min(ctx.state.section_index, ctx.plan.sections.length - 1)].section_id;
  return withOrg(ctx.orgId, async (tx) => {
    let saved = 0;
    for (const s of segments) {
      const text = s.text.trim();
      if (!text) continue;
      let sectionId = fallbackSection;
      let questionId: string | null = null;
      if (s.question_id) {
        const [q] = await tx<{ id: string; section_id: string }[]>`select id, section_id from interview_questions where id = ${s.question_id} and interview_id = ${ctx.id}`;
        if (q) {
          sectionId = q.section_id;
          questionId = q.id;
        }
      }
      const start = Math.max(0, Math.round(s.start_ms));
      const end = Math.max(start, Math.round(s.end_ms));
      const rows = await tx`
        insert into transcript_segments (organization_id, interview_id, section_id, question_id, speaker, text, start_time_ms, end_time_ms, sequence_number, client_event_id)
        values (${ctx.orgId}, ${ctx.id}, ${sectionId}, ${questionId}, ${s.speaker}, ${text.slice(0, 10_000)}, ${start}, ${end},
          ${start * 10 + (s.speaker === "interviewer" ? 0 : 1)}, ${s.client_event_id.slice(0, 120)})
        on conflict (interview_id, client_event_id) do nothing returning id`;
      saved += rows.length;
    }
    await tx`update interviews set state = jsonb_set(state, '{last_activity_at}', to_jsonb(now()::text)) where id = ${ctx.id}`;
    return { saved };
  });
}

async function logEventTx(tx: Tx, ctx: { id: string; orgId: string }, eventId: string, type: string, payload: Record<string, unknown>) {
  await tx`insert into interview_events (organization_id, interview_id, event_id, type, payload)
    values (${ctx.orgId}, ${ctx.id}, ${eventId.slice(0, 120)}, ${type.slice(0, 60)}, ${json(payload)})
    on conflict (interview_id, event_id) do nothing`;
}

export async function logEvents(token: string, events: { event_id: string; type: string; payload?: Record<string, unknown> }[]) {
  const ctx = await resolveToken(token);
  await withOrg(ctx.orgId, async (tx) => {
    for (const e of events) await logEventTx(tx, ctx, e.event_id, e.type, e.payload ?? {});
  });
}
