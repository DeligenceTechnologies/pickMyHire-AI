import "server-only";
// Turns a recording part's uploaded chunks into one playable file, and later
// removes the chunks. Every step is idempotent and safe to retry: a job that
// runs twice, or after the recording was deleted, does no harm.
//
//   pending ──transcode──▶ processing ──▶ ready ──(retention window)──▶ chunks purged
//                                    └──▶ failed  (retried; chunks keep playback working)
//                                    └──▶ skipped (no data, or too large for the storage plan)
//
// Integrity: a file records exactly which chunks went into it (count + bytes).
// Chunks can still arrive after the encode (the browser was finishing its
// upload when the interview closed). Such a file is "stale": playback uses the
// chunks instead, the part is encoded again, and its chunks are never deleted.

import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Writable } from "node:stream";
import { withOrg, withSystem } from "@/lib/database/db";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { ObjectTooLargeError, paths, storage } from "@/lib/storage";
import { probeDurationMs, transcode, writeChunk, type SourceFormat, type TranscodeKind } from "./ffmpeg";

/** Chunks downloaded ahead of the encoder. */
const DOWNLOAD_CONCURRENCY = 16;
/** Encodes of one part (all causes) before nothing re-queues it automatically. */
export const MAX_PLAYBACK_ATTEMPTS = 6;
/** A part stuck in "processing" this long with no live job (worker crashed) is picked up again. */
const STUCK_PROCESSING_MINUTES = 60;
/** Interviews in these states are over: their recordings won't get more parts. */
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
  purged: boolean;
  stale: boolean;
};

/**
 * SQL condition (on alias `r`): the playable file was encoded from a different
 * set of chunks than the part has now. `chunks_received` and `file_size` are
 * updated in the same row on every chunk upload, so this is exact.
 */
const STALE = "(r.playback_chunks is distinct from r.chunks_received or r.playback_source_bytes is distinct from r.file_size)";

async function loadRecording(orgId: string, recordingId: string) {
  const [rec] = await withOrg(orgId, (tx) => tx<Rec[]>`
    select r.id, r.interview_id, r.part_index, r.track, r.mime_type, r.status::text, r.storage_path, r.duration_seconds,
      r.playback_status, r.playback_path, r.chunks_purged_at is not null as purged, ${tx.unsafe(STALE)} as stale
    from recordings r where r.id = ${recordingId} and r.organization_id = ${orgId}`);
  return rec ?? null;
}

type Snapshot = { chunks: { storage_path: string; size: number }[]; count: number; bytes: number };

/**
 * The chunks this encode will use, read together with the part's totals under
 * a row lock, so the recorded count/bytes match exactly what was encoded.
 */
