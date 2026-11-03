import "server-only";
import { Queue, UnrecoverableError, Worker, type Job } from "bullmq";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { ffmpegPath, ffmpegVersion, MIN_FFMPEG_VERSION } from "@/lib/recordings/ffmpeg";
import { findDueRecordingWork, PermanentRecordingError, purgeRecordingChunks, transcodeRecording } from "@/lib/recordings/pipeline";
import { addUnique, defaultJobOptions, jobIds, RECORDINGS_QUEUE, type RecordingJobData, type RecordingJobName } from "./recordings-queue";
import { createRedis } from "./redis";

/** How often the safety-net sweep runs. */
const SWEEP_EVERY_MS = 10 * 60_000;

async function processJob(job: Job<RecordingJobData, unknown, RecordingJobName>) {
  switch (job.name) {
    case "transcode": {
      const { orgId, recordingId } = job.data as { orgId: string; recordingId: string };
      try {
        return await transcodeRecording(orgId, recordingId);
      } catch (err) {
        // Retrying can't fix a recording with no data: fail now instead of after every backoff.
        if (err instanceof PermanentRecordingError) throw new UnrecoverableError(err.message);
        throw err;
      }
    }
    case "purge": {
      const { orgId, recordingId } = job.data as { orgId: string; recordingId: string };
      return purgeRecordingChunks(orgId, recordingId);
    }
    case "sweep":
      return sweep();
    default:
      throw new UnrecoverableError(`Unknown job ${job.name}`);
  }
}

/** The worker's own producer: retries through Redis restarts instead of failing fast like the web server's. */
let queue: Queue;

/** Re-queue parts that were missed (Redis down when the interview ended, worker crash) and due purges. */
async function sweep() {
  const due = await findDueRecordingWork();
  let transcodes = 0;
  let purges = 0;
  for (const w of due.transcode) if (await addUnique(queue, "transcode", jobIds.transcode(w.recordingId), w)) transcodes++;
  for (const w of due.purge) if (await addUnique(queue, "purge", jobIds.purge(w.recordingId), w)) purges++;
  if (transcodes || purges) log.info("recording.sweep", { transcodes, purges });
  return { transcodes, purges };
}

/** Refuse to start with a missing or too-old ffmpeg: every job would fail, one by one, after retries. */
async function checkFfmpeg() {
  const bin = ffmpegPath();
  let info: Awaited<ReturnType<typeof ffmpegVersion>>;
  try {
    info = await ffmpegVersion();
  } catch (err) {
    throw new Error(`ffmpeg not found at "${bin}" (${(err as Error).message}). Install it (the build runs ffmpeg-static's installer) or set FFMPEG_PATH.`);
  }
  const [minMajor, minMinor] = MIN_FFMPEG_VERSION;
  const v = info.version;
  if (v && (v[0] < minMajor || (v[0] === minMajor && v[1] < minMinor))) {
    throw new Error(`ffmpeg ${v.join(".")} at "${bin}" is too old; ${minMajor}.${minMinor} or newer is required.`);
  }
  log.info("worker.ffmpeg", { path: bin, version: info.raw });
}

/** Start the recordings worker and its sweep schedule. Returns a function that shuts both down. */
export async function startRecordingsWorker() {
  await checkFfmpeg();
  const concurrency = env().RECORDING_WORKER_CONCURRENCY;
  queue = new Queue(RECORDINGS_QUEUE, { connection: createRedis("worker"), defaultJobOptions });
  const worker = new Worker<RecordingJobData, unknown, RecordingJobName>(RECORDINGS_QUEUE, processJob, {
    connection: createRedis("worker"),
    concurrency,
    // Encoding a long interview takes minutes; the lock is renewed while the job runs.
    lockDuration: 5 * 60_000,
    maxStalledCount: 2,
  });

  worker.on("completed", (job, result) => log.info("job.completed", { queue: RECORDINGS_QUEUE, name: job.name, id: job.id, result: job.name === "sweep" ? result : undefined }));
  worker.on("failed", (job, err) => log.warn("job.failed", { queue: RECORDINGS_QUEUE, name: job?.name, id: job?.id, attempt: job?.attemptsMade, err }));
  worker.on("error", (err) => log.error("worker.error", { queue: RECORDINGS_QUEUE, err }));

  await queue.upsertJobScheduler("recordings-sweep", { every: SWEEP_EVERY_MS }, {
    name: "sweep",
    data: {},
    opts: { attempts: 1, removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } },
  });
  // Catch up right away after a deploy instead of waiting for the first tick.
  await addUnique(queue, "sweep", "sweep-startup", {});

  log.info("worker.started", { queue: RECORDINGS_QUEUE, concurrency });

  return async () => {
    // Lets the running encode finish (BullMQ waits for active jobs) before exiting.
    await worker.close();
    await queue.close();
  };
}
