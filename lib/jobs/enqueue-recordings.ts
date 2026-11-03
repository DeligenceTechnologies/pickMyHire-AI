import "server-only";
import { runInBackground } from "@/lib/background";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { findDueRecordingWork, purgeRecordingChunks, recordingIdForPart, recordingIdsForInterview, transcodeRecording } from "@/lib/recordings/pipeline";
import { addUnique, jobIds, recordingsQueue } from "./recordings-queue";
import { queueEnabled } from "./redis";

/** A slow or unreachable Redis must never hold up the interview pipeline. */
const ENQUEUE_TIMEOUT_MS = 5_000;
/**
 * When an interview closes, the browser may still be uploading the last chunks
 * of a part it couldn't confirm. Encoding a little later usually catches them;
 * anything later still is caught by the stale-file check (see pipeline.ts).
 */
export const LATE_CHUNK_GRACE_MS = 2 * 60_000;

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Without Redis, encode inside this process: fine for local development, but in
 * production it would compete with web requests for CPU. There, parts wait for
 * the worker (the sweep picks them up once it runs) and keep playing from chunks.
 */
function inlineAllowed() {
  return process.env.NODE_ENV !== "production" || env().RECORDING_INLINE_PROCESSING;
}

async function enqueue(orgId: string, ids: string[], context: Record<string, unknown>, delayMs: number) {
  if (!ids.length) return;
  if (!queueEnabled()) {
    if (!inlineAllowed()) {
      log.error("recording.queue_not_configured", { ...context, parts: ids.length, hint: "Set REDIS_URL and run the worker (`npm run worker`)" });
      return;
    }
    log.warn("recording.queue_disabled", { ...context, parts: ids.length, hint: "Processing inline; set REDIS_URL and run `npm run worker` in production" });
    runInBackground("recording.transcode_inline", () => processInline(orgId, ids));
    return;
  }
  const queue = recordingsQueue();
  let queued = 0;
  await withTimeout((async () => {
    for (const id of ids) if (await addUnique(queue, "transcode", jobIds.transcode(id), { orgId, recordingId: id }, { delay: delayMs })) queued++;
  })(), ENQUEUE_TIMEOUT_MS, "Queueing recordings");
  log.info("recording.queued", { ...context, parts: ids.length, queued, delayMs });
}

/**
 * Called when an interview finishes (after a grace period for late chunks), and
 * when a recruiter opens a recording that's still playing from chunks (at once):
 * queue every part that needs encoding.
 * Never throws — a queue outage must not break the interview pipeline; the
 * worker's sweep picks up anything missed, and playback falls back to chunks.
 */
export async function enqueueInterviewRecordings(orgId: string, interviewId: string, opts: { delayMs?: number } = {}) {
  try {
    const ids = await recordingIdsForInterview(orgId, interviewId);
    await enqueue(orgId, ids, { interviewId }, opts.delayMs ?? LATE_CHUNK_GRACE_MS);
  } catch (err) {
    log.error("recording.enqueue_failed", { interviewId, err });
  }
}

/**
 * Called when the browser confirms a part has all its chunks: encode it right
 * away, so the playable file is often ready by the time the report is. Never throws.
 */
export async function enqueueRecordingPart(orgId: string, interviewId: string, part: number) {
  try {
    const id = await recordingIdForPart(orgId, interviewId, part);
    if (id) await enqueue(orgId, [id], { interviewId, part }, 0);
  } catch (err) {
    log.error("recording.enqueue_failed", { interviewId, part, err });
  }
}

/** No-Redis fallback (local development): encode now, inside this process, one part at a time. */
async function processInline(orgId: string, ids: string[]) {
  for (const id of ids) {
    try {
      await transcodeRecording(orgId, id);
    } catch (err) {
      log.warn("recording.transcode_inline_failed", { recordingId: id, err });
    }
  }
  const { purge } = await findDueRecordingWork(50);
  for (const p of purge) await purgeRecordingChunks(p.orgId, p.recordingId).catch((err) => log.warn("recording.purge_failed", { recordingId: p.recordingId, err }));
}
