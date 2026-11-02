/*
 * One-time backfill: queue every stored recording of a finished interview that
 * has no playable file yet (recordings made before the worker existed).
 * Usage: npm run recordings:backfill
 */
import { findDueRecordingWork } from "@/lib/recordings/pipeline";
import { addUnique, jobIds, recordingsQueue } from "@/lib/jobs/recordings-queue";

async function main() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not set");
  const queue = recordingsQueue();
  let queued = 0;
  const { transcode } = await findDueRecordingWork(100_000);
  for (const w of transcode) if (await addUnique(queue, "transcode", jobIds.transcode(w.recordingId), w)) queued++;
  console.log(`queued ${queued} of ${transcode.length} recording part(s); the worker will encode them`);
  await queue.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
