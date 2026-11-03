import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpegPath, ffmpegVersion, parseFfmpegVersion, probeDurationMs, transcode, transcodeArgs, writeChunk } from "@/lib/recordings/ffmpeg";
import { checkDuration } from "@/lib/recordings/pipeline";

describe("ffmpeg arguments", () => {
  it("parses release versions and ignores git snapshots", () => {
    expect(parseFfmpegVersion("ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/")).toEqual([7, 0]);
    expect(parseFfmpegVersion("ffmpeg version n6.1.1 Copyright (c) 2000-2023")).toEqual([6, 1]);
    expect(parseFfmpegVersion("ffmpeg version N-112345-gabcdef")).toBeNull();
  });

  it("never lets ffmpeg guess the input format or use the network", () => {
    const video = transcodeArgs("pipe:0", "out.mp4", "video", "webm", { crf: 27, audioKbps: 64 });
    const i = video.indexOf("-i");
    expect(video.slice(0, i).join(" ")).toContain("-f matroska");
    expect(video[video.indexOf("-protocol_whitelist") + 1]).toBe("file,pipe");
    expect(video[i + 1]).toBe("pipe:0");

    const mp4 = transcodeArgs("in.mp4", "out.mp4", "video", "mp4", { crf: 27, audioKbps: 64 });
    expect(mp4.slice(0, mp4.indexOf("-i")).join(" ")).toContain("-f mov");

    const audio = transcodeArgs("in.webm", "out.m4a", "audio", "webm", { crf: 27, audioKbps: 48 });
    expect(audio).toContain("-vn");
    expect(audio.join(" ")).toContain("-b:a 48k");
    expect(audio.join(" ")).not.toContain("libx264");
  });

  it("rejects an encoded file much shorter than the recording", () => {
    expect(() => checkDuration(null, 60)).toThrow(/no duration/);
    expect(() => checkDuration(20_000, 60)).toThrow(/20s but the recording is 60s/);
    expect(() => checkDuration(58_000, 60)).not.toThrow();
    expect(() => checkDuration(3_000, 5)).not.toThrow(); // too short to judge
  });
});

// Real encodes with the bundled ffmpeg (skipped when it isn't installed).
const hasFfmpeg = spawnSync(ffmpegPath(), ["-version"]).status === 0;

describe.runIf(hasFfmpeg)("ffmpeg encoding", () => {
  let dir = "";
  let webm: Uint8Array;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ffmpeg-test-"));
    const src = path.join(dir, "src.webm");
    // A 6 s 1080p camera-like recording, as MediaRecorder would produce (VP8 + Opus in WebM).
    const r = spawnSync(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=sample_rate=48000",
      "-t", "6", "-c:v", "libvpx", "-b:v", "350k", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", src]);
    expect(r.status).toBe(0);
    webm = new Uint8Array(await readFile(src));
  }, 60_000);

  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("is a supported version", async () => {
    const { version } = await ffmpegVersion();
    expect(version && (version[0] > 5 || (version[0] === 5 && version[1] >= 1))).toBeTruthy();
  });

  it("encodes chunks streamed into stdin to a 720p MP4 of the same length", async () => {
    const out = path.join(dir, "out.mp4");
    const size = Math.ceil(webm.byteLength / 7);
    await transcode({
      feed: async (stdin) => { for (let i = 0; i < webm.byteLength; i += size) await writeChunk(stdin, webm.subarray(i, i + size)); },
    }, out, "video", "webm", { crf: 27, timeoutMs: 60_000, audioKbps: 64 });
    const ms = await probeDurationMs(out);
    expect(ms).toBeGreaterThan(5_500);
    expect(ms).toBeLessThan(6_500);
    const info = spawnSync(ffmpegPath(), ["-hide_banner", "-i", out], { encoding: "utf8" }).stderr;
    expect(info).toMatch(/h264 .* 1280x720/);
    expect(info).toMatch(/Audio: aac/);
    // A keyframe at least every ~2 s, so a jump never decodes a long run of video first.
    const keyframes = spawnSync(ffmpegPath(), ["-hide_banner", "-skip_frame", "nokey", "-i", out, "-map", "0:v:0", "-vf", "showinfo", "-f", "null", "-"], { encoding: "utf8" })
      .stderr.match(/pts_time:[\d.]+/g)!.map((m) => Number(m.slice(9)));
    expect(keyframes.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...keyframes.slice(1).map((t, i) => t - keyframes[i]))).toBeLessThanOrEqual(2.5);
  }, 60_000);

  it("refuses a playlist disguised as a recording", async () => {
    const evil = path.join(dir, "evil.webm");
    await writeFile(evil, "#EXTM3U\n#EXTINF:10,\nhttp://169.254.169.254/latest/meta-data/\n#EXT-X-ENDLIST\n");
    await expect(transcode({ file: evil }, path.join(dir, "evil.mp4"), "video", "webm", { crf: 27, timeoutMs: 30_000, audioKbps: 64 }))
      .rejects.toThrow(/ffmpeg exited/);
  });

  it("stops ffmpeg and reports the download error when the feed fails", async () => {
    const started = Date.now();
    await expect(transcode({
      feed: async (stdin) => { await writeChunk(stdin, webm.subarray(0, 50_000)); throw new Error("chunk download failed"); },
    }, path.join(dir, "broken.mp4"), "video", "webm", { crf: 27, timeoutMs: 60_000, audioKbps: 64 })).rejects.toThrow("chunk download failed");
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
