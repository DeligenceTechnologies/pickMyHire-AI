import "server-only";
// Queue for recording post-processing (BullMQ on Redis).
//   transcode — join a part's chunks into a playable MP4/M4A
//   purge     — delete a part's chunks after its file is verified + retention window
//   sweep     — scheduled safety net that re-queues anything missed (see worker)
// Job ids are derived from the recording id, so queuing the same part twice is a no-op.

import { Queue, type JobsOptions } from "bullmq";
import { log } from "@/lib/logger";
import { createRedis } from "./redis";

export const RECORDINGS_QUEUE = "recordings";

export type RecordingJobName = "transcode" | "purge" | "sweep";
export type RecordingJobData = { orgId: string; recordingId: string } | Record<string, never>;

/**
 * Retries inside one job (1 min, then 2 min apart). After that the sweep may
 * queue the part again while it has attempts left (MAX_PLAYBACK_ATTEMPTS, counted in the database).
 */
export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 14 * 24 * 3600 },
};

const g = globalThis as unknown as { __recordingsQueue?: Queue };

export function recordingsQueue(): Queue {
  if (!g.__recordingsQueue) {
    g.__recordingsQueue = new Queue(RECORDINGS_QUEUE, { connection: createRedis("producer"), defaultJobOptions });
    g.__recordingsQueue.on("error", (err) => log.warn("queue.redis_error", { queue: RECORDINGS_QUEUE, err }));
  }
  return g.__recordingsQueue;
}

export const jobIds = {
  transcode: (recordingId: string) => `transcode-${recordingId}`,
  purge: (recordingId: string) => `purge-${recordingId}`,
};

/**
 * Add a job unless one with the same id is already waiting, delayed or running.
 * A finished or failed leftover with that id is removed first, so a part can be
 * queued again later (e.g. a retry from the sweep). Safe under races: BullMQ
 * ignores an add whose job id already exists.
 */
export async function addUnique(queue: Queue, name: RecordingJobName, jobId: string, data: RecordingJobData, opts: JobsOptions = {}) {
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state !== "completed" && state !== "failed" && state !== "unknown") return false;
    // A job that's locked (just picked up) can't be removed; it's running, which is what we want.
    await existing.remove().catch(() => {});
  }
  await queue.add(name, data, { ...opts, jobId });
  return true;
}
