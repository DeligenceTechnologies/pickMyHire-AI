import "server-only";
// Turns a recording part's uploaded chunks into one playable file, and later
// removes the chunks. Every step is idempotent and safe to retry: a job that
// runs twice, or after the recording was deleted, does no harm.
//
//   pending ──transcode──▶ processing ──▶ ready ──(retention window)──▶ chunks purged
//                                    └──▶ failed  (retried; chunks keep playback working)
//                                    └──▶ skipped (file too large for the storage plan; chunk playback stays)

import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { withOrg, withSystem } from "@/lib/database/db";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { ObjectTooLargeError, paths, storage } from "@/lib/storage";
import { probeDurationMs, transcode, type TranscodeKind } from "./ffmpeg";

/** Chunks downloaded in parallel while joining a part. */
const DOWNLOAD_CONCURRENCY = 8;
/** Attempts before the sweep stops re-queuing a failed part. */
export const MAX_PLAYBACK_ATTEMPTS = 5;
/** A part stuck in "processing" this long (worker crashed) is picked up again. */
const STUCK_PROCESSING_MINUTES = 60;
/** Interviews in these states are over: their recordings won't get more chunks. */
const FINISHED = ["completed", "processing", "report_ready", "cancelled", "expired", "failed"];

/** Thrown when retrying is pointless; the queue marks the job failed without retries. */
export class PermanentRecordingError extends Error {}

type Rec = {
  id: string;
  interview_id: string;
  part_index: number;
  track: "candidate" | "interviewer";
  mime_type: string;
  status: string;
  storage_path: string;
  duration_seconds: number | null;
  playback_status: string;
  playback_path: string | null;
};

export type TranscodeResult =
  | { outcome: "ready"; path: string; bytes: number; durationMs: number; ms: number }
  | { outcome: "skipped"; reason: string };

async function loadRecording(orgId: string, recordingId: string) {
  const [rec] = await withOrg(orgId, (tx) => tx<Rec[]>`
    select id, interview_id, part_index, track, mime_type, status::text, storage_path, duration_seconds, playback_status, playback_path
    from recordings where id = ${recordingId} and organization_id = ${orgId}`);
  return rec ?? null;
}

/** Write the part's chunks, in order, into one local file (downloaded several at a time). */
async function downloadChunks(orgId: string, rec: Rec, dest: string): Promise<number> {
  const chunks = await withOrg(orgId, (tx) => tx<{ storage_path: string }[]>`
    select storage_path from recording_chunks where recording_id = ${rec.id} order by chunk_index`);
  const fh = await open(dest, "w");
  let bytes = 0;
  try {
    if (!chunks.length) {
      // Recordings from before chunked uploads are already a single object.
      if (!(await storage().exists(rec.storage_path))) throw new PermanentRecordingError("Recording has no chunks and no stored file");
      const data = await storage().get(rec.storage_path);
      await fh.write(data);
      return data.byteLength;
    }
    for (let i = 0; i < chunks.length; i += DOWNLOAD_CONCURRENCY) {
      const batch = await Promise.all(chunks.slice(i, i + DOWNLOAD_CONCURRENCY).map((c) => downloadWithRetry(c.storage_path)));
      for (const data of batch) {
        await fh.write(data);
        bytes += data.byteLength;
      }
    }
    return bytes;
  } finally {
    await fh.close();
  }
}

async function downloadWithRetry(p: string): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await storage().get(p);
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

/** Browser recordings report their own length; the encoded file must not be much shorter. */
function checkDuration(durationMs: number | null, expectedSeconds: number | null) {
  if (!durationMs || durationMs <= 0) throw new Error("Encoded file has no duration");
  if (expectedSeconds && expectedSeconds > 10 && durationMs < expectedSeconds * 1000 * 0.8 - 5000) {
    throw new Error(`Encoded file is ${Math.round(durationMs / 1000)}s but the recording is ${expectedSeconds}s`);
  }
}

/**
 * Join one part's chunks and encode them into a playable MP4/M4A, upload it and
 * mark the part ready. Chunks are left in place (see `purgeRecordingChunks`).
 */
