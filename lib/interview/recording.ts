import "server-only";
// Recording is uploaded as numbered chunks per "part" (a part = one
// MediaRecorder session; a browser refresh starts a new part). Chunks are
// idempotent by index and indexed in recording_chunks, so a crash mid-interview
// loses at most a few seconds.
//
// After the interview, a background worker (lib/recordings/pipeline.ts) joins
// each part into one MP4/M4A that the player streams straight from storage via
// a signed URL. Until that file is ready, /api/recordings/[id]/stream serves the
// chunks in order (with HTTP Range support) as a fallback.

import { withOrg } from "@/lib/database/db";
import { ApiError } from "@/lib/api";
import { runInBackground } from "@/lib/background";
import { enqueueInterviewRecordings, enqueueRecordingPart } from "@/lib/jobs/enqueue-recordings";
import { log } from "@/lib/logger";
import { paths, storage } from "@/lib/storage";
import { resolveToken } from "./controller";

export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
/**
 * Upper bounds for one part, far above any real interview (a 4 s chunk every
 * 4 s is 900 chunks an hour; ~350 kbps video is ~160 MB an hour). They stop a
 * broken or hostile client from filling storage and the worker's disk.
 */
export const MAX_CHUNKS_PER_PART = 10_000;
export const MAX_PART_BYTES = 4 * 1024 * 1024 * 1024;
const ALLOWED_MIME = /^video\/webm|^video\/mp4|^audio\/webm|^audio\/mp4/;
/** Max bytes returned per range response; browsers request the rest as needed. */
const MAX_RANGE_BYTES = 8 * 1024 * 1024;
/** Chunks fetched ahead while streaming the chunk fallback. */
const STREAM_PREFETCH = 6;

export type RecordingTrack = "candidate" | "interviewer";

