"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Loader2, RotateCw, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export type RecordingPart = { part_index: number; offset_ms: number; duration_seconds: number | null; mime_type: string; url: string };
export type VideoPlayerHandle = { seek: (ms: number, play?: boolean) => void };

const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Latest part that has started by `ms` on the interview clock (-1 if none). */
function partAt(parts: RecordingPart[], ms: number) {
  let idx = -1;
  parts.forEach((p, i) => { if (p.offset_ms <= ms) idx = i; });
  return idx;
}

/**
 * Plays a recording made of one or more parts (a new part starts if the
 * candidate reconnected). Positions are on the interview clock (ms since start).
 * `voice` is the interviewer's voice, recorded separately and kept in sync.
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, { parts: RecordingPart[] | null; voice?: RecordingPart[] | null; error?: string | null; onTime?: (ms: number) => void }>(
  function VideoPlayer({ parts, voice, error, onTime }, ref) {
    const video = useRef<HTMLVideoElement>(null);
    const audio = useRef<HTMLAudioElement>(null);
    const [active, setActive] = useState(0);
    const [voiceIdx, setVoiceIdx] = useState(-1);
    const pendingSeek = useRef<{ sec: number; play: boolean } | null>(null);
    const current = parts?.[active];
    // Loading display: the video (by URL) that has become playable, mid-play buffering or seeking,
    // a failed load, and the interview time being jumped to.
    const [ready, setReady] = useState<string | null>(null);
    const [waiting, setWaiting] = useState(false);
    const [failed, setFailed] = useState<string | null>(null);
    const [target, setTarget] = useState<number | null>(null);
    /** True while the duration workaround below jumps to the end and back. */
    const findingLength = useRef(false);
    const busy = !!current && failed !== current.url && (ready !== current.url || waiting);
    const voicePart = voiceIdx >= 0 ? voice?.[voiceIdx] : undefined;

    /** Line the interviewer's voice up with the video's position and play state. */
    const syncVoice = useCallback(() => {
      const v = video.current;
      if (!v || !current || !voice?.length) return;
      const ms = current.offset_ms + v.currentTime * 1000;
      const idx = partAt(voice, ms);
      if (idx !== voiceIdx) { setVoiceIdx(idx); return; } // re-synced once the new part loads
      const a = audio.current;
      if (!a || idx < 0) return;
      a.muted = v.muted;
      a.volume = v.volume;
      a.playbackRate = v.playbackRate;
      const want = (ms - voice[idx].offset_ms) / 1000;
      if (Number.isFinite(a.duration) && want >= a.duration) { a.pause(); return; }
      if (Math.abs(a.currentTime - want) > 0.3) a.currentTime = want;
      if (v.paused || v.seeking) a.pause();
      else if (a.paused) void a.play().catch(() => {});
    }, [current, voice, voiceIdx]);

    const partFor = useCallback((ms: number) => {
      if (!parts?.length) return 0;
      let idx = 0;
      parts.forEach((p, i) => { if (p.offset_ms <= ms) idx = i; });
      return idx;
    }, [parts]);

    useImperativeHandle(ref, () => ({
      seek(ms, play = true) {
        if (!parts?.length || !video.current) return;
        const idx = partFor(ms);
        const sec = Math.max(0, (ms - parts[idx].offset_ms) / 1000);
        setTarget(ms);
        if (idx !== active) {
          pendingSeek.current = { sec, play };
          setActive(idx);
        } else if (video.current.readyState < HTMLMediaElement.HAVE_METADATA || findingLength.current) {
          // Not loaded yet (or still working out its length): apply the jump once it has loaded.
          pendingSeek.current = { sec, play };
        } else {
          video.current.currentTime = sec;
          if (play) void video.current.play().catch(() => {});
        }
      },
    }), [parts, active, partFor]);

    useEffect(() => {
      const v = video.current;
      if (!v) return;
      // Apply a jump requested before the video had loaded (an evidence link, ?t=, the next part).
      const applyPending = (fallbackSec?: number) => {
        const t = pendingSeek.current;
        pendingSeek.current = null;
        const sec = t?.sec ?? fallbackSec;
        if (sec != null) v.currentTime = sec;
        if (t?.play) void v.play().catch(() => {});
      };
      const fixDuration = () => {
        // MediaRecorder WebM files often lack a duration header; force the browser to compute it,
        // then go to the requested moment (kept until now, so it isn't lost).
        if (v.duration === Infinity) {
          findingLength.current = true;
          const restore = () => { v.removeEventListener("durationchange", restore); findingLength.current = false; applyPending(0); };
          v.addEventListener("durationchange", restore);
          v.currentTime = 1e101;
        } else {
          applyPending();
        }
      };
      v.addEventListener("loadedmetadata", fixDuration);
      return () => v.removeEventListener("loadedmetadata", fixDuration);
    }, [current?.url]);

    useEffect(() => {
      const a = audio.current;
      if (!a || !voicePart) return;
      const ready = () => {
        if (a.duration === Infinity) {
          const done = () => { a.removeEventListener("durationchange", done); syncVoice(); };
          a.addEventListener("durationchange", done);
          a.currentTime = 1e101;
        } else syncVoice();
      };
      a.addEventListener("loadedmetadata", ready);
      return () => a.removeEventListener("loadedmetadata", ready);
    }, [voicePart, syncVoice]);

    if (error) {
      return <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl bg-muted text-sm text-muted-foreground"><VideoOff className="size-6" />{error}</div>;
    }
    if (!parts) {
      return <div className="flex aspect-video items-center justify-center rounded-xl bg-muted"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
    }
    if (!parts.length || !current) {
      return <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl bg-muted text-sm text-muted-foreground"><VideoOff className="size-6" />No recording available</div>;
    }
    const playable = () => { if (findingLength.current) return; setReady(current.url); setWaiting(false); setTarget(null); };
    return (
      <div className="space-y-2">
        <div className="relative">
          <video
            ref={video}
            key={current.url}
            src={current.url}
            controls
            preload="metadata"
            playsInline
            className="aspect-video w-full rounded-xl bg-black"
            onTimeUpdate={(e) => { onTime?.(current.offset_ms + e.currentTarget.currentTime * 1000); syncVoice(); }}
            onPlay={syncVoice}
            onPause={syncVoice}
            onSeeking={() => { if (!findingLength.current) setWaiting(true); syncVoice(); }}
            onSeeked={() => { playable(); syncVoice(); }}
            // Runs after the duration workaround has had its turn on the same event.
            onLoadedMetadata={() => setTimeout(playable, 0)}
            onLoadedData={playable}
            onCanPlay={playable}
            onPlaying={playable}
            onWaiting={() => setWaiting(true)}
            onError={() => setFailed(current.url)}
            onRateChange={syncVoice}
            onVolumeChange={syncVoice}
            onEnded={() => { if (active < parts.length - 1) { pendingSeek.current = { sec: 0, play: true }; setActive(active + 1); } }}
          />
          {busy && (
            // Shown only if loading lasts more than a moment (CSS delay), and never blocks the controls.
            <div key={`${current.url}-${target ?? ""}`} role="status" aria-live="polite"
              className="video-loading pointer-events-none absolute inset-x-0 top-0 bottom-12 flex flex-col items-center justify-center gap-2 rounded-t-xl bg-black/75 px-4 text-center text-white">
              <Loader2 className="size-7 animate-spin" />
              <p className="text-sm font-medium">{target != null ? `Loading video at ${clock(target)}…` : "Loading video…"}</p>
              <p className="video-loading-slow text-xs text-white/75">Long recordings can take a few seconds to load.</p>
            </div>
          )}
          {failed === current.url && (
            <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/90 px-4 text-center text-white">
              <VideoOff className="size-7" />
              <p className="text-sm font-medium">The video couldn&apos;t load.</p>
              <Button size="sm" variant="secondary" onClick={() => { setFailed(null); setReady(null); setWaiting(false); video.current?.load(); }}>
                <RotateCw /> Try again
              </Button>
            </div>
          )}
        </div>
        {voicePart && <audio ref={audio} key={voicePart.url} src={voicePart.url} preload="auto" className="hidden" aria-hidden />}
        {parts.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            Recording parts (reconnections):
            {parts.map((p, i) => (
              <button key={p.part_index} type="button" onClick={() => setActive(i)} className={`rounded px-1.5 py-0.5 ${i === active ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>{i + 1}</button>
            ))}
          </div>
        )}
      </div>
    );
  },
);
