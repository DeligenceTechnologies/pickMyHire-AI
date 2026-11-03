import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Encodes into a throwaway local storage folder; chunks may be purged at once.
const storageDir = mkdtempSync(path.join(tmpdir(), "rec-pipeline-"));
process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_STORAGE_DIR = storageDir;
process.env.RECORDING_CHUNK_RETENTION_HOURS = "0";

const { withSystem } = await import("@/lib/database/db");
const { generateToken, hashToken } = await import("@/lib/security/tokens");
const { finalizeAllParts, recordingForViewer, recordingUrls, startRecordingPart, uploadRecordingChunk, MAX_CHUNKS_PER_PART } = await import("@/lib/interview/recording");
const { findDueRecordingWork, purgeRecordingChunks, transcodeRecording } = await import("@/lib/recordings/pipeline");
const { ffmpegPath } = await import("@/lib/recordings/ffmpeg");
const { storage, paths } = await import("@/lib/storage");

const hasFfmpeg = spawnSync(ffmpegPath(), ["-version"]).status === 0;
const id = Date.now().toString(36);
let orgId = "";
let interviewId = "";
let token = "";
let chunks: Uint8Array[] = [];

async function recording() {
  const [r] = await withSystem((tx) => tx<{ id: string; playback_status: string; playback_path: string | null; playback_chunks: number | null; chunks_received: number; chunks_purged_at: Date | null; playback_attempts: number }[]>`
    select id, playback_status, playback_path, playback_chunks, chunks_received, chunks_purged_at, playback_attempts from recordings where interview_id = ${interviewId}`);
  return r;
}

