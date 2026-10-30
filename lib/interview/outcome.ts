// How an interview ended (or why it stopped), explained from what's already logged:
// the completion reason in the audit log, the candidate page's technical events,
// and the last time anything arrived from the candidate's browser. Nothing here
// reads transcripts, answers or recordings.

export type OutcomeTone = "ok" | "warn" | "error";
export type OutcomeEvent = { at: Date; type: string; payload: Record<string, unknown> };
export type OutcomeInput = {
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  durationSeconds: number | null;
  tokenExpiresAt: Date | null;
  processingError: string | null;
  /** From the audit log entry written when the interview was completed. */
  endReason: string | null;
  plannedMinutes: number | null;
  sections: { name: string; status: string }[];
  events: OutcomeEvent[];
  /** Latest time anything arrived from the candidate's browser (events, transcript, recording, identity checks). */
  lastSignalAt: Date | null;
  issueReports: { at: Date; category: string }[];
  cancelledBy: string | null;
};
export type Outcome = {
  tone: OutcomeTone;
  title: string;
  details: string[];
  /** Problems logged during the interview, oldest first, with the time into the interview. */
  problems: { at: string; text: string; tone: OutcomeTone }[];
};

/** No sign of life for this long while "in progress" means the candidate's page stopped. */
export const STOPPED_AFTER_MS = 2 * 60_000;
/** A candidate who leaves a started interview can reopen the link within this long and continue; after that it closes. */
export const REENTRY_WINDOW_MS = 10 * 60_000;

const ACTIVE = ["in_progress", "completing"];
const ENDED = ["completed", "processing", "report_ready", "failed"];

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const span = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`);
const str = (v: unknown) => (v == null ? "" : String(v)).slice(0, 160);

/** Plain-language text for a technical event the candidate's page logged. null = not a problem. */
function describeEvent(e: OutcomeEvent): { text: string; tone: OutcomeTone } | null {
  const p = e.payload;
  switch (e.type) {
    case "realtime_reconnecting": return { text: "The AI voice connection dropped; reconnecting", tone: "warn" };
    case "realtime_reconnected": return { text: `Voice connection restored${p.attempt != null ? ` (attempt ${Number(p.attempt) + 1})` : ""}`, tone: "ok" };
    case "realtime_error": return { text: `AI voice error${p.code ? ` (${str(p.code)})` : ""}${p.message ? `: ${str(p.message)}` : ""}`, tone: "error" };
    case "realtime_response_failed": return { text: `An AI voice reply failed${p.reason ? ` (${str(p.reason)})` : ""}`, tone: "warn" };
    case "speak_failed": return { text: `The interviewer's question couldn't be played${p.message ? `: ${str(p.message)}` : ""}`, tone: "error" };
    case "transcription_failed": return { text: "An answer couldn't be transcribed", tone: "warn" };
    case "transcript_save_failed": return { text: "Part of the transcript couldn't be saved", tone: "warn" };
    case "transcript_flush_timeout": return { text: "The last part of the transcript took too long to save", tone: "warn" };
    case "recording_start_failed": return { text: "The camera recording couldn't start", tone: "error" };
    case "voice_recording_start_failed": return { text: "The interviewer's voice recording couldn't start", tone: "warn" };
    case "recording_restarted": return { text: `The recording restarted${p.reason ? ` (${str(p.reason)})` : ""}`, tone: "warn" };
    case "recording_restart_failed": return { text: `The recording stopped and couldn't restart${p.reason ? ` (${str(p.reason)})` : ""}`, tone: "error" };
    case "mic_switched": return { text: `The microphone changed${p.reason ? ` (${str(p.reason)})` : ""}`, tone: "warn" };
    case "mic_switch_failed": return { text: `The microphone was lost and couldn't be switched${p.reason ? ` (${str(p.reason)})` : ""}`, tone: "error" };
    case "face_model_unavailable": return { text: "The identity check couldn't run on this device", tone: "warn" };
    case "face_check_upload_failed": return { text: "An identity check photo couldn't be uploaded", tone: "warn" };
    case "face_monitor_slow": return { text: "The candidate's device was slow (identity checks slowed down)", tone: "warn" };
    default: return null;
  }
}

/** Group repeats ("…, 3 times") so a flaky connection doesn't fill the list. */
function problemsFrom(input: OutcomeInput) {
  const start = input.startedAt?.getTime() ?? null;
  const rows: { at: number; text: string; tone: OutcomeTone }[] = [];
  for (const e of input.events) {
    const d = describeEvent(e);
    if (d) rows.push({ at: e.at.getTime(), ...d });
  }
  for (const r of input.issueReports) rows.push({ at: r.at.getTime(), text: `The candidate reported an issue: ${r.category}`, tone: "warn" });
  rows.sort((a, b) => a.at - b.at);
  const grouped: { at: number; text: string; tone: OutcomeTone; count: number }[] = [];
  for (const r of rows) {
    const g = grouped.find((x) => x.text === r.text);
    if (g) g.count++; else grouped.push({ ...r, count: 1 });
  }
  return grouped.slice(0, 20).map((g) => ({
    at: start != null ? clock(g.at - start) : "",
    text: g.count > 1 ? `${g.text} (${g.count} times)` : g.text,
    tone: g.tone,
  }));
}