export async function startRecordingPart(token: string, input: { offset_ms: number; mime_type: string; track?: RecordingTrack }) {
  const ctx = await resolveToken(token);
  if (!["in_progress", "completing"].includes(ctx.status)) throw new ApiError(409, "The interview is not in progress.");
  if (!ALLOWED_MIME.test(input.mime_type)) throw new ApiError(415, "Unsupported recording format.");
  return withOrg(ctx.orgId, async (tx) => {
    await tx`select id from interviews where id = ${ctx.id} for update`;
    const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(part_index), -1) + 1 as next from recordings where interview_id = ${ctx.id}`;
    const mime = input.mime_type.split(";")[0];
    await tx`insert into recordings (organization_id, interview_id, part_index, offset_ms, storage_path, mime_type, status, track)
      values (${ctx.orgId}, ${ctx.id}, ${next}, ${Math.max(0, Math.round(input.offset_ms))}, ${paths.recordingFile(ctx.orgId, ctx.id, next)}, ${mime}, 'uploading', ${input.track ?? "candidate"})`;
    return { part_index: next };
  });
}

export async function uploadRecordingChunk(token: string, part: number, index: number, bytes: Uint8Array) {
  if (bytes.byteLength === 0) return { stored: false };
  if (bytes.byteLength > MAX_CHUNK_BYTES) throw new ApiError(413, "Chunk too large.");
  // 409: the recorder treats it as final and stops retrying this chunk.
  if (index >= MAX_CHUNKS_PER_PART) throw new ApiError(409, "Recording part is too long.");
  const ctx = await resolveToken(token);
  const [rec] = await withOrg(ctx.orgId, (tx) => tx<{ id: string; status: string; purged: boolean; file_size: number }[]>`
    select id, status, chunks_purged_at is not null as purged, file_size::float8 as file_size
    from recordings where interview_id = ${ctx.id} and part_index = ${part}`);
  if (!rec) throw new ApiError(404, "Recording part not found.");
  if (rec.status === "deleted" || rec.purged) return { stored: false };
  if (rec.file_size + bytes.byteLength > MAX_PART_BYTES) throw new ApiError(409, "Recording part is too large.");
  const path = paths.recordingChunk(ctx.orgId, ctx.id, part, index);
  await storage().put(path, bytes, "application/octet-stream");
  // Locking the row serializes this with the chunk cleanup's claim (pipeline.ts):
  // a chunk is either indexed before the part is purged, or refused after.
  const indexed = await withOrg(ctx.orgId, async (tx) => {
    const [cur] = await tx<{ status: string; purged: boolean }[]>`
      select status, chunks_purged_at is not null as purged from recordings where id = ${rec.id} for update`;
    if (!cur || cur.status === "deleted" || cur.purged) return false;
    await tx`insert into recording_chunks (organization_id, recording_id, chunk_index, storage_path, size)
      values (${ctx.orgId}, ${rec.id}, ${index}, ${path}, ${bytes.byteLength})
      on conflict (recording_id, chunk_index) do update set size = excluded.size, storage_path = excluded.storage_path`;
    await refreshTotals(tx, rec.id);
    return true;
  });
  if (!indexed) {
    // Deleted or cleaned up meanwhile: don't leave an unreferenced object behind.
    await storage().delete(path).catch(() => {});
    return { stored: false };
  }
  return { stored: true };
}

type Tx = Parameters<Parameters<typeof withOrg>[1]>[0];

async function refreshTotals(tx: Tx, recordingId: string) {
  await tx`update recordings r set chunks_received = c.n, file_size = c.bytes
    from (select count(*)::int as n, coalesce(sum(size), 0)::bigint as bytes from recording_chunks where recording_id = ${recordingId}) c
    where r.id = ${recordingId}`;
}

export async function finalizeRecordingPart(token: string, part: number, input: { duration_ms: number | null; total_chunks: number }) {
  const ctx = await resolveToken(token);
  const result = await sealPart(ctx.orgId, ctx.id, part, input);
  // Every chunk is in: encode now instead of waiting for the interview to be processed.
  if (result.status === "stored") runInBackground("recording.enqueue_part", () => enqueueRecordingPart(ctx.orgId, ctx.id, part));
  return result;
}

/**
 * Mark a part as stored once all its chunks are indexed. Also indexes chunks
 * found in storage but missing from the table (uploads made before chunk
 * indexing existed, or a lost index write). Safe to call repeatedly.
 */
export async function sealPart(orgId: string, interviewId: string, part: number, input: { duration_ms: number | null; total_chunks: number | null }) {
  const [rec] = await withOrg(orgId, (tx) => tx<{ id: string; status: string; storage_path: string; chunks_purged: boolean }[]>`
    select id, status, storage_path, chunks_purged_at is not null as chunks_purged from recordings where interview_id = ${interviewId} and part_index = ${part}`);
  if (!rec) throw new ApiError(404, "Recording part not found.");
  if (rec.status === "deleted") return { status: "deleted" as const };
  // Joined into a playable file and chunks cleaned up: nothing left to seal.
  if (rec.chunks_purged) return { status: "stored" as const };

  const files = await storage().listDetailed(paths.recordingChunkPrefix(orgId, interviewId, part));
  const count = await withOrg(orgId, async (tx) => {
    for (const f of files) {
      const index = Number(f.path.match(/chunk-(\d+)\.bin$/)?.[1]);
      if (!Number.isInteger(index) || f.size <= 0) continue;
      await tx`insert into recording_chunks (organization_id, recording_id, chunk_index, storage_path, size)
        values (${orgId}, ${rec.id}, ${index}, ${f.path}, ${f.size})
        on conflict (recording_id, chunk_index) do nothing`;
    }
    await refreshTotals(tx, rec.id);
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from recording_chunks where recording_id = ${rec.id}`;
    return n;
  });

  if (input.total_chunks != null && count < input.total_chunks) {
    // Some chunks are still in flight: never claim the recording is stored.
    return { status: "incomplete" as const, missing: input.total_chunks - count };
  }
  if (count === 0) {
    // Recordings assembled by an earlier version are a single object.
    const legacy = await storage().exists(rec.storage_path);
    await withOrg(orgId, (tx) => tx`update recordings set status = ${legacy ? "stored" : "failed"} where id = ${rec.id}`);
    return { status: legacy ? ("stored" as const) : ("failed" as const) };
  }
  await withOrg(orgId, (tx) => tx`update recordings set status = 'stored',
    duration_seconds = coalesce(${input.duration_ms != null ? Math.round(input.duration_ms / 1000) : null}, duration_seconds)
    where id = ${rec.id}`);
  log.info("recording.stored", { interviewId, part, chunks: count });
  return { status: "stored" as const };
}

