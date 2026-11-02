import "server-only";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { env } from "@/lib/env";

let binary: string | null = null;

/** FFMPEG_PATH, else the static build shipped by @ffmpeg-installer/ffmpeg, else `ffmpeg` on PATH. */
export function ffmpegPath(): string {
  if (binary) return binary;
  const configured = env().FFMPEG_PATH;
  if (configured) return (binary = configured);
  try {
    const req = createRequire(import.meta.url);
    binary = (req("@ffmpeg-installer/ffmpeg") as { path: string }).path;
  } catch {
    binary = "ffmpeg";
  }
  return binary;
}

type RunResult = { code: number | null; stderr: string };

function run(args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    // Keep only the tail: ffmpeg's progress output on long files is large.
    child.stderr.on("data", (d: string) => { stderr = (stderr + d).slice(-16_000); });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGKILL") return reject(new Error(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)}s`));
      resolve({ code, stderr });
    });
  });
}

export type TranscodeKind = "video" | "audio";

/**
 * Re-encode the joined browser chunks into a file every browser can play and
 * seek at once: H.264/AAC MP4 (or AAC M4A for voice-only parts) with the index
 * at the front (`+faststart`).
 *
 * - `-reinit_filter 0`: Chrome may change the camera resolution mid-recording;
 *   keep one output size instead of failing the encode.
 * - `-vsync vfr`: MediaRecorder WebM declares a 250 fps time base; without this
 *   ffmpeg duplicates every frame up to 250 fps (≈12× the frames, slower and bigger).
 * - `-maxrate/-bufsize`: caps noisy camera footage so the file stays smaller than the upload.
 * - `aresample=async=1`: closes small audio gaps MediaRecorder leaves, keeping lips in sync.
 */
export async function transcode(input: string, output: string, kind: TranscodeKind, opts: { crf: number; timeoutMs: number; audioKbps: number }) {
  const common = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-fflags", "+genpts+discardcorrupt"];
  const audio = ["-af", "aresample=async=1", "-c:a", "aac", "-b:a", `${opts.audioKbps}k`, "-ac", "1"];
  const args = kind === "video"
    ? [
        ...common, "-reinit_filter", "0", "-i", input,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-vsync", "vfr",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", String(opts.crf), "-maxrate", "400k", "-bufsize", "800k", "-profile:v", "main",
        ...audio, "-max_muxing_queue_size", "4096", "-movflags", "+faststart", output,
      ]
    : [...common, "-i", input, "-vn", "-map", "0:a:0", ...audio, "-movflags", "+faststart", output];
  const { code, stderr } = await run(args, opts.timeoutMs);
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}: ${stderr.trim().slice(-800) || "no output"}`);
}

/** Duration of a media file in ms, read from ffmpeg's header dump (no decoding). Null if unknown. */
export async function probeDurationMs(file: string): Promise<number | null> {
  // With no output ffmpeg prints the input header and exits non-zero; that's expected.
  const { stderr } = await run(["-hide_banner", "-nostdin", "-i", file], 60_000);
  const m = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!m) return null;
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
}
