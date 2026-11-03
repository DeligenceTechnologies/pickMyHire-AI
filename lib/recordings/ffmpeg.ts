import "server-only";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import type { Writable } from "node:stream";
import { env } from "@/lib/env";

let binary: string | null = null;

/** FFMPEG_PATH, else the static build shipped by ffmpeg-static, else `ffmpeg` on PATH. */
export function ffmpegPath(): string {
  if (binary) return binary;
  const configured = env().FFMPEG_PATH;
  if (configured) return (binary = configured);
  try {
    const req = createRequire(import.meta.url);
    const p = req("ffmpeg-static") as string | null;
    binary = p || "ffmpeg";
  } catch {
    binary = "ffmpeg";
  }
  return binary;
}

/** Oldest ffmpeg the arguments below work with (`-fps_mode` arrived in 5.1). */
export const MIN_FFMPEG_VERSION: [number, number] = [5, 1];

/** "ffmpeg version 7.0.2-static …" → [7, 0]. Null for builds without a release number (git snapshots). */
export function parseFfmpegVersion(output: string): [number, number] | null {
  const m = output.match(/ffmpeg version n?(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

type RunResult = { code: number | null; stderr: string };

/**
 * Run ffmpeg. With `feed`, the input is written to ffmpeg's stdin while it
 * encodes (downloading and encoding overlap). A failed feed kills ffmpeg; a
 * failed ffmpeg ends the feed (writes to a closed pipe are ignored).
 */
function run(args: string[], timeoutMs: number, feed?: (stdin: Writable) => Promise<void>): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: [feed ? "pipe" : "ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    let feedError: unknown = null;
    const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    child.stderr!.setEncoding("utf8");
    // Keep only the tail: ffmpeg's output on long or broken files is large.
    child.stderr!.on("data", (d: string) => { stderr = (stderr + d).slice(-16_000); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", (err) => finish(() => reject(err)));
    child.on("close", (code, signal) => finish(() => {
      if (feedError) return reject(feedError);
      if (signal === "SIGKILL") return reject(new Error(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)}s`));
      resolve({ code, stderr });
    }));
    if (feed) {
      const stdin = child.stdin!;
      // EPIPE when ffmpeg exits early: its exit code and stderr explain why.
      stdin.on("error", () => {});
      feed(stdin).then(
        () => stdin.end(),
        (err) => { feedError = err; child.kill("SIGKILL"); },
      );
    }
  });
}

/** Write to a pipe, waiting when it's full (ffmpeg is slower than the download). */
export function writeChunk(stdin: Writable, data: Uint8Array): Promise<void> {
  if (stdin.destroyed || stdin.writableEnded) return Promise.reject(new Error("ffmpeg stopped reading its input"));
  if (stdin.write(data)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { stdin.off("drain", onDrain); stdin.off("close", onClose); };
    const onDrain = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new Error("ffmpeg stopped reading its input")); };
    stdin.once("drain", onDrain);
    stdin.once("close", onClose);
  });
}

/** Major.minor of the configured ffmpeg, or null if it can't be run. */
export async function ffmpegVersion(): Promise<{ raw: string; version: [number, number] | null }> {
  const child = spawn(ffmpegPath(), ["-hide_banner", "-version"], { stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d: string) => { out += d; });
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });
  const raw = out.split("\n")[0]?.trim() ?? "";
  return { raw, version: parseFfmpegVersion(raw) };
}

export type TranscodeKind = "video" | "audio";
/** Container of the browser recording. Forced on ffmpeg so it never guesses the format from the bytes. */
export type SourceFormat = "webm" | "mp4";

/** Seconds between keyframes: the most video a seek has to fetch and decode before showing a picture. */
export const KEYFRAME_SECONDS = 2;

/** Longest side of the playable video: 720p is plenty for an interview and encodes much faster. */
export const MAX_VIDEO_SIDE = 1280;

/**
 * ffmpeg arguments that re-encode a browser recording into a file every browser
 * can play and seek at once: H.264/AAC MP4 (or AAC M4A for voice-only parts)
 * with the index at the front (`+faststart`).
 *
 * Safety — the input comes from the candidate's browser and is untrusted:
 * - `-f matroska|mov` fixes the demuxer. Without it ffmpeg detects the format
 *   from the content, so crafted bytes (an HLS/concat playlist) could make it
 *   fetch URLs or read local files.
 * - `-protocol_whitelist file,pipe`: no network access whatsoever.
 *
 * Encoding:
 * - `-reinit_filter 0`: Chrome may change the camera resolution mid-recording;
 *   keep one output size instead of failing the encode.
 * - scale: never larger than 720p (never upscaled), even dimensions for H.264.
 * - `-fps_mode vfr`: MediaRecorder WebM has no fixed frame rate; without this
 *   ffmpeg may duplicate frames up to a guessed constant rate (slower and bigger).
 * - `-maxrate/-bufsize`: caps noisy camera footage so the file stays small.
 * - `-force_key_frames` every 2 s: x264's default spaces keyframes 10–15 s
 *   apart, so every jump (scrubbing, a transcript click) had to download and
 *   decode up to 15 s of video first. With 2 s, seeking is near-instant for
 *   about 10% more bytes.
 * - `aresample=async=1`: closes small audio gaps MediaRecorder leaves, keeping lips in sync.
 */
export function transcodeArgs(input: string, output: string, kind: TranscodeKind, format: SourceFormat, opts: { crf: number; audioKbps: number }) {
  const common = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-fflags", "+genpts+discardcorrupt"];
  const demuxer = ["-f", format === "webm" ? "matroska" : "mov"];
  const audio = ["-af", "aresample=async=1", "-c:a", "aac", "-b:a", `${opts.audioKbps}k`, "-ac", "1"];
  const strip = ["-sn", "-dn", "-map_metadata", "-1"];
  if (kind === "audio") {
    return [...common, ...demuxer, "-i", input, "-vn", "-map", "0:a:0", ...audio, ...strip, "-movflags", "+faststart", output];
  }
  const side = MAX_VIDEO_SIDE;
  const scale = `scale='min(${side},iw)':'min(${side},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p`;
  return [
    ...common, "-reinit_filter", "0", ...demuxer, "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", scale, "-fps_mode", "vfr",
    "-c:v", "libx264", "-preset", "superfast", "-crf", String(opts.crf), "-maxrate", "400k", "-bufsize", "800k", "-profile:v", "main",
    "-force_key_frames", `expr:gte(t,n_forced*${KEYFRAME_SECONDS})`,
    ...audio, ...strip, "-max_muxing_queue_size", "4096", "-movflags", "+faststart", output,
  ];
}

/**
 * Encode a browser recording. `input` is either a local file or a function
 * that streams the recording into ffmpeg's stdin (WebM only: MP4 needs seeking).
 */
export async function transcode(
  input: { file: string } | { feed: (stdin: Writable) => Promise<void> },
  output: string,
  kind: TranscodeKind,
  format: SourceFormat,
  opts: { crf: number; timeoutMs: number; audioKbps: number },
) {
  const piped = "feed" in input;
  if (piped && format !== "webm") throw new Error("Only WebM recordings can be streamed into ffmpeg");
  const args = transcodeArgs(piped ? "pipe:0" : input.file, output, kind, format, opts);
  const { code, stderr } = await run(args, opts.timeoutMs, piped ? input.feed : undefined);
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}: ${stderr.trim().slice(-800) || "no output"}`);
}

/** Duration of a media file in ms, read from ffmpeg's header dump (no decoding). Null if unknown. */
export async function probeDurationMs(file: string): Promise<number | null> {
  // With no output ffmpeg prints the input header and exits non-zero; that's expected.
  const { stderr } = await run(["-hide_banner", "-nostdin", "-protocol_whitelist", "file", "-i", file], 60_000);
  const m = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!m) return null;
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
}