/** Called after completion: seal any parts the browser didn't finalize (e.g. tab closed). */
export async function finalizeAllParts(orgId: string, interviewId: string) {
  const parts = await withOrg(orgId, (tx) => tx<{ part_index: number }[]>`
    select part_index from recordings where interview_id = ${interviewId} and status in ('uploading', 'failed')`);
  for (const p of parts) {
    try {
      await sealPart(orgId, interviewId, p.part_index, { duration_ms: null, total_chunks: null });
    } catch (err) {
      log.warn("recording.finalize_failed", { interviewId, part: p.part_index, err });
    }
  }
}

/**
 * Recordings are sensitive: a copied link stops working after an hour. The
 * player asks for fresh URLs when one expires and resumes where it was.
 */
const PLAYBACK_URL_TTL_SECONDS = 60 * 60;

/**
 * Playback URLs for an authorized recruiter. A part with a ready playable file
 * gets a signed URL straight to storage (the browser streams and seeks without
 * touching our server); otherwise it falls back to the (slower) chunk stream,
 * and the part is queued for encoding so the next load is fast.
 *
 * Which file is usable (whatever the encode status: a part being encoded again
 * keeps playing its previous file):
 * - chunks deleted: the file is all there is;
 * - encoded from exactly the current chunks: yes;
 * - encoded before chunk counts were recorded (`playback_chunks` null): yes, as
 *   before. The worker re-encodes it, and its chunks are kept until it has;
 * - encoded from fewer chunks than arrived since: no, the chunks are complete.
 */
export async function recordingUrls(orgId: string, interviewId: string) {
  const parts = await withOrg(orgId, (tx) => tx<{ id: string; part_index: number; offset_ms: number; storage_path: string; mime_type: string; duration_seconds: number | null; track: RecordingTrack; chunked: boolean; playback_path: string | null; playback_mime: string | null }[]>`
    select r.id, r.part_index, r.offset_ms, r.storage_path, r.mime_type, r.duration_seconds, r.track,
      exists (select 1 from recording_chunks c where c.recording_id = r.id) as chunked,
      -- Any status: while a part is being encoded again (or that failed), its previous file still plays.
      case when r.playback_path is not null and (r.chunks_purged_at is not null or r.playback_chunks is null
        or (r.playback_chunks = r.chunks_received and r.playback_source_bytes = r.file_size))
        then r.playback_path end as playback_path, r.playback_mime
    from recordings r
    where r.interview_id = ${interviewId} and r.organization_id = ${orgId} and r.status = 'stored' order by r.part_index`);
  if (parts.some((p) => !p.playback_path)) {
    // Never blocks or fails the response; parts already queued or encoding are skipped.
    runInBackground("recording.enqueue_on_view", () => enqueueInterviewRecordings(orgId, interviewId, { delayMs: 0 }));
  }
  return Promise.all(parts.map(async (p) => {
    const ready = p.playback_path && p.playback_mime;
    return {
      part_index: p.part_index,
      // Identifies what the URL points to (this part's current file, or its chunks). Signed URLs
      // differ on every request; the player only reloads the video when this changes.
      key: `${p.id}:${ready ? p.playback_path!.split("/").pop() : p.chunked ? "chunks" : "original"}`,
      track: p.track,
      offset_ms: p.offset_ms,
      duration_seconds: p.duration_seconds,
      mime_type: ready ? p.playback_mime! : p.mime_type,
      url: ready
        ? await storage().signedUrl(p.playback_path!, PLAYBACK_URL_TTL_SECONDS, p.playback_mime!)
        : p.chunked ? `/api/recordings/${p.id}/stream` : await storage().signedUrl(p.storage_path, PLAYBACK_URL_TTL_SECONDS, p.mime_type),
    };
  }));
}

/** One "recording viewed" audit entry per person per interview per 10 minutes (page refreshes don't add more). */
const ACCESS_AUDIT_WINDOW_MINUTES = 10;

