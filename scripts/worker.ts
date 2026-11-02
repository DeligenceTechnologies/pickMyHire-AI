/*
 * Background worker: encodes interview recordings into playable files and
 * cleans up their chunks. Needs REDIS_URL. Run with `npm run worker`
 * (a separate process/service from the web server).
 */
import { log } from "@/lib/logger";
import { startRecordingsWorker } from "@/lib/jobs/recordings-worker";
import { ffmpegPath } from "@/lib/recordings/ffmpeg";

async function main() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not set: the worker needs Redis");
  log.info("worker.ffmpeg", { path: ffmpegPath() });
  const stop = await startRecordingsWorker();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("worker.stopping", { signal });
    // Render sends SIGTERM and waits before SIGKILL; don't hang forever.
    const force = setTimeout(() => process.exit(1), 5 * 60_000);
    force.unref();
    try {
      await stop();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("worker.crashed", { err });
  process.exit(1);
});