export async function transcodeRecording(orgId: string, recordingId: string): Promise<TranscodeResult> {
  const rec = await loadRecording(orgId, recordingId);
  if (!rec || rec.status !== "stored") return { outcome: "skipped", reason: rec ? `recording is ${rec.status}` : "recording not found" };
  if (rec.playback_status === "ready" && rec.playback_path) return { outcome: "skipped", reason: "already ready" };
  if (rec.playback_status === "skipped") return { outcome: "skipped", reason: "previously skipped" };

  const [{ attempt }] = await withOrg(orgId, (tx) => tx<{ attempt: number }[]>`update recordings set playback_status = 'processing',
    playback_started_at = now(), playback_attempts = playback_attempts + 1, playback_error = null
    where id = ${rec.id} returning playback_attempts as attempt`);

  const started = Date.now();
  const kind: TranscodeKind = rec.track === "interviewer" || rec.mime_type.startsWith("audio/") ? "audio" : "video";
  const ext = kind === "video" ? "mp4" : "m4a";
  const mime = kind === "video" ? "video/mp4" : "audio/mp4";
  const dest = paths.recordingPlayback(orgId, rec.interview_id, rec.part_index, attempt, ext);
  const work = await mkdtemp(path.join(tmpdir(), "rec-"));
  try {
    const input = path.join(work, rec.mime_type.includes("mp4") ? "input.mp4" : "input.webm");
    const output = path.join(work, `output.${ext}`);
    const inputBytes = await downloadChunks(orgId, rec, input);
    if (inputBytes === 0) throw new PermanentRecordingError("Recording is empty");

    const expectedMs = (rec.duration_seconds ?? 0) * 1000;
    // Generous: veryfast x264 runs many times faster than real time.
    const timeoutMs = Math.min(3 * 3600_000, Math.max(15 * 60_000, expectedMs * 2));
    // The interviewer track is a synthetic voice: 48 kbps mono AAC is transparent for it.
    const audioKbps = rec.track === "interviewer" ? 48 : 64;
    await transcode(input, output, kind, { crf: env().RECORDING_CRF, timeoutMs, audioKbps });

    const durationMs = await probeDurationMs(output);
    checkDuration(durationMs, rec.duration_seconds);
    const { size } = await stat(output);
    if (size <= 0) throw new Error("Encoded file is empty");

    await storage().putFile(dest, output, mime);
    if (!(await storage().exists(dest))) throw new Error("Uploaded file is not readable back from storage");

    const updated = await withOrg(orgId, (tx) => tx`update recordings set playback_status = 'ready', playback_path = ${dest},
      playback_mime = ${mime}, playback_size = ${size}, playback_duration_ms = ${durationMs}, playback_ready_at = now(),
      playback_error = null, duration_seconds = coalesce(duration_seconds, ${Math.round(durationMs! / 1000)})
      where id = ${rec.id} and status = 'stored' returning id`);
    if (!updated.length) {
      // Deleted while we were encoding: don't leave the new file behind.
      await storage().delete(dest).catch(() => {});
      return { outcome: "skipped", reason: "recording deleted during processing" };
    }
    // A previous encode's file (re-encode after a settings change or a missing file) is no longer referenced.
    if (rec.playback_path && rec.playback_path !== dest) {
      await storage().delete(rec.playback_path).catch((err) => log.warn("recording.old_playback_delete_failed", { recordingId: rec.id, err }));
    }
    const ms = Date.now() - started;
    log.info("recording.playback_ready", { recordingId: rec.id, interviewId: rec.interview_id, part: rec.part_index, kind, inputBytes, outputBytes: size, durationMs, ms });
    return { outcome: "ready", path: dest, bytes: size, durationMs: durationMs!, ms };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof PermanentRecordingError) {
      // No data to encode: stop the sweep from retrying it.
      await withOrg(orgId, (tx) => tx`update recordings set playback_status = 'skipped', playback_error = ${message.slice(0, 1000)} where id = ${rec.id}`);
      throw err;
    }
    if (err instanceof ObjectTooLargeError) {
      // Larger than the storage plan allows (e.g. Supabase free: 50 MB). Chunk playback keeps working.
      await withOrg(orgId, (tx) => tx`update recordings set playback_status = 'skipped', playback_error = ${message.slice(0, 1000)} where id = ${rec.id}`);
      log.warn("recording.playback_too_large", { recordingId: rec.id, err: message });
      return { outcome: "skipped", reason: message };
    }
    await withOrg(orgId, (tx) => tx`update recordings set playback_status = 'failed', playback_error = ${message.slice(0, 1000)} where id = ${rec.id}`);
    log.warn("recording.playback_failed", { recordingId: rec.id, err: message });
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Delete a part's chunks once its playable file is verified and the retention
 * window has passed. Checks the file is still in storage first; if it isn't,
 * the part goes back to "pending" to be encoded again from the chunks.
 */
export async function purgeRecordingChunks(orgId: string, recordingId: string) {
  const [rec] = await withOrg(orgId, (tx) => tx<{ id: string; interview_id: string; part_index: number; playback_path: string | null; playback_size: number | null; playback_ready_at: Date | null }[]>`
    select id, interview_id, part_index, playback_path, playback_size::float8 as playback_size, playback_ready_at from recordings
    where id = ${recordingId} and organization_id = ${orgId} and status = 'stored' and playback_status = 'ready' and chunks_purged_at is null`);
  if (!rec?.playback_path) return { purged: false, reason: "not eligible" };
  const dueAt = (rec.playback_ready_at?.getTime() ?? 0) + env().RECORDING_CHUNK_RETENTION_HOURS * 3600_000;
  if (Date.now() < dueAt) return { purged: false, reason: "retention window not over" };

  if (!(await storage().exists(rec.playback_path))) {
    await withOrg(orgId, (tx) => tx`update recordings set playback_status = 'pending', playback_path = null, playback_error = 'Playback file missing; re-encoding' where id = ${rec.id}`);
    log.warn("recording.playback_missing", { recordingId: rec.id });
    return { purged: false, reason: "playback file missing" };
  }
  await storage().deletePrefix(paths.recordingChunkPrefix(orgId, rec.interview_id, rec.part_index));
  await withOrg(orgId, async (tx) => {
    await tx`delete from recording_chunks where recording_id = ${rec.id}`;
    await tx`update recordings set chunks_purged_at = now(), file_size = coalesce(${rec.playback_size}, file_size) where id = ${rec.id}`;
  });
  log.info("recording.chunks_purged", { recordingId: rec.id });
  return { purged: true };
}

export type DueWork = { orgId: string; recordingId: string };

/**
 * Safety net run on a schedule: parts of finished interviews that still need a
 * playable file (never queued, failed and retryable, or stuck after a crash),
 * and ready parts whose chunks are due for deletion.
 */
export async function findDueRecordingWork(limit = 200): Promise<{ transcode: DueWork[]; purge: DueWork[] }> {
  const retentionHours = env().RECORDING_CHUNK_RETENTION_HOURS;
  return withSystem(async (tx) => {
    const transcodeRows = await tx<{ organization_id: string; id: string }[]>`
      select r.organization_id, r.id from recordings r join interviews i on i.id = r.interview_id
      where r.status = 'stored' and i.status::text = any(${FINISHED})
        and (r.playback_status = 'pending'
          or (r.playback_status = 'failed' and r.playback_attempts < ${MAX_PLAYBACK_ATTEMPTS})
          or (r.playback_status = 'processing' and r.playback_started_at < now() - make_interval(mins => ${STUCK_PROCESSING_MINUTES})))
      order by r.created_at limit ${limit}`;
    const purgeRows = await tx<{ organization_id: string; id: string }[]>`
      select organization_id, id from recordings
      where status = 'stored' and playback_status = 'ready' and chunks_purged_at is null
        and playback_ready_at < now() - make_interval(secs => ${retentionHours * 3600})
      order by playback_ready_at limit ${limit}`;
    const map = (rows: { organization_id: string; id: string }[]) => rows.map((r) => ({ orgId: r.organization_id, recordingId: r.id }));
    return { transcode: map(transcodeRows), purge: map(purgeRows) };
  });
}

/** Stored parts of one interview (called when the interview finishes). */
export async function recordingIdsForInterview(orgId: string, interviewId: string): Promise<string[]> {
  const rows = await withOrg(orgId, (tx) => tx<{ id: string }[]>`
    select id from recordings where interview_id = ${interviewId} and status = 'stored' and playback_status in ('pending', 'failed')`);
  return rows.map((r) => r.id);
}