/**
 * Everything the recording player needs for an authorized viewer: the video
 * parts and the interviewer's voice, with access recorded in the audit log.
 * Used by the interview page (so links arrive with the page, no extra request)
 * and by the recording API (when links are refreshed). The audit insert runs
 * alongside the link signing instead of after it.
 */
export async function recordingForViewer(orgId: string, userId: string, interviewId: string) {
  const [all] = await Promise.all([
    recordingUrls(orgId, interviewId),
    withOrg(orgId, (tx) => tx`
      insert into audit_logs (organization_id, user_id, actor_type, action, entity_type, entity_id)
      select ${orgId}, ${userId}, 'user', 'interview.recording_accessed', 'interview', ${interviewId}
      where exists (select 1 from interviews where id = ${interviewId} and organization_id = ${orgId})
        and not exists (select 1 from audit_logs where organization_id = ${orgId} and entity_id = ${interviewId}
          and user_id = ${userId} and action = 'interview.recording_accessed'
          and created_at > now() - make_interval(mins => ${ACCESS_AUDIT_WINDOW_MINUTES}))`)
      .catch((err) => log.warn("audit.write_failed", { action: "interview.recording_accessed", interviewId, err })),
  ]);
  // `parts`: the candidate's video; `voice`: the interviewer's voice, played in sync.
  return { parts: all.filter((p) => p.track === "candidate"), voice: all.filter((p) => p.track === "interviewer") };
}

/**
 * Serve a chunked recording as one continuous file, honouring HTTP Range so
 * the video player can seek. Each response is capped at MAX_RANGE_BYTES.
 */
export async function streamRecording(orgId: string, recordingId: string, rangeHeader: string | null): Promise<Response> {
  const [rec] = await withOrg(orgId, (tx) => tx<{ mime_type: string; status: string }[]>`
    select mime_type, status from recordings where id = ${recordingId} and organization_id = ${orgId}`);
  if (!rec || rec.status === "deleted") throw new ApiError(404, "Recording not found");
  const chunks = await withOrg(orgId, (tx) => tx<{ storage_path: string; size: number }[]>`
    select storage_path, size from recording_chunks where recording_id = ${recordingId} order by chunk_index`);
  if (!chunks.length) throw new ApiError(404, "Recording not found");

  const total = chunks.reduce((a, c) => a + c.size, 0);
  let start = 0;
  let end = total - 1;
  let partial = false;
  const m = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
  if (m) {
    partial = true;
    if (m[1]) {
      start = Number(m[1]);
      if (m[2]) end = Math.min(Number(m[2]), total - 1);
    } else if (m[2]) {
      start = Math.max(0, total - Number(m[2]));
    }
    if (start >= total || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }
    end = Math.min(end, start + MAX_RANGE_BYTES - 1);
  }

  // Chunks overlapping [start, end] with their byte offsets.
  const plan: { path: string; from: number; to: number }[] = [];
  let offset = 0;
  for (const c of chunks) {
    const cStart = offset;
    const cEnd = offset + c.size - 1;
    offset += c.size;
    if (cEnd < start) continue;
    if (cStart > end) break;
    plan.push({ path: c.storage_path, from: Math.max(0, start - cStart), to: Math.min(c.size - 1, end - cStart) });
  }

  // Fetch a few chunks ahead in parallel, but emit them strictly in order.
  const inflight: Promise<Uint8Array>[] = [];
  let next = 0;
  const fill = () => {
    while (next < plan.length && inflight.length < STREAM_PREFETCH) {
      const p = plan[next++];
      const fetching = storage().get(p.path).then((bytes) => bytes.subarray(p.from, p.to + 1));
      fetching.catch(() => {}); // surfaced when awaited below
      inflight.push(fetching);
    }
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      fill();
      const head = inflight.shift();
      if (!head) return controller.close();
      try {
        controller.enqueue(await head);
      } catch (err) {
        log.warn("recording.stream_chunk_failed", { recordingId, err });
        controller.error(err);
      }
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": rec.mime_type,
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  };
  if (partial) headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
  return new Response(body, { status: partial ? 206 : 200, headers });
}
