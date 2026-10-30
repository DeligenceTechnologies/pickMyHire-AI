"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, Captions, CheckCircle2, CloudUpload, Keyboard, Loader2, Mic, MicOff, PhoneOff, Radio, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { BrandMark } from "@/components/branding/brand-mark";
import { type Brand, brandStyle } from "@/lib/branding";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import { classifyReply, isYes, MAX_REPEATS, type RequestKind } from "@/lib/interview/repeat";
import { InterviewRecorder, type UploadStatus } from "./recorder";
import { useFaceMonitor } from "./face-monitor";
import { BrowserVoice, fetchCredentials, RealtimeVoice, type VoiceCallbacks, type VoiceEngine } from "./voice";

type Utterance = { question_id: string | null; text: string; kind: "question" | "followup" | "closing" };
type Progress = { section_index: number; section_count: number; section_name: string; total_minutes: number };
type Payload = { status: string; utterance: Utterance | null; progress: Progress | null; started_at: string | null; server_now: number; finished: boolean; resumed?: boolean; duplicate?: boolean };
type AIState = "idle" | "connecting" | "speaking" | "listening" | "thinking" | "finishing";

const nowMs = () => Date.now();

// Answer timing (option A): "Done answering" submits immediately; silence is
// only a safety net, with a visible countdown that speaking again cancels.
/** Silence after the candidate has spoken before the answer is submitted. */
const SILENCE_SUBMIT_MS = 10_000;
/** Shorter wait when what they said is only a request to repeat or explain the question. */
const REQUEST_SILENCE_MS = 2_500;
/** No answer at all: gently offer to repeat the question… */
const NO_ANSWER_NUDGE_MS = 20_000;
/** …and move on with "no answer" after this long. */
const NO_ANSWER_TIMEOUT_MS = 45_000;
/** Show the countdown during the last few seconds. */
const COUNTDOWN_MS = 5_000;
const ACKS = ["Thank you.", "Thanks for sharing that.", "Got it, thank you."];
const NUDGE = "Take your time. Would you like me to repeat the question? Or select Done answering to move on.";
type Trigger = "button" | "silence" | "no_answer_timeout";
const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
/** Longest the candidate waits on the "saving" screen; the server seals anything still missing. */
const SAVE_WAIT_MS = 30_000;

async function post<T>(url: string, body: unknown, opts: { retries?: number; onRetry?: (n: number) => void } = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data as T;
      // 4xx (other than rate limiting / not-ready) are not retryable.
      if (res.status < 500 && res.status !== 429 && res.status !== 425) throw Object.assign(new Error(data.error ?? "Request failed"), { fatal: true });
      throw new Error(data.error ?? `HTTP ${res.status}`);
    } catch (err) {
      if ((err as { fatal?: boolean }).fatal || attempt >= retries) throw err;
      opts.onRetry?.(attempt + 1);
      await new Promise((r) => setTimeout(r, Math.min(8000, 800 * 2 ** attempt)));
    }
  }
}

