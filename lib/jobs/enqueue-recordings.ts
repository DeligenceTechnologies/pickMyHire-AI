import "server-only";
import { runInBackground } from "@/lib/background";
import { log } from "@/lib/logger";
import { findDueRecordingWork, purgeRecordingChunks, recordingIdsForInterview, transcodeRecording } from "@/lib/recordings/pipeline";
import { addUnique, jobIds, recordingsQueue } from "./recordings-queue";
import { queueEnabled } from "./redis";

/**
 * Called when an interview finishes: queue every stored part for encoding.
 * Never throws — a queue outage must not break the interview pipeline; the
 * worker's sweep picks up anything missed, and playback falls back to chunks.
 */
export async function enqueueInterviewRecordings(orgId: string, interviewId: string) {
  try {
    const ids = await recordingIdsForInterview(orgId, interviewId);
    if (!ids.length) return;
    if (!queueEnabled()) {
      log.warn("recording.queue_disabled", { interviewId, parts: ids.length, hint: "Set REDIS_URL and run `npm run worker` in production" });
      runInBackground("recording.transcode_inline", () => processInline(orgId, ids));
      return;
    }
    const queue = recordingsQueue();
    for (const id of ids) await addUnique(queue, "transcode", jobIds.transcode(id), { orgId, recordingId: id });
    log.info("recording.queued", { interviewId, parts: ids.length });
  } catch (err) {
    log.error("recording.enqueue_failed", { interviewId, err });
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
