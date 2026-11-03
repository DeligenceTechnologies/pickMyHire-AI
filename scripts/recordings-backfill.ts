/*
 * Backfill: encode every stored recording of a finished interview that has no
 * up-to-date playable file (made before the worker existed, failed with
 * attempts left, or encoded before chunk tracking).
 *
 * Usage: npm run recordings:backfill
 * - With REDIS_URL: queues them; the worker encodes them.
 * - Without REDIS_URL (local development): encodes them here, one at a time.
 */
import { findDueRecordingWork, transcodeRecording } from "@/lib/recordings/pipeline";
import { addUnique, jobIds, recordingsQueue } from "@/lib/jobs/recordings-queue";

async function main() {
  const { transcode } = await findDueRecordingWork(100_000);
  if (!transcode.length) {
    console.log("nothing to encode: every recording is up to date");
    process.exit(0);
  }

  if (process.env.REDIS_URL) {
    const queue = recordingsQueue();
    let queued = 0;
    for (const w of transcode) if (await addUnique(queue, "transcode", jobIds.transcode(w.recordingId), w)) queued++;
    console.log(`queued ${queued} of ${transcode.length} recording part(s); the worker will encode them`);
    await queue.close();
    process.exit(0);
  }

  console.log(`REDIS_URL is not set: encoding ${transcode.length} recording part(s) here`);
  let failed = 0;
  for (const [i, w] of transcode.entries()) {
    const label = `[${i + 1}/${transcode.length}] ${w.recordingId}`;
    try {
      const r = await transcodeRecording(w.orgId, w.recordingId);
      console.log(r.outcome === "ready" ? `${label} ready in ${Math.round(r.ms / 1000)}s (${Math.round(r.bytes / 1048576)} MB)` : `${label} skipped: ${r.reason}`);
    } catch (err) {
      failed++;
      console.log(`${label} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