function sectionsLine(sections: OutcomeInput["sections"]) {
  if (!sections.length) return null;
  const done = sections.filter((s) => s.status === "completed").length;
  const missed = sections.filter((s) => s.status === "skipped" || s.status === "pending").map((s) => s.name);
  return `${done} of ${sections.length} sections completed${missed.length ? `; not reached: ${missed.join(", ")}` : ""}.`;
}

/** The explanation shown on the interview page. null when there's nothing to explain yet. */
export function describeOutcome(input: OutcomeInput, now = new Date(), fmt: (d: Date) => string = (d) => d.toISOString()): Outcome | null {
  const problems = problemsFrom(input);
  const worst: OutcomeTone = problems.some((p) => p.tone === "error") ? "error" : problems.some((p) => p.tone === "warn") ? "warn" : "ok";
  const started = input.startedAt;
  const sections = sectionsLine(input.sections);

  if (input.status === "cancelled") {
    return { tone: "warn", title: "Cancelled by the hiring team", details: [input.cancelledBy ? `Cancelled by ${input.cancelledBy} before the candidate started.` : "Cancelled before the candidate started."], problems };
  }
  if (input.status === "expired") {
    return { tone: "warn", title: "The link expired", details: [`The candidate didn't ${started ? "finish" : "start"} the interview before the link expired${input.tokenExpiresAt ? ` on ${fmt(input.tokenExpiresAt)}` : ""}.`], problems };
  }
  if (!started) return null;

  if (ACTIVE.includes(input.status)) {
    const last = input.lastSignalAt ?? started;
    const quiet = now.getTime() - last.getTime();
    const into = Math.round((last.getTime() - started.getTime()) / 1000);
    if (quiet < STOPPED_AFTER_MS) {
      return { tone: worst === "error" ? "warn" : "ok", title: "In progress now", details: [`Last activity from the candidate ${span(Math.max(1, Math.round(quiet / 1000)))} ago.`, ...(sections ? [sections] : [])], problems };
    }
    const lastEvent = input.events.at(-1);
    const unreconnected = [...input.events].reverse().find((e) => e.type === "realtime_reconnecting" || e.type === "realtime_reconnected")?.type === "realtime_reconnecting";
    const lastProblem = [...problems].reverse().find((p) => p.tone !== "ok");
    const cause = unreconnected
      ? "The AI voice connection dropped and couldn't reconnect. The candidate was asked to reload the page to continue, and didn't come back."
      : input.status === "completing"
        ? "The interview had reached its end, but the candidate's page stopped while saving. It will be closed automatically."
        : lastProblem
          ? `The last problem logged before it stopped: ${lastProblem.text.toLowerCase()}.`
          : "No error was logged and the candidate didn't end the interview, so their page most likely stopped: the tab or browser was closed, the computer slept, or the internet connection was lost.";
    const reentryUntil = new Date(last.getTime() + REENTRY_WINDOW_MS);
    return {
      tone: unreconnected || lastProblem?.tone === "error" ? "error" : "warn",
      title: `Stopped ${span(into)} into the interview`,
      details: [
        `Nothing has arrived from the candidate's browser since ${fmt(last)}${lastEvent?.type === "media_stopped" ? " (their camera and microphone were switched off)" : ""}.`,
        cause,
        ...(sections ? [sections] : []),
        reentryUntil > now
          ? `If they reopen the link before ${fmt(reentryUntil)}, the interview continues where it stopped. After that it closes with the answers given so far.`
          : "They didn't come back within 10 minutes, so the interview closes with the answers given so far and the link no longer works.",
        "The recording so far is shown once the interview ends.",
      ],
      problems,
    };
  }

  if (ENDED.includes(input.status)) {
    const length = input.durationSeconds != null ? span(input.durationSeconds) : null;
    const planned = input.plannedMinutes ? ` (planned about ${input.plannedMinutes} min)` : "";
    const base = { finished: "Finished normally", candidate_ended: "Ended early by the candidate", time_limit: "Ended at the time limit", closed_by_processing: "Closed automatically", left_unfinished: "The candidate left and didn't return" } as Record<string, string>;
    const why: Record<string, string> = {
      finished: "The AI interviewer completed the interview and closed it.",
      candidate_ended: "The candidate clicked End and confirmed “End the interview now?”. No connection problem forced it.",
      time_limit: "The interview reached its maximum length and was closed after the candidate's last answer.",
      closed_by_processing: "The interview had reached its end, but the candidate's page stopped during the final save, so it was closed automatically.",
      left_unfinished: `The candidate's page stopped${input.completedAt ? ` at ${fmt(input.completedAt)}` : ""} and they didn't reopen the link within 10 minutes, so the interview was closed with the answers given so far. The link no longer works; invite them again if you'd like another attempt.`,
    };
    const reason = input.endReason ?? "";
    let tone: OutcomeTone = reason === "finished" ? (worst === "error" ? "warn" : "ok") : "warn";
    const details = [
      why[reason] ?? "The interview was completed.",
      ...(length ? [`Length: ${length}${planned}.`] : []),
      ...(sections ? [sections] : []),
    ];
    if (input.status === "failed" || input.processingError) {
      tone = "error";
      details.push(`The report couldn't be generated${input.processingError ? `: ${input.processingError.slice(0, 200)}` : "."} Use Regenerate report to try again.`);
    }
    return { tone, title: base[reason] ?? "Completed", details, problems };
  }
  return null;
}