async function snapshotChunks(orgId: string, recordingId: string): Promise<Snapshot> {
  return withOrg(orgId, async (tx) => {
    const [row] = await tx<{ file_size: number }[]>`select file_size::float8 as file_size from recordings where id = ${recordingId} for share`;
    const chunks = await tx<{ storage_path: string; size: number }[]>`
      select storage_path, size from recording_chunks where recording_id = ${recordingId} order by chunk_index`;
    // Recordings from before chunked uploads are one object: no chunks, the size is the file's.
    if (!chunks.length) return { chunks, count: 0, bytes: row?.file_size ?? 0 };
    return { chunks, count: chunks.length, bytes: chunks.reduce((n, c) => n + c.size, 0) };
  });
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

/** Download chunks several at a time and hand them to `write` strictly in order. */
async function streamChunks(chunkPaths: string[], write: (data: Uint8Array) => Promise<void>): Promise<number> {
  const inflight: Promise<Uint8Array>[] = [];
  let next = 0;
  let bytes = 0;
  const fill = () => {
    while (next < chunkPaths.length && inflight.length < DOWNLOAD_CONCURRENCY) {
      const p = downloadWithRetry(chunkPaths[next++]);
      p.catch(() => {}); // surfaced when awaited below
      inflight.push(p);
    }
  };
  fill();
  while (inflight.length) {
    const data = await inflight.shift()!;
    fill();
    await write(data);
    bytes += data.byteLength;
  }
  return bytes;
}

/** Write the part (chunks in order, or the legacy single object) into one local file. */
async function downloadToFile(rec: Rec, snap: Snapshot, dest: string): Promise<number> {
  const fh = await open(dest, "w");
  try {
    if (!snap.count) {
      if (!(await storage().exists(rec.storage_path))) throw new PermanentRecordingError("Recording has no chunks and no stored file");
      const data = await storage().get(rec.storage_path);
      await fh.write(data);
      return data.byteLength;
    }
    return await streamChunks(snap.chunks.map((c) => c.storage_path), async (d) => { await fh.write(d); });
  } finally {
    await fh.close();
  }
}

/** Browser recordings report their own length; the encoded file must not be much shorter. */
export function checkDuration(durationMs: number | null, expectedSeconds: number | null) {
  if (!durationMs || durationMs <= 0) throw new Error("Encoded file has no duration");
  if (expectedSeconds && expectedSeconds > 10 && durationMs < expectedSeconds * 1000 * 0.8 - 5000) {
    throw new Error(`Encoded file is ${Math.round(durationMs / 1000)}s but the recording is ${expectedSeconds}s`);
  }
}

export type TranscodeResult =
  | { outcome: "ready"; path: string; bytes: number; durationMs: number; ms: number }
  | { outcome: "skipped"; reason: string };

/**
 * Join one part's chunks and encode them into a playable MP4/M4A, upload it and
 * mark the part ready. Chunks are left in place (see `purgeRecordingChunks`).
 */
export async function transcodeRecording(orgId: string, recordingId: string): Promise<TranscodeResult> {
  const rec = await loadRecording(orgId, recordingId);
  if (!rec || rec.status !== "stored") return { outcome: "skipped", reason: rec ? `recording is ${rec.status}` : "recording not found" };
  if (rec.purged) return { outcome: "skipped", reason: "chunks already deleted" };
  if (rec.playback_status === "ready" && rec.playback_path && !rec.stale) return { outcome: "skipped", reason: "already ready" };
  if (rec.playback_status === "skipped") return { outcome: "skipped", reason: "previously skipped" };

  const [claimed] = await withOrg(orgId, (tx) => tx<{ attempt: number }[]>`update recordings set playback_status = 'processing',
    playback_started_at = now(), playback_attempts = playback_attempts + 1, playback_error = null
    where id = ${rec.id} and status = 'stored' and chunks_purged_at is null returning playback_attempts as attempt`);
  if (!claimed) return { outcome: "skipped", reason: "recording changed" };
  const { attempt } = claimed;

  const started = Date.now();
  const kind: TranscodeKind = rec.track === "interviewer" || rec.mime_type.startsWith("audio/") ? "audio" : "video";
  const format: SourceFormat = rec.mime_type.includes("mp4") ? "mp4" : "webm";
  const ext = kind === "video" ? "mp4" : "m4a";
  const mime = kind === "video" ? "video/mp4" : "audio/mp4";
  const dest = paths.recordingPlayback(orgId, rec.interview_id, rec.part_index, attempt, ext);
  const work = await mkdtemp(path.join(tmpdir(), "rec-"));
  let uploaded = false;
  try {
    const snap = await snapshotChunks(orgId, rec.id);
    if (snap.count > 0 && snap.bytes === 0) throw new PermanentRecordingError("Recording is empty");
    const output = path.join(work, `output.${ext}`);
    const expectedMs = (rec.duration_seconds ?? 0) * 1000;
    // Generous: superfast x264 at 720p runs many times faster than real time.
    const timeoutMs = Math.min(3 * 3600_000, Math.max(15 * 60_000, expectedMs * 2));
    // The interviewer track is a synthetic voice: 48 kbps mono AAC is transparent for it.
    const opts = { crf: env().RECORDING_CRF, timeoutMs, audioKbps: rec.track === "interviewer" ? 48 : 64 };

    let inputBytes = 0;
    if (format === "webm" && snap.count > 0) {
      // Stream the chunks straight into ffmpeg: download and encode overlap, nothing is staged on disk.
      const feed = async (stdin: Writable) => {
        inputBytes = await streamChunks(snap.chunks.map((c) => c.storage_path), (d) => writeChunk(stdin, d));
      };
      await transcode({ feed }, output, kind, format, opts);
    } else {
      // MP4 needs a seekable input (its index may be at the end); legacy files are one object.
      const input = path.join(work, `input.${format}`);
      inputBytes = await downloadToFile(rec, snap, input);
      if (inputBytes === 0) throw new PermanentRecordingError("Recording is empty");
      await transcode({ file: input }, output, kind, format, opts);
    }

    const durationMs = await probeDurationMs(output);
    checkDuration(durationMs, rec.duration_seconds);
    const { size } = await stat(output);
    if (size <= 0) throw new Error("Encoded file is empty");

    await storage().putFile(dest, output, mime);
    uploaded = true;
    const head = await storage().head(dest);
    if (!head) throw new Error("Uploaded file is not readable back from storage");
    if (head.size != null && head.size !== size) throw new Error(`Uploaded file is ${head.size} bytes, expected ${size}`);

    const updated = await withOrg(orgId, (tx) => tx`update recordings set playback_status = 'ready', playback_path = ${dest},
      playback_mime = ${mime}, playback_size = ${size}, playback_duration_ms = ${durationMs}, playback_ready_at = now(),
      playback_chunks = ${snap.count}, playback_source_bytes = ${snap.bytes},
      playback_error = null, duration_seconds = coalesce(duration_seconds, ${Math.round(durationMs! / 1000)})
      where id = ${rec.id} and status = 'stored' and chunks_purged_at is null returning id`);
    if (!updated.length) {
      // Deleted while we were encoding: don't leave the new file behind.
      await storage().delete(dest).catch(() => {});
      return { outcome: "skipped", reason: "recording deleted during processing" };
    }
    // A previous encode's file is no longer referenced.
    if (rec.playback_path && rec.playback_path !== dest) {
      await storage().delete(rec.playback_path).catch((err) => log.warn("recording.old_playback_delete_failed", { recordingId: rec.id, err }));
    }
    const ms = Date.now() - started;
    log.info("recording.playback_ready", { recordingId: rec.id, interviewId: rec.interview_id, part: rec.part_index, kind, chunks: snap.count, inputBytes, outputBytes: size, durationMs, ms });
    return { outcome: "ready", path: dest, bytes: size, durationMs: durationMs!, ms };
  } catch (err) {
    if (uploaded) await storage().delete(dest).catch(() => {});
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    // Keep a previous (stale but playable) file referenced; playback falls back to chunks anyway.
    if (err instanceof PermanentRecordingError || err instanceof ObjectTooLargeError) {
      // No data to encode, or larger than the storage plan allows (e.g. Supabase free: 50 MB):
      // stop retrying. Chunk playback keeps working.
      await withOrg(orgId, (tx) => tx`update recordings set playback_status = 'skipped', playback_error = ${message} where id = ${rec.id}`);
      log.warn("recording.playback_skipped", { recordingId: rec.id, err: message });
      if (err instanceof ObjectTooLargeError) return { outcome: "skipped", reason: message };
      throw err;
    }
    await withOrg(orgId, (tx) => tx`update recordings set playback_status = 'failed', playback_error = ${message} where id = ${rec.id}`);
    log.warn("recording.playback_failed", { recordingId: rec.id, attempt, err: message });
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export type PurgeResult = { purged: boolean; reason?: string };

/**
 * Delete a part's chunks once its playable file is verified and the retention
 * window has passed. Never deletes chunks that aren't in the file: the claim
 * below is atomic with chunk uploads (both lock the recording row), and uploads
 * are refused once a part is purged.
 */
export async function purgeRecordingChunks(orgId: string, recordingId: string): Promise<PurgeResult> {
  const [rec] = await withOrg(orgId, (tx) => tx<{ id: string; interview_id: string; part_index: number; storage_path: string; playback_path: string | null; playback_size: number | null; playback_ready_at: Date | null; purged: boolean; stale: boolean }[]>`
    select r.id, r.interview_id, r.part_index, r.storage_path, r.playback_path, r.playback_size::float8 as playback_size, r.playback_ready_at,
      r.chunks_purged_at is not null as purged, ${tx.unsafe(STALE)} as stale
    from recordings r
    where r.id = ${recordingId} and r.organization_id = ${orgId} and r.status = 'stored' and r.playback_status = 'ready'`);
  if (!rec?.playback_path) return { purged: false, reason: "not eligible" };

  if (!rec.purged) {
    if (rec.stale) return { purged: false, reason: "file is older than the chunks" };
    const dueAt = (rec.playback_ready_at?.getTime() ?? 0) + env().RECORDING_CHUNK_RETENTION_HOURS * 3600_000;
    if (Date.now() < dueAt) return { purged: false, reason: "retention window not over" };

    const head = await storage().head(rec.playback_path);
    const sizeMismatch = head?.size != null && rec.playback_size != null && head.size !== rec.playback_size;
    if (!head || sizeMismatch) {
      // Bounded: the sweep re-encodes a failed part only while it has attempts left.
      const why = head ? `Playback file is ${head.size} bytes, expected ${rec.playback_size}` : "Playback file missing";
      // Forget the bad file so it's never served; playback uses the chunks until it's encoded again.
      await withOrg(orgId, (tx) => tx`update recordings set playback_status = 'failed', playback_path = null, playback_error = ${why}
        where id = ${rec.id} and playback_path = ${rec.playback_path}`);
      if (head) await storage().delete(rec.playback_path).catch(() => {});
      log.warn("recording.playback_invalid", { recordingId: rec.id, reason: why });
      return { purged: false, reason: why };
    }

    const claimed = await withOrg(orgId, (tx) => tx`
      update recordings r set chunks_purged_at = now(), file_size = coalesce(r.playback_size, r.file_size)
      where r.id = ${rec.id} and r.status = 'stored' and r.playback_status = 'ready' and r.playback_path = ${rec.playback_path}
        and r.chunks_purged_at is null and not ${tx.unsafe(STALE)}
      returning r.id`);
    if (!claimed.length) return { purged: false, reason: "recording changed" };
  }

  // Also finishes a cleanup that failed midway (the sweep retries purged parts with chunk rows left).
  await storage().deletePrefix(paths.recordingChunkPrefix(orgId, rec.interview_id, rec.part_index));
  // A recording from before chunked uploads is one object; the playable file replaces it.
  if (rec.storage_path !== rec.playback_path) await storage().delete(rec.storage_path).catch(() => {});
  await withOrg(orgId, (tx) => tx`delete from recording_chunks where recording_id = ${rec.id}`);
  log.info("recording.chunks_purged", { recordingId: rec.id });
  return { purged: true };
}

export type DueWork = { orgId: string; recordingId: string };

/** Conditions (on alias `r`) for a part that should be (re-)encoded, attempts permitting. */
const NEEDS_ENCODE = `r.status = 'stored' and r.chunks_purged_at is null and r.playback_attempts < ${MAX_PLAYBACK_ATTEMPTS}
  and (r.playback_status in ('pending', 'failed')
    or (r.playback_status = 'processing' and r.playback_started_at < now() - interval '${STUCK_PROCESSING_MINUTES} minutes')
    or (r.playback_status = 'ready' and ${STALE}))`;

/**
 * Safety net run on a schedule: parts of finished interviews that still need a
 * playable file (never queued, failed and retryable, stuck after a crash, or
 * stale after late chunks), and ready parts whose chunks are due for deletion.
 */
export async function findDueRecordingWork(limit = 200): Promise<{ transcode: DueWork[]; purge: DueWork[] }> {
  const retentionHours = env().RECORDING_CHUNK_RETENTION_HOURS;
  return withSystem(async (tx) => {
    const transcodeRows = await tx<{ organization_id: string; id: string }[]>`
      select r.organization_id, r.id from recordings r join interviews i on i.id = r.interview_id
      where i.status::text = any(${FINISHED}) and ${tx.unsafe(NEEDS_ENCODE)}
      order by r.created_at limit ${limit}`;
    const purgeRows = await tx<{ organization_id: string; id: string }[]>`
      select r.organization_id, r.id from recordings r
      where r.status = 'stored' and r.playback_status = 'ready' and (
        (r.chunks_purged_at is null and not ${tx.unsafe(STALE)} and r.playback_ready_at < now() - make_interval(secs => ${retentionHours * 3600}))
        or (r.chunks_purged_at is not null and exists (select 1 from recording_chunks c where c.recording_id = r.id)))
      order by r.playback_ready_at limit ${limit}`;
    const map = (rows: { organization_id: string; id: string }[]) => rows.map((r) => ({ orgId: r.organization_id, recordingId: r.id }));
    return { transcode: map(transcodeRows), purge: map(purgeRows) };
  });
}

/** Parts of one interview that need encoding (called when the interview finishes). */
export async function recordingIdsForInterview(orgId: string, interviewId: string): Promise<string[]> {
  const rows = await withOrg(orgId, (tx) => tx<{ id: string }[]>`
    select r.id from recordings r where r.interview_id = ${interviewId} and r.organization_id = ${orgId} and ${tx.unsafe(NEEDS_ENCODE)}`);
  return rows.map((r) => r.id);
}

/** The part's id if it needs encoding (called when the browser confirms a part is complete). */
export async function recordingIdForPart(orgId: string, interviewId: string, part: number): Promise<string | null> {
  const [row] = await withOrg(orgId, (tx) => tx<{ id: string }[]>`
    select r.id from recordings r where r.interview_id = ${interviewId} and r.part_index = ${part} and r.organization_id = ${orgId}
      and ${tx.unsafe(NEEDS_ENCODE)}`);
  return row?.id ?? null;
}