export function InterviewSession({ token, company, job, interviewerName, demoMode, candidateName, brand }: {
  token: string; company: string; job: string; interviewerName: string; demoMode: boolean; candidateName: string; brand: Brand;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<"intro" | "starting" | "live" | "finishing" | "error">("intro");
  const [ai, setAi] = useState<AIState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [utterance, setUtterance] = useState<Utterance | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [captions, setCaptions] = useState(true);
  const [connection, setConnection] = useState<"connected" | "reconnecting" | "offline">("connected");
  const [upload, setUpload] = useState<UploadStatus>({ state: "idle", pending: 0, uploaded: 0 });
  const [candidateSpeaking, setCandidateSpeaking] = useState(false);
  const [heard, setHeard] = useState("");
  const [typing, setTyping] = useState(demoMode);
  const [typed, setTyped] = useState("");
  const [countdown, setCountdown] = useState<{ kind: "silence" | "no_answer"; seconds: number } | null>(null);
  const [nudged, setNudged] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [saving, setSaving] = useState(false);
  const [micNotice, setMicNotice] = useState<string | null>(null);
  const [endedBy, setEndedBy] = useState<"finished" | "candidate_ended" | "time_limit">("finished");

  const video = useRef<HTMLVideoElement>(null);
  const camera = useRef<MediaStream | null>(null);
  const engine = useRef<VoiceEngine | null>(null);
  const recorder = useRef<InterviewRecorder | null>(null);
  const voiceRecorder = useRef<InterviewRecorder | null>(null);
  const clockBase = useRef<{ startedAt: number; skew: number } | null>(null);
  const current = useRef<Utterance | null>(null);
  const aiRef = useRef<AIState>("idle");
  const parts = useRef<string[]>([]);
  const typedRef = useRef("");
  const answerStart = useRef<number | null>(null);
  const pending = useRef(0);
  const speakingNow = useRef(false);
  const itemTimes = useRef(new Map<string, { start: number; end: number | null }>());
  const lastSpeechStart = useRef<number | null>(null);
  const listenStartedAt = useRef(0);
  const lastActivityAt = useRef(0);
  const nudgedRef = useRef(false);
  const ackIndex = useRef(0);
  const repeats = useRef(new Map<string, number>());
  const finishing = useRef(false);
  const submitting = useRef(false);
  const meterCtx = useRef<AudioContext | null>(null);
  const switchingMic = useRef(false);
  const switchMicRef = useRef<(reason: string) => Promise<void>>(async () => {});
  const events = useRef<{ event_id: string; type: string; payload?: Record<string, string | number | boolean | null> }[]>([]);

  const watchMic = (stream: MediaStream) => {
    stream.getAudioTracks().forEach((t) => t.addEventListener("ended", () => void switchMicRef.current("mic_disconnected"), { once: true }));
  };

  const clock = useCallback(() => {
    const b = clockBase.current;
    return b ? Math.max(0, Date.now() + b.skew - b.startedAt) : 0;
  }, []);
  const setAiState = (s: AIState) => { aiRef.current = s; setAi(s); };
  const logEvent = useCallback((type: string, payload?: Record<string, string | number | boolean | null>) => {
    events.current.push({ event_id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, payload });
  }, []);

  useFaceMonitor({ token, active: stage === "live", video, onEvent: logEvent });

  // Flush client events periodically (best effort).
  useEffect(() => {
    const t = setInterval(() => {
      if (!events.current.length) return;
      const batch = events.current.splice(0, 50);
      fetch(`/api/public/interview/${token}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: batch }) }).catch(() => events.current.unshift(...batch));
    }, 5000);
    return () => clearInterval(t);
  }, [token]);

  useEffect(() => {
    const t = setInterval(() => setElapsed(clock()), 1000);
    const off = () => setConnection("offline");
    const on = () => setConnection((c) => (c === "offline" ? "connected" : c));
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => { clearInterval(t); window.removeEventListener("offline", off); window.removeEventListener("online", on); };
  }, [clock]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (stage === "live" || stage === "finishing") { e.preventDefault(); } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [stage]);

  // Turn the camera and microphone off (the browser's camera light and mic
  // indicator go out) and stop the level meter.
  const stopMedia = () => {
    camera.current?.getTracks().forEach((t) => t.stop());
    if (video.current) video.current.srcObject = null;
    meterCtx.current?.close().catch(() => {});
    meterCtx.current = null;
  };

  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      engine.current?.close();
      stopMedia();
    };
  }, []);

  // The interviewer's voice is recorded on its own (not mixed into the video) and
  // played in sync on review. A reconnect brings a new stream: keep recording it.
  const recordVoice = (stream: MediaStream) => {
    const audio = new MediaStream(stream.getAudioTracks());
    if (finishing.current || !clockBase.current || !audio.getAudioTracks().length) return;
    if (voiceRecorder.current) { void voiceRecorder.current.useStream(audio); return; }
    const r = new InterviewRecorder(token, () => {}, { clock, onEvent: logEvent, track: "interviewer" });
    voiceRecorder.current = r;
    r.start(audio).catch(() => { voiceRecorder.current = null; logEvent("voice_recording_start_failed"); });
  };

  const saveSegment = useCallback((seg: { client_event_id: string; speaker: "interviewer" | "candidate"; text: string; start_ms: number; end_ms: number; question_id: string | null }) => {
    void post(`/api/public/interview/${token}/transcript`, { segments: [seg] }, { retries: 6 }).catch(() => logEvent("transcript_save_failed"));
  }, [token, logEvent]);

  const resetAnswer = () => {
    parts.current = [];
    typedRef.current = "";
    setTyped("");
    setHeard("");
    answerStart.current = null;
    itemTimes.current.clear();
    nudgedRef.current = false;
    setNudged(false);
    setCountdown(null);
    submitting.current = false;
    setSaving(false);
  };

  /** What the candidate said is only a request to repeat / explain the question, or only filler. */
  const requestIn = (text: string): RequestKind | null => (nudgedRef.current && isYes(text) ? "repeat" : classifyReply(text));

  const finish = useCallback(async (reason: "finished" | "candidate_ended" | "time_limit") => {
    if (finishing.current) return;
    finishing.current = true;
    setEndedBy(reason);
    setStage("finishing");
    setAiState("finishing");
    engine.current?.close();
    // Never keep the candidate waiting indefinitely; the server seals any
    // chunks that arrived even if this final save times out.
    const saves = [recorder.current, voiceRecorder.current].map((r) => r?.finish().catch(() => false));
    // finish() has already stopped the recorders (their last piece is kept), so the
    // camera and microphone go off now, not after the upload.
    stopMedia();
    logEvent("media_stopped");
    await Promise.race([Promise.all(saves), new Promise((r) => setTimeout(r, SAVE_WAIT_MS))]);
    try {
      await post(`/api/public/interview/${token}/complete`, { reason }, { retries: 8 });
    } catch { /* the server also finalizes abandoned interviews */ }
    router.replace(`/interview/${token}/completed`);
  }, [router, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = useCallback(async (u: Utterance) => {
    current.current = u;
    setUtterance(u);
    resetAnswer();
    setAiState("speaking");
    engine.current?.stopListening();
    const start = clock();
    let transcript = u.text;
    try {
      transcript = (await engine.current!.speak(u.text)).transcript;
    } catch (err) {
      logEvent("speak_failed", { message: (err as Error).message.slice(0, 200) });
    }
    saveSegment({ client_event_id: `int-${u.question_id ?? "closing"}-${start}`, speaker: "interviewer", text: transcript, start_ms: start, end_ms: clock(), question_id: u.question_id });
    if (u.kind === "closing") return finish("finished");
    if (current.current !== u) return;
    listenStartedAt.current = Date.now();
    lastActivityAt.current = Date.now();
    setAiState("listening");
    engine.current?.startListening();
  }, [clock, finish, logEvent, saveSegment]);

  const submit = useCallback(async (trigger: Trigger) => {
    const u = current.current;
    if (!u?.question_id || aiRef.current !== "listening" || submitting.current) return;
    submitting.current = true;
    setCountdown(null);
    // Never drop speech: transcribe everything the candidate said before moving on.
    setSaving(true);
    await engine.current?.flush(10_000).catch(() => undefined);
    setSaving(false);
    if (current.current !== u || aiRef.current !== "listening") { submitting.current = false; return; }
    setAiState("thinking");
    engine.current?.stopListening();
    const text = [...parts.current, typedRef.current.trim()].filter(Boolean).join(" ").trim();
    if (typedRef.current.trim()) {
      const now = clock();
      saveSegment({ client_event_id: `typed-${u.question_id}`, speaker: "candidate", text: typedRef.current.trim(), start_ms: answerStart.current ?? now, end_ms: now, question_id: u.question_id });
    }
    // Only a request to repeat or explain the question (or "yes" to the offer to repeat
    // it): ask it again instead of treating it as the answer. Falls back to a normal answer.
    const request = requestIn(text);
    const asked = repeats.current.get(u.question_id) ?? 0;
    if (request && asked < MAX_REPEATS) {
      repeats.current.set(u.question_id, asked + 1);
      logEvent("repeat_requested", { kind: request });
      const again = await post<{ utterance: Utterance | null }>(`/api/public/interview/${token}/repeat`, { question_id: u.question_id, kind: request, text: text.slice(0, 2000) }, { retries: 2 })
        .catch(() => ({ utterance: null }));
      if (again.utterance && current.current === u && !finishing.current) return void (await ask(again.utterance));
      if (current.current !== u || finishing.current) { submitting.current = false; return; }
    }
    logEvent("answer_submitted", { trigger, chars: text.length });
    // Acknowledge right away so the candidate isn't left in silence while the next question is prepared.
    // A short reply phrased as a question may be a request the server will answer, so no "thank you" then.
    const questionLike = /\?\s*$/.test(text) && text.split(/\s+/).length <= 15;
    const ack = !text ? "Alright, let's continue." : questionLike ? null : ACKS[ackIndex.current++ % ACKS.length];
    const ackStart = clock();
    const ackDone = engine.current && ack
      ? engine.current.speak(ack).then((r) => saveSegment({ client_event_id: `ack-${u.question_id}`, speaker: "interviewer", text: r.transcript, start_ms: ackStart, end_ms: clock(), question_id: u.question_id })).catch(() => {})
      : Promise.resolve();
    const sentAt = Date.now();
    try {
      const [res] = await Promise.all([
        post<Payload>(`/api/public/interview/${token}/answer`, {
          question_id: u.question_id, text, start_ms: answerStart.current, end_ms: clock(), trigger, ack_spoken: !!ack,
        }, { retries: 30, onRetry: () => setConnection("reconnecting") }),
        ackDone,
      ]);
      logEvent("answer_processed", { trigger, server_ms: Date.now() - sentAt });
      setConnection("connected");
      if (res.progress) setProgress(res.progress);
      if (res.utterance && res.utterance.question_id !== u.question_id) await ask(res.utterance);
      else if (res.finished) await finish("finished");
      else if (res.utterance) await ask(res.utterance);
    } catch (err) {
      setError((err as Error).message);
      setStage("error");
    }
  }, [ask, clock, finish, logEvent, saveSegment, token]);

  // Answer timer: silence safety net (after speech) and no-answer nudge/timeout.
  useEffect(() => {
    if (ai !== "listening") return;
    const tick = setInterval(() => {
      if (aiRef.current !== "listening" || submitting.current || speakingNow.current || pending.current > 0) {
        setCountdown(null);
        return;
      }
      const now = Date.now();
      const spoke = parts.current.length > 0;
      const typing = typedRef.current.trim().length > 0;
      if (typing) {
        setCountdown(null); // typed answers finish with the button only
        return;
      }
      if (spoke) {
        const wait = requestIn(parts.current.join(" ")) ? REQUEST_SILENCE_MS : SILENCE_SUBMIT_MS;
        const left = wait - (now - lastActivityAt.current);
        if (left <= 0) return void submit("silence");
        setCountdown(left <= COUNTDOWN_MS ? { kind: "silence", seconds: Math.ceil(left / 1000) } : null);
        return;
      }
      const idle = now - listenStartedAt.current;
      if (idle >= NO_ANSWER_TIMEOUT_MS) return void submit("no_answer_timeout");
      if (idle >= NO_ANSWER_NUDGE_MS && !nudgedRef.current) {
        nudgedRef.current = true;
        setNudged(true);
        logEvent("no_answer_nudge");
        const e = engine.current;
        if (e) {
          e.stopListening();
          void e.speak(NUDGE).finally(() => { if (aiRef.current === "listening") e.startListening(); });
        }
      }
      const left = NO_ANSWER_TIMEOUT_MS - idle;
      setCountdown(left <= COUNTDOWN_MS ? { kind: "no_answer", seconds: Math.ceil(left / 1000) } : null);
    }, 250);
    return () => clearInterval(tick);
  }, [ai, submit, logEvent]);

  const callbacks = useRef<VoiceCallbacks | null>(null);
  const [cbProxy] = useState<VoiceCallbacks>(() => ({
    onSpeechStart: () => callbacks.current!.onSpeechStart(),
    onSpeechStop: () => callbacks.current!.onSpeechStop(),
    onTranscript: (t, i, timing) => callbacks.current!.onTranscript(t, i, timing),
    onPendingChange: (n) => callbacks.current!.onPendingChange(n),
    onConnection: (s) => callbacks.current!.onConnection(s),
    onRemoteStream: (s) => callbacks.current!.onRemoteStream(s),
    onEvent: (t, p) => callbacks.current!.onEvent(t, p),
  }));

  const createEngine = async (): Promise<VoiceEngine> => {
    if (demoMode) return new BrowserVoice(cbProxy);
    const creds = await fetchCredentials(token);
    if (creds.mode !== "openai") return new BrowserVoice(cbProxy);
    return new RealtimeVoice(creds, camera.current!.getAudioTracks()[0], cbProxy);
  };

  const reconnecting = useRef(false);
  const reconnect = async () => {
    if (reconnecting.current) return;
    reconnecting.current = true;
    setConnection("reconnecting");
    logEvent("realtime_reconnecting");
    const wasSpeaking = aiRef.current === "speaking";
    engine.current?.close();
    for (let attempt = 0; attempt < 6 && !finishing.current; attempt++) {
      try {
        const e = await createEngine();
        await e.connect();
        engine.current = e;
        setConnection("connected");
        logEvent("realtime_reconnected", { attempt });
        reconnecting.current = false;
        if (wasSpeaking && current.current) await ask(current.current);
        else if (aiRef.current === "listening") e.startListening();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    reconnecting.current = false;
    setError("We couldn't reconnect to the interviewer. Your progress is saved — reload this page within 10 minutes to continue.");
    setStage("error");
  };

  // Latest handlers for the voice engine (engines are long-lived; handlers change each render).
  useLayoutEffect(() => {
    callbacks.current = {
    onSpeechStart: () => {
      speakingNow.current = true;
      setCandidateSpeaking(true);
      setCountdown(null);
      lastActivityAt.current = Date.now();
      const now = clock();
      lastSpeechStart.current = now;
      if (answerStart.current == null) answerStart.current = now;
    },
    onSpeechStop: () => {
      speakingNow.current = false;
      setCandidateSpeaking(false);
      lastActivityAt.current = Date.now();
    },
    onTranscript: (text, itemId, timing) => {
      const u = current.current;
      parts.current.push(text);
      setHeard(parts.current.join(" "));
      // Timestamp the line where it was said (speech service timing), not when its transcript arrived.
      const at = (epoch: number) => Math.max(0, clock() - (Date.now() - epoch));
      const start = timing?.startedAt != null ? at(timing.startedAt) : (lastSpeechStart.current ?? clock());
      const end = timing?.stoppedAt != null ? at(timing.stoppedAt) : clock() - 400;
      saveSegment({ client_event_id: `cand-${itemId}`, speaker: "candidate", text, start_ms: start, end_ms: Math.max(start, end), question_id: u?.question_id ?? null });
      lastActivityAt.current = Date.now();
    },
    onPendingChange: (n) => { pending.current = n; if (n === 0) lastActivityAt.current = Date.now(); },
    onConnection: (s) => {
      if (s === "connected") setConnection("connected");
      else if (!finishing.current) void reconnect();
    },
    onRemoteStream: (stream) => recordVoice(stream),
    onEvent: logEvent,
  };
  });

  const begin = async () => {
    setStage("starting");
    setAiState("connecting");
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
        audio: AUDIO,
      });
      camera.current = media;
      if (unmounted.current) { stopMedia(); return; } // left the page while the camera was starting
      watchMic(media);
      if (video.current) video.current.srcObject = media;
      startMicMeter(media);

      const start = await post<Payload>(`/api/public/interview/${token}/start`, {}, { retries: 3 });
      if (start.finished) { stopMedia(); return router.replace(`/interview/${token}/completed`); }
      clockBase.current = { startedAt: new Date(start.started_at!).getTime(), skew: start.server_now - nowMs() };
      setProgress(start.progress);
      logEvent(start.resumed ? "session_resumed_client" : "session_started_client", { engine: demoMode ? "browser" : "openai" });

      recorder.current = new InterviewRecorder(token, setUpload, { clock, onEvent: logEvent });
      await recorder.current.start(media).catch(() => {
        setUpload({ state: "failed", pending: 0, uploaded: 0 });
        logEvent("recording_start_failed");
      });

      const e = await createEngine();
      await e.connect();
      engine.current = e;
      setStage("live");
      if (start.utterance) await ask(start.utterance);
    } catch (err) {
      // Don't leave the camera on behind the error (a retry asks for it again).
      engine.current?.close();
      engine.current = null;
      stopMedia();
      const e = err as Error & { name?: string };
      setError(e.name === "NotAllowedError" ? "Camera and microphone access is required. Allow access in your browser and try again." : e.message || "We couldn't start the interview.");
      setStage("error");
      setAiState("idle");
    }
  };

  const startMicMeter = (stream: MediaStream) => {
    meterCtx.current?.close().catch(() => {});
    const ctx = new AudioContext();
    meterCtx.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (ctx.state === "closed") return;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      setMicLevel(Math.min(1, peak / 50));
      requestAnimationFrame(tick);
    };
    tick();
  };

  // The microphone was unplugged or disconnected (e.g. earphones pulled out, a
  // headset's battery died): carry on with the next available microphone for
  // both the recording and the interviewer.
  const switchMic = async (reason: string) => {
    const cam = camera.current;
    if (!cam || switchingMic.current || finishing.current) return;
    switchingMic.current = true;
    try {
      const fresh = (await navigator.mediaDevices.getUserMedia({ audio: AUDIO })).getAudioTracks()[0];
      cam.getAudioTracks().forEach((t) => { cam.removeTrack(t); t.stop(); });
      cam.addTrack(fresh);
      watchMic(cam);
      startMicMeter(cam);
      await engine.current?.replaceMic?.(fresh);
      await recorder.current?.useStream(cam);
      logEvent("mic_switched", { reason });
      setMicNotice(`Microphone switched to: ${fresh.label || "your default microphone"}`);
    } catch {
      logEvent("mic_switch_failed", { reason });
      setMicNotice("We can't find a microphone. Please check it's connected.");
    } finally {
      switchingMic.current = false;
    }
  };
  useLayoutEffect(() => { switchMicRef.current = switchMic; });

  useEffect(() => {
    if (stage !== "live" || !navigator.mediaDevices) return;
    const onChange = async () => {
      const track = camera.current?.getAudioTracks()[0];
      const id = track?.getSettings().deviceId;
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
      if (!track || track.readyState === "ended" || (id && !inputs.some((d) => d.deviceId === id))) void switchMicRef.current("device_removed");
    };
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [stage]);

  useEffect(() => {
    if (!micNotice) return;
    const t = setTimeout(() => setMicNotice(null), 8000);
    return () => clearTimeout(t);
  }, [micNotice]);

  const doneAnswering = async () => {
    if (aiRef.current !== "listening") return;
    if (answerStart.current == null) answerStart.current = clock();
    await submit("button"); // submit() waits for every transcript first
  };

  const totalMs = (progress?.total_minutes ?? 0) * 60_000;
  const listening = ai === "listening";

  if (stage === "intro" || stage === "error") {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center" style={brandStyle(brand.color)}>
        {brand.logoUrl && <BrandMark brand={brand} height={40} className="mb-6" />}
        <p className="text-sm font-medium text-muted-foreground">{company} · {job}</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{stage === "error" ? "The interview was interrupted" : `Ready when you are, ${candidateName}`}</h1>
        <p className="mt-3 text-muted-foreground">
          {stage === "error" ? error : `${interviewerName} will greet you and ask the first question. Speak naturally; pause or select “Done answering” when you finish each answer.`}
        </p>
        {demoMode && stage !== "error" && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">Demo mode: the interviewer uses your browser&apos;s voice and you type answers.</p>}
        <Button size="lg" className="mt-8 h-11 px-8" onClick={begin}>{stage === "error" ? "Try again" : "Start interview"}</Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100" style={brandStyle(brand.color)}>
      <header className="flex items-center gap-4 border-b border-white/10 px-5 py-3">
        {brand.logoUrl && (
          <>
            <BrandMark brand={brand} height={22} onDark className="hidden shrink-0 md:inline-flex" />
            <span className="hidden h-6 w-px bg-white/15 md:block" aria-hidden />
          </>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{company}</p>
          <p className="truncate text-xs text-zinc-400">{job}</p>
        </div>
        {progress && (
          <div className="hidden min-w-48 flex-col items-center sm:flex" aria-label="Progress">
            <p className="text-xs text-zinc-400">Part {progress.section_index + 1} of {progress.section_count} · <span className="text-zinc-200">{progress.section_name}</span></p>
            <div className="mt-1.5 flex gap-1">{Array.from({ length: progress.section_count }).map((_, i) => <span key={i} className={cn("h-1 w-6 rounded-full", i < progress.section_index ? "bg-indigo-400" : i === progress.section_index ? "bg-indigo-300" : "bg-white/15")} />)}</div>
          </div>
        )}
        <div className="flex-1 text-right font-mono text-sm tabular text-zinc-300" aria-label="Elapsed time">
          {formatClock(elapsed)}{totalMs ? <span className="text-zinc-500"> / ~{formatClock(totalMs)}</span> : null}
        </div>
      </header>

      {connection !== "connected" && (
        <div className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-2 text-sm text-amber-200" role="status">
          <Loader2 className="size-4 animate-spin" /> Your connection was interrupted. We&apos;re reconnecting… your progress is saved.
        </div>
      )}

      {micNotice && (
        <div className="flex items-center justify-center gap-2 bg-sky-500/15 px-4 py-2 text-sm text-sky-100" role="status">
          <Mic className="size-4" /> {micNotice}
        </div>
      )}

      {stage === "finishing" && <SavingOverlay endedBy={endedBy} upload={upload} />}

      <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-6">
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={video} autoPlay muted playsInline className="size-full max-h-[70vh] -scale-x-100 object-cover" />
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs">
            <span className="size-2 animate-pulse rounded-full bg-red-500" /> Recording
          </div>
        </div>

        <aside className="flex flex-col gap-4">
          <div className="flex flex-col items-center rounded-2xl bg-white/5 p-6 text-center">
            <div className={cn("relative flex size-24 items-center justify-center rounded-full bg-indigo-500/20 transition-all", ai === "speaking" && "scale-110 bg-indigo-500/40", ai === "thinking" && "animate-pulse")}>
              {ai === "speaking" && <span className="absolute inset-0 animate-ping rounded-full bg-indigo-400/20" />}
              <Radio className="size-9 text-indigo-300" />
            </div>
            <p className="mt-4 font-semibold">{interviewerName}</p>
            <p className="text-sm text-zinc-400" aria-live="polite">
              {ai === "connecting" && "Connecting…"}
              {ai === "speaking" && "Speaking"}
              {ai === "listening" && (saving ? "Saving your answer…" : candidateSpeaking ? "Listening…" : "Your turn — answer when ready")}
              {ai === "thinking" && "Thinking about your answer…"}
              {ai === "finishing" && "Wrapping up and saving your interview…"}
            </p>
          </div>

          {captions && utterance && (
            <div className="rounded-2xl bg-white/5 p-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{utterance.kind === "followup" ? "Follow-up" : utterance.kind === "closing" ? "Closing" : "Question"}</p>
              <p className="text-sm leading-relaxed text-zinc-200">{utterance.text}</p>
            </div>
          )}

          {listening && !typing && heard && (
            <div className="rounded-2xl bg-white/5 p-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">We heard</p>
              <p className="max-h-32 overflow-y-auto text-sm text-zinc-300">{heard}</p>
            </div>
          )}

          {listening && typing && (
            <div className="rounded-2xl bg-white/5 p-4">
              <label htmlFor="typed" className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-500">Your answer</label>
              <Textarea id="typed" rows={5} value={typed} autoFocus
                onChange={(e) => { setTyped(e.target.value); typedRef.current = e.target.value; lastActivityAt.current = Date.now(); if (answerStart.current == null) answerStart.current = clock(); }}
                className="border-white/10 bg-black/30 text-zinc-100 placeholder:text-zinc-500" placeholder="Type your answer…" />
            </div>
          )}

          {nudged && listening && !countdown && <p className="rounded-xl bg-white/5 px-4 py-3 text-sm text-zinc-300">Take your time. Start speaking when you&apos;re ready, ask the interviewer to repeat the question, or select “Done answering” to move on.</p>}
          {countdown && listening && (
            <p role="status" className="flex items-center gap-2 rounded-xl bg-indigo-500/15 px-4 py-3 text-sm text-indigo-100">
              <span className="flex size-6 items-center justify-center rounded-full bg-indigo-500 font-mono text-xs font-semibold tabular text-white">{countdown.seconds}</span>
              {countdown.kind === "silence" ? "Moving on in a moment — keep talking to continue your answer." : "No answer yet — moving to the next question."}
            </p>
          )}

        </aside>
      </main>

      <footer className="flex flex-wrap items-center gap-3 border-t border-white/10 px-5 py-3">
        <div className="flex items-center gap-2 text-xs text-zinc-400" title="Microphone">
          {listening ? <Mic className="size-4 text-emerald-400" /> : <MicOff className="size-4" />}
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${Math.round(micLevel * 100)}%` }} /></div>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          {connection === "connected" ? <Wifi className="size-4 text-emerald-400" /> : <WifiOff className="size-4 text-amber-400" />}
          {connection === "connected" ? "Connected" : "Reconnecting"}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          {upload.state === "failed" ? <AlertTriangle className="size-4 text-amber-400" /> : upload.state === "saved" ? <CheckCircle2 className="size-4 text-emerald-400" /> : <CloudUpload className={cn("size-4", upload.state === "retrying" ? "text-amber-400" : "text-zinc-400")} />}
          {upload.state === "retrying" ? "Recording upload retrying" : upload.state === "failed" ? "Recording issue" : upload.pending > 1 ? `Uploading (${upload.pending})` : "Recording synced"}
        </span>
        {stage === "live" && <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-zinc-300 hover:bg-white/10 hover:text-white" onClick={() => setCaptions(!captions)} aria-pressed={captions}><Captions /> Captions</Button>
          {!demoMode && <Button variant="ghost" size="sm" className="text-zinc-300 hover:bg-white/10 hover:text-white" onClick={() => setTyping(!typing)} aria-pressed={typing}><Keyboard /> Type</Button>}
          <Button size="sm" disabled={!listening || saving} onClick={doneAnswering} className={brand.color ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-indigo-500 text-white hover:bg-indigo-400"}>
            {saving && <Loader2 className="animate-spin" />}{saving ? "Saving answer…" : "Done answering"}
          </Button>
          <ConfirmDialog
            title="End the interview now?"
            description="Your answers so far will be saved and sent to the hiring team. You won't be able to resume."
            confirmLabel="End interview"
            destructive
            onConfirm={() => finish("candidate_ended")}
            trigger={(open) => <Button size="sm" variant="destructive" onClick={open}><PhoneOff /> End</Button>}
          />
        </div>}
      </footer>
    </div>
  );
}

/** Shown once the interview is over while the last of the recording uploads. */
function SavingOverlay({ endedBy, upload }: { endedBy: "finished" | "candidate_ended" | "time_limit"; upload: UploadStatus }) {
  const total = upload.uploaded + upload.pending;
  const pct = upload.state === "saved" || upload.state === "failed" || total === 0 ? 100 : Math.min(99, Math.round((upload.uploaded / total) * 100));
  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/90 p-6 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 p-6 text-center ring-1 ring-white/10">
        <CheckCircle2 className="mx-auto size-10 text-emerald-400" />
        <h2 className="mt-3 text-lg font-semibold text-white">{endedBy === "candidate_ended" ? "Interview ended" : "Interview complete"}</h2>
        <p className="mt-1 text-sm text-zinc-400">Saving your video. Please keep this tab open, it usually takes a few seconds.</p>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-zinc-500">{pct}% saved</p>
      </div>
    </div>
  );
}