describe.runIf(hasFfmpeg)("recording pipeline", () => {
  beforeAll(async () => {
    // A 12 s recording cut into 4 s pieces, the way the browser uploads it.
    const src = path.join(storageDir, "src.webm");
    const r = spawnSync(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x480:rate=30", "-f", "lavfi", "-i", "sine=sample_rate=48000",
      "-t", "12", "-c:v", "libvpx", "-b:v", "350k", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", src]);
    expect(r.status).toBe(0);
    const data = new Uint8Array(readFileSync(src));
    const size = Math.ceil(data.byteLength / 6);
    chunks = Array.from({ length: 6 }, (_, i) => data.subarray(i * size, (i + 1) * size));

    token = generateToken();
    await withSystem(async (tx) => {
      const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug) values (${`Rec Co ${id}`}, ${`rec-co-${id}`}) returning id`;
      orgId = o.id;
      const [j] = await tx<{ id: string }[]>`insert into jobs (organization_id, title, status) values (${orgId}, 'Rec job', 'active') returning id`;
      const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${orgId}, 'Rec Cand', ${`rec-${id}@pipeline.test`}) returning id`;
      const [iv] = await tx<{ id: string }[]>`
        insert into interviews (organization_id, job_id, candidate_id, secure_token_hash, status, consent_given, started_at)
        values (${orgId}, ${j.id}, ${c.id}, ${hashToken(token)}, 'in_progress', true, now() - interval '1 minute') returning id`;
      interviewId = iv.id;
    });
  }, 60_000);

  afterAll(async () => {
    if (orgId) await withSystem((tx) => tx`delete from organizations where id = ${orgId}`);
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("re-encodes a part that got chunks after its file was made, and only then deletes the chunks", async () => {
    const { part_index: part } = await startRecordingPart(token, { offset_ms: 0, mime_type: "video/webm;codecs=vp8,opus" });
    for (let i = 0; i < 4; i++) expect(await uploadRecordingChunk(token, part, i, chunks[i])).toEqual({ stored: true });

    // The interview closes while the last two chunks are still uploading.
    await withSystem((tx) => tx`update interviews set status = 'completed', completed_at = now() where id = ${interviewId}`);
    await finalizeAllParts(orgId, interviewId);
    const first = await transcodeRecording(orgId, (await recording()).id);
    expect(first.outcome).toBe("ready");
    expect(await recording()).toMatchObject({ playback_status: "ready", playback_chunks: 4, chunks_received: 4 });

    // The late chunks arrive: the file no longer matches the chunks.
    for (let i = 4; i < 6; i++) expect(await uploadRecordingChunk(token, part, i, chunks[i])).toEqual({ stored: true });
    const rec = await recording();
    const [stale] = await recordingUrls(orgId, interviewId);
    expect(stale.url).toBe(`/api/recordings/${rec.id}/stream`); // complete chunks, not the short file
    expect(await purgeRecordingChunks(orgId, rec.id)).toEqual({ purged: false, reason: "file is older than the chunks" });
    expect((await findDueRecordingWork()).transcode.map((w) => w.recordingId)).toContain(rec.id);

    // Encoded again from all six chunks; the old file is removed.
    const second = await transcodeRecording(orgId, rec.id);
    expect(second.outcome).toBe("ready");
    if (second.outcome === "ready") expect(second.durationMs).toBeGreaterThan(11_000);
    if (first.outcome === "ready") expect(await storage().exists(first.path)).toBe(false);
    expect(await recording()).toMatchObject({ playback_chunks: 6, chunks_received: 6, playback_attempts: 2 });
    const [ready] = await recordingUrls(orgId, interviewId);
    expect(ready.mime_type).toBe("video/mp4");
    expect(ready.url).toContain("/api/storage/object?");

    // A file encoded before chunk counts were recorded still plays (fast) while it's
    // encoded again, but its chunks are kept until that's done.
    await withSystem((tx) => tx`update recordings set playback_chunks = null, playback_source_bytes = null where id = ${rec.id}`);
    expect((await recordingUrls(orgId, interviewId))[0].mime_type).toBe("video/mp4");
    expect(await purgeRecordingChunks(orgId, rec.id)).toEqual({ purged: false, reason: "file is older than the chunks" });
    await withSystem((tx) => tx`update recordings set playback_status = 'processing' where id = ${rec.id}`);
    expect((await recordingUrls(orgId, interviewId))[0].url).toContain("/api/storage/object?"); // previous file while encoding
    await withSystem((tx) => tx`update recordings set playback_status = 'failed', playback_started_at = now() - interval '2 hours' where id = ${rec.id}`);
    const third = await transcodeRecording(orgId, rec.id);
    expect(third.outcome).toBe("ready");
    if (second.outcome === "ready") expect(await storage().exists(second.path)).toBe(false);
    expect(await recording()).toMatchObject({ playback_chunks: 6, chunks_received: 6 });

    // Now the chunks can go; the file stays.
    expect((await findDueRecordingWork()).purge.map((w) => w.recordingId)).toContain(rec.id);
    expect(await purgeRecordingChunks(orgId, rec.id)).toEqual({ purged: true });
    expect((await recording()).chunks_purged_at).not.toBeNull();
    expect(await storage().list(paths.recordingChunkPrefix(orgId, interviewId, part))).toEqual([]);
    const [{ n }] = await withSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from recording_chunks where recording_id = ${rec.id}`);
    expect(n).toBe(0);
    if (third.outcome === "ready") expect(await storage().exists(third.path)).toBe(true);

    // A chunk after cleanup is refused and leaves nothing behind; nothing is due any more.
    expect(await uploadRecordingChunk(token, part, 6, chunks[0])).toEqual({ stored: false });
    expect(await storage().list(paths.recordingChunkPrefix(orgId, interviewId, part))).toEqual([]);
    const due = await findDueRecordingWork();
    expect(due.transcode.map((w) => w.recordingId)).not.toContain(rec.id);
    expect(due.purge.map((w) => w.recordingId)).not.toContain(rec.id);
    expect(await transcodeRecording(orgId, rec.id)).toEqual({ outcome: "skipped", reason: "chunks already deleted" });
  }, 120_000);

  it("gives the viewer the video and voice, recording one audit entry per 10 minutes", async () => {
    const [u] = await withSystem((tx) => tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`viewer-${id}@pipeline.test`}, 'Viewer', 'x') returning id`);
    try {
      const first = await recordingForViewer(orgId, u.id, interviewId);
      expect(first.parts).toHaveLength(1);
      expect(first.voice).toHaveLength(0);
      expect(first.parts[0].key).toMatch(/:part-0-v\d+\.mp4$/);
      const again = await recordingForViewer(orgId, u.id, interviewId); // a page refresh
      expect(again.parts[0].key).toBe(first.parts[0].key); // same file, same key: the player won't reload
      const [{ n }] = await withSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from audit_logs
        where organization_id = ${orgId} and user_id = ${u.id} and action = 'interview.recording_accessed'`);
      expect(n).toBe(1);
    } finally {
      await withSystem((tx) => tx`delete from users where id = ${u.id}`);
    }
  });

  it("refuses chunks beyond the per-part limit", async () => {
    await expect(uploadRecordingChunk(token, 0, MAX_CHUNKS_PER_PART, chunks[0])).rejects.toMatchObject({ status: 409 });
  });
});
