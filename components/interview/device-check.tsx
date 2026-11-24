"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, Clapperboard, Globe, Loader2, Mic, ScanFace, Volume2, Wifi, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { isWirelessMic, recordingProblem } from "@/components/interview/session/recording-health";
import { loadFaceModel, scanFaces, snapshot, uploadFace } from "@/lib/client/face";

type Status = "pending" | "ok" | "fail" | "warn";

function Row({ icon: Icon, label, status, detail, action }: { icon: typeof Camera; label: string; status: Status; detail: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <Icon className="size-5 text-muted-foreground" />
      <div className="min-w-0 flex-1"><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">{detail}</p></div>
      {action}
      {status === "ok" ? <CheckCircle2 className="size-5 text-emerald-600" /> : status === "warn" ? <AlertTriangle className="size-5 text-amber-500" /> : status === "fail" ? <XCircle className="size-5 text-destructive" /> : <Loader2 className="size-5 animate-spin text-muted-foreground" />}
    </div>
  );
}

type FaceState = "loading" | "searching" | "many" | "far" | "captured" | "unavailable";
type FaceReference = { descriptor: number[] | null; image: Blob; url: string };

export function DeviceCheck({ token, planReady, faceVerification }: { token: string; planReady: boolean; faceVerification: boolean }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cam, setCam] = useState<Status>("pending");
  const [mic, setMic] = useState<Status>("pending");
  const [level, setLevel] = useState(0);
  const [speaker, setSpeaker] = useState<Status>("pending");
  const [browser, setBrowser] = useState<Status>("pending");
  const [network, setNetwork] = useState<{ s: Status; ms?: number }>({ s: "pending" });
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heardVoice = useRef(false);
  const [micName, setMicName] = useState("");
  const [recTest, setRecTest] = useState<Status>("pending");
  const [faceState, setFaceState] = useState<FaceState>("loading");
  const [faceRef, setFaceRef] = useState<FaceReference | null>(null);
  const [retake, setRetake] = useState(0);

  useEffect(() => {
    const supported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined" && typeof RTCPeerConnection !== "undefined" && typeof AudioContext !== "undefined";
    queueMicrotask(() => setBrowser(supported ? "ok" : "fail"));
    const t0 = performance.now();
    fetch(`/api/public/interview/${token}/state`, { cache: "no-store" }).then((r) => setNetwork({ s: r.ok ? "ok" : "fail", ms: Math.round(performance.now() - t0) })).catch(() => setNetwork({ s: "fail" }));

    let ctx: AudioContext | null = null;
    let raf = 0;
    let local: MediaStream | null = null;
    let closed = false;
    let stopTest = () => {};
    navigator.mediaDevices?.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } })
      .then((s) => {
        // The page closed while the camera was starting: turn it straight off.
        if (closed) { s.getTracks().forEach((t) => t.stop()); return; }
        local = s;
        setStream(s);
        setCam(s.getVideoTracks().length ? "ok" : "fail");
        setMicName(s.getAudioTracks()[0]?.label ?? "");
        stopTest = testRecording(s, setRecTest);
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          const l = Math.min(1, peak / 60);
          setLevel(l);
          if (l > 0.15 && !heardVoice.current) { heardVoice.current = true; setMic("ok"); }
          raf = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch((e: Error) => {
        setCam("fail");
        setMic("fail");
        setMediaError(e.name === "NotAllowedError" ? "Camera/microphone permission was blocked. Allow access in your browser's address bar, then reload." : e.name === "NotFoundError" ? "No camera or microphone was found." : "We couldn't access your camera or microphone.");
      });
    return () => { closed = true; stopTest(); cancelAnimationFrame(raf); ctx?.close().catch(() => {}); local?.getTracks().forEach((t) => t.stop()); };
  }, [token]);

  useEffect(() => { if (video.current && stream) video.current.srcObject = stream; }, [stream]);

  // Make the interviewer's spoken introduction while the candidate checks their setup, so it plays
  // straight away on the next screen (the browser keeps the downloaded copy).
  useEffect(() => {
    if (planReady) void fetch(`/api/public/interview/${token}/intro-audio`).catch(() => {});
  }, [token, planReady]);

  // Identity check: take the reference photo once exactly one face is clearly in view.
  // Starts after the test recording, so loading the face model can't slow that test down.
  const recTested = recTest !== "pending";
  useEffect(() => {
    if (!faceVerification || !stream || !recTested) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capture = async (descriptor: number[] | null) => {
      const v = video.current;
      const image = v && await snapshot(v);
      if (stopped || !image) return false;
      setFaceRef({ descriptor, image, url: URL.createObjectURL(image) });
      setFaceState(descriptor ? "captured" : "unavailable");
      return true;
    };
    loadFaceModel().then((faceapi) => {
      let steady = 0;
      const tick = async () => {
        if (stopped || !video.current) return;
        try {
          const scan = await scanFaces(faceapi, video.current);
          if (stopped) return;
          const clear = scan.faces === 1 && scan.descriptor && (scan.size ?? 0) >= 0.12;
          steady = clear ? steady + 1 : 0;
          setFaceState(scan.faces > 1 ? "many" : scan.faces === 1 && !clear ? "far" : "searching");
          if (clear && steady >= 2 && await capture(scan.descriptor)) return;
        } catch { /* a dropped frame: try again */ }
        timer = setTimeout(tick, 700);
      };
      void tick();
    }).catch(() => {
      // This device can't run the face model: keep a photo for the hiring team to check by eye.
      if (stopped) return;
      const wait = () => { timer = setTimeout(async () => { if (!stopped && !(await capture(null))) wait(); }, 1500); };
      wait();
    });
    return () => { stopped = true; clearTimeout(timer); };
  }, [faceVerification, stream, recTested, retake]);

  useEffect(() => () => { if (faceRef) URL.revokeObjectURL(faceRef.url); }, [faceRef]);

  // The personalized plan is prepared in the background: re-check until it's ready.
  useEffect(() => {
    if (planReady) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [planReady, router]);

  const playTone = () => {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.85);
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  };

  const faceOk = !faceVerification || !!faceRef;
  const ready = cam === "ok" && mic === "ok" && browser === "ok" && speaker === "ok" && faceOk;
  const faceStatus: Status = !faceRef ? (faceState === "many" ? "fail" : "pending") : faceState === "unavailable" ? "warn" : "ok";
  const faceDetail = {
    loading: "Getting ready…",
    searching: "Look at the camera. Your photo is taken automatically.",
    many: "Only you should be in view.",
    far: "Move a little closer, with your face well lit.",
    captured: "Photo taken. It's compared with you during the interview.",
    unavailable: "Photo taken. Automatic checks aren't supported on this device, so the hiring team will review it.",
  }[faceState];

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Check your setup</h1>
        <p className="mt-2 text-sm text-muted-foreground">Make sure you can be seen and heard clearly.</p>
        <div className="relative mt-6 aspect-video overflow-hidden rounded-xl bg-muted">
          <video ref={video} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" />
          {!stream && !mediaError && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>}
          {mediaError && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-destructive">{mediaError}</div>}
        </div>
        <div className="mt-3 flex items-center gap-2" aria-label="Microphone level">
          <Mic className="size-4 text-muted-foreground" />
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} /></div>
        </div>
      </div>
      <div>
        <div className="divide-y rounded-xl border bg-card px-4">
          <Row icon={Globe} label="Browser" status={browser} detail={browser === "fail" ? "Please use the latest Chrome, Edge, Firefox or Safari on a computer." : "Supported"} />
          <Row icon={Camera} label="Camera" status={cam} detail={cam === "ok" ? "Working" : cam === "fail" ? "Not available" : "Requesting access…"} />
          <Row icon={Mic} label="Microphone" status={mic} detail={mic === "ok" ? `We can hear you${micName ? ` · ${micName}` : ""}` : mic === "fail" ? "Not available" : "Say a few words to test"} />
          <Row icon={Volume2} label="Speakers" status={speaker} detail={speaker === "ok" ? "Confirmed" : "Play a sound and confirm you heard it"}
            action={speaker !== "ok" && <div className="flex gap-1"><Button size="sm" variant="outline" onClick={playTone}>Play</Button><Button size="sm" variant="outline" onClick={() => setSpeaker("ok")}>I heard it</Button></div>} />
          <Row icon={Clapperboard} label="Recording" status={recTest}
            detail={recTest === "ok" ? "Test recording worked" : recTest === "warn" ? "Your computer struggled to record. Close other apps (especially video calls) and reload this page." : recTest === "fail" ? "Recording isn't supported in this browser" : "Making a 5-second test recording…"} />
          {faceVerification && (
            <Row icon={ScanFace} label="Identity photo" status={faceStatus} detail={faceDetail}
              action={faceRef && (
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                  <img src={faceRef.url} alt="Your identity photo" className="h-9 w-12 rounded object-cover -scale-x-100" />
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => { setFaceRef(null); setFaceState("loading"); setRetake((n) => n + 1); }}>Retake</Button>
                </div>
              )} />
          )}
          <Row icon={Wifi} label="Connection" status={network.s} detail={network.s === "ok" ? `Connected (${network.ms} ms)` : network.s === "fail" ? "Connection problem — check your network" : "Testing…"} />
        </div>
        {isWirelessMic(micName) && (
          <p className="mt-4 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">
            You&apos;re using a wireless headset ({micName}). That works, but wired earphones or your computer&apos;s built-in microphone usually give clearer audio.
          </p>
        )}
        {!planReady && <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Your personalized interview is being prepared…</p>}
        {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button size="lg" className="mt-6 h-11 w-full" disabled={!ready || busy} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            if (faceVerification && faceRef) await uploadFace(`/api/public/interview/${token}/face/reference`, { descriptor: faceRef.descriptor }, faceRef.image);
            await api(`/api/public/interview/${token}/device-check`, { body: { camera: cam === "ok", microphone: mic === "ok", browser: navigator.userAgent } });
            stream?.getTracks().forEach((t) => t.stop());
            router.push(`/interview/${token}/session`);
          } catch (e) { setError((e as Error).message); setBusy(false); }
        }}>{busy && <Loader2 className="animate-spin" />}Continue to interview</Button>
        {!ready && <p className="mt-2 text-center text-xs text-muted-foreground">All checks must pass to continue.</p>}
      </div>
    </div>
  );
}

/**
 * Record a few seconds and check the recorder keeps up with real time (the
 * same check the interview uses). Advice only: it never blocks the candidate.
 */
function testRecording(stream: MediaStream, done: (s: Status) => void) {
  if (typeof MediaRecorder === "undefined") { done("fail"); return () => {}; }
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(new MediaStream(stream.getTracks()));
  } catch {
    done("fail");
    return () => {};
  }
  const sliceMs = 1000;
  const startedAt = performance.now();
  const chunkTimes: number[] = [];
  rec.ondataavailable = () => chunkTimes.push(performance.now());
  rec.onstop = () => {
    const problem = recordingProblem({ startedAt, chunkTimes, now: performance.now(), sliceMs });
    done(problem || chunkTimes.length < 4 ? "warn" : "ok");
  };
  rec.start(sliceMs);
  const t = setTimeout(() => rec.state !== "inactive" && rec.stop(), 5500);
  return () => { clearTimeout(t); rec.onstop = null; if (rec.state !== "inactive") rec.stop(); };
}
