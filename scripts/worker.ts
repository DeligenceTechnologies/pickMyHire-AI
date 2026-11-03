/*
 * Background worker: encodes interview recordings into playable files and
 * cleans up their chunks. Needs REDIS_URL. Run with `npm run worker`
 * (a separate process/service from the web server).
 */
import { log } from "@/lib/logger";
import { startRecordingsWorker } from "@/lib/jobs/recordings-worker";

async function main() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not set: the worker needs Redis");
  const stop = await startRecordingsWorker();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("worker.stopping", { signal });
    // Render sends SIGTERM and waits `maxShutdownDelaySeconds` (300, see render.yaml) before SIGKILL.
    // Exit just before that; an unfinished encode is picked up again (stalled job / sweep).
    const force = setTimeout(() => process.exit(1), 280_000);
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
