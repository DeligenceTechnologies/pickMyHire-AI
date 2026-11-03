"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { RotateCw, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export type RecordingPart = { part_index: number; key?: string; offset_ms: number; duration_seconds: number | null; mime_type: string; url: string };
export type VideoPlayerHandle = { seek: (ms: number, play?: boolean) => void };
/** Fetches fresh playback URLs (signed URLs expire). Resolves to the new parts, or null if that failed. */
export type RefreshRecording = () => Promise<{ parts: RecordingPart[]; voice: RecordingPart[] } | null>;

/** Thin ring spinner for the dark video area. */
function Spinner({ className = "size-9" }: { className?: string }) {
  return <span aria-hidden className={`block shrink-0 animate-spin rounded-full border-2 border-white/15 border-t-white motion-reduce:animate-none ${className}`} />;
}

/** The empty video area while something loads: the same look before the URLs arrive and while the file opens. */
function LoadingStage({ title, detail, slowHint, className = "" }: { title: string; detail?: string; slowHint?: string; className?: string }) {
  return (
    <div className={`video-shimmer flex flex-col items-center justify-center gap-3 overflow-hidden bg-linear-to-b from-neutral-900 to-black px-6 text-center text-white ${className}`}>
      <span className="video-bar" aria-hidden />
      <Spinner />
      <div className="space-y-1">
        <p className="text-sm font-medium tracking-wide">{title}</p>
        {detail && <p className="text-xs text-white/60">{detail}</p>}
      </div>
      {slowHint && <p className="video-loading-slow max-w-xs text-xs text-white/55">{slowHint}</p>}
    </div>
  );
}

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
export const VideoPlayer = forwardRef<VideoPlayerHandle, { parts: RecordingPart[] | null; voice?: RecordingPart[] | null; error?: string | null; onTime?: (ms: number) => void; onRefresh?: RefreshRecording }>(
  function VideoPlayer({ parts, voice, error, onTime, onRefresh }, ref) {
    const video = useRef<HTMLVideoElement>(null);
    const audio = useRef<HTMLAudioElement>(null);
    const [active, setActive] = useState(0);
    const [voiceIdx, setVoiceIdx] = useState(-1);
    const pendingSeek = useRef<{ sec: number; play: boolean } | null>(null);
    const current = parts?.[active];
    // The video (by URL) that is ready to be shown, one that failed to load, and the interview time being jumped to.
    const [ready, setReady] = useState<string | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [target, setTarget] = useState<number | null>(null);
    /** True while the duration workaround below jumps to the end and back. */
    const findingLength = useRef(false);
    const voicePart = voiceIdx >= 0 ? voice?.[voiceIdx] : undefined;
    /**
     * When each part last had its URLs refreshed after an error. A fresh URL that
     * fails again soon after is a real failure (broken file), not an expired link:
     * show the error instead of refreshing in a loop.
     */
    const lastRefresh = useRef(new Map<string, number>());
    const mayRefresh = (key: string) => {
      const now = Date.now();
      if (now - (lastRefresh.current.get(key) ?? 0) < 60_000) return false;
      lastRefresh.current.set(key, now);
      return true;
    };

    /**
     * Fetch fresh URLs. Every part gets a new URL, so the <video> (keyed by URL)
     * remounts: remember where it was, and the jump is applied once it has loaded.
     * Returns false if the URLs couldn't be fetched or didn't change.
     */
    const refreshUrls = useCallback(async (url: string, partIndex: number) => {
      if (!onRefresh) return false;
      const v = video.current;
      const resume = pendingSeek.current ?? (v ? { sec: v.currentTime, play: !v.paused && !v.ended } : null);
      const fresh = await onRefresh();
      const next = fresh?.parts.find((p) => p.part_index === partIndex);
      if (!next || next.url === url) return false;
      pendingSeek.current = resume;
      return true;
    }, [onRefresh]);

    /** A load error is usually an expired signed URL (they last an hour): refresh once, else show the error. */
    const recoverVideo = useCallback(async (url: string, partIndex: number) => {
      if (mayRefresh(`video-${partIndex}`) && (await refreshUrls(url, partIndex))) return;
      setFailed(url);
    }, [refreshUrls]);

    /** The interviewer's voice failed to load: refresh once; the new <audio> re-syncs once loaded. */
    const recoverVoice = useCallback(async (voiceIndex: number) => {
      if (!current || !mayRefresh(`voice-${voiceIndex}`)) return;
      await refreshUrls(current.url, current.part_index);
    }, [refreshUrls, current]);

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

    /** Shown anyway after this long, so a browser that won't preload (iOS) still gets a player to tap. */
    const [gaveUp, setGaveUp] = useState<string | null>(null);
    useEffect(() => {
      const url = current?.url;
      if (!url) return;
      const t = setTimeout(() => setGaveUp(url), 15_000);
      return () => clearTimeout(t);
    }, [current?.url]);

    if (error) {
      return <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl bg-muted text-sm text-muted-foreground"><VideoOff className="size-6" />{error}</div>;
    }
    if (parts && (!parts.length || !current)) {
      return <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl bg-muted text-sm text-muted-foreground"><VideoOff className="size-6" />No recording available</div>;
    }
    /**
     * The video is shown only once it can play straight through from the right moment
     * (HAVE_ENOUGH_DATA): not mid-jump (an evidence link, ?t=), not while the duration
     * workaround runs, and with enough buffered that pressing play never stalls. It
     * reaches that within a moment of its first frame, so this costs no visible time.
     * Until then it loads hidden behind the stage; after that nothing covers it.
     */
    const playable = () => {
      const v = video.current;
      if (!v || !current || findingLength.current || v.seeking || v.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) return;
      setReady(current.url); setTarget(null);
    };
    const loaded = !!current && (ready === current.url || gaveUp === current.url);
    const isFailed = !!current && failed === current.url;
    // One stage from "Preparing" (fetching links) until the video is ready: the same element the
    // whole time, so it never flickers or swaps its message; it fades out once, over the picture.
    const staging = !isFailed && (!current || !loaded);
    return (
      <div className="space-y-2">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
          {current && (
            <video
              ref={video}
              key={current.url}
              src={current.url}
              controls
              // Buffer ahead as soon as it opens, so pressing play starts at once (recordings are ~300 kbps).
              preload="auto"
              playsInline
              aria-hidden={staging || undefined}
              className={`absolute inset-0 h-full w-full bg-black transition-opacity duration-200 motion-reduce:transition-none ${staging ? "opacity-0" : "opacity-100"}`}
              onTimeUpdate={(e) => { onTime?.(current.offset_ms + e.currentTarget.currentTime * 1000); syncVoice(); }}
              onPlay={syncVoice}
              onPause={syncVoice}
              onSeeking={syncVoice}
              onSeeked={() => { playable(); syncVoice(); }}
              // Runs after the duration workaround has had its turn on the same event.
              onLoadedMetadata={() => setTimeout(playable, 0)}
              onLoadedData={playable}
              onCanPlay={playable}
              onCanPlayThrough={playable}
              onPlaying={playable}
              onError={() => void recoverVideo(current.url, current.part_index)}
              onRateChange={syncVoice}
              onVolumeChange={syncVoice}
              onEnded={() => { if (active < (parts?.length ?? 0) - 1) { pendingSeek.current = { sec: 0, play: true }; setActive(active + 1); } }}
            />
          )}
          <div role="status" aria-live="polite" aria-hidden={!staging || undefined}
            className={`pointer-events-none absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none ${staging ? "opacity-100" : "opacity-0"}`}>
            <LoadingStage
              className="absolute inset-0"
              title="Preparing recording"
              detail={[
                target != null ? `Opening at ${clock(target)}` : null,
                parts && parts.length > 1 ? `Part ${active + 1} of ${parts.length}` : null,
              ].filter(Boolean).join(" · ") || undefined}
              slowHint="Long recordings can take a few seconds to load."
            />
          </div>
          {current && isFailed && (
            <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 px-4 text-center text-white">
              <VideoOff className="size-7" />
              <p className="text-sm font-medium">The video couldn&apos;t load.</p>
              <Button size="sm" variant="secondary" onClick={() => {
                const url = current.url;
                setFailed(null); setReady(null);
                // Fresh URLs first (the old one may have expired); if they're unchanged, reload in place.
                void refreshUrls(url, current.part_index).then((remounting) => { if (!remounting) video.current?.load(); });
              }}>
                <RotateCw /> Try again
              </Button>
            </div>
          )}
        </div>
        {voicePart && <audio ref={audio} key={voicePart.url} src={voicePart.url} preload="auto" className="hidden" aria-hidden onError={() => void recoverVoice(voicePart.part_index)} />}
        {parts && parts.length > 1 && (
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
