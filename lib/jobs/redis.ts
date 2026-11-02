import "server-only";
import { Redis, type RedisOptions } from "ioredis";
import { env } from "@/lib/env";

/** True when a Redis queue is configured. Without it, background work runs in-process. */
export function queueEnabled(): boolean {
  return Boolean(env().REDIS_URL);
}

/**
 * A Redis connection for BullMQ.
 * - "producer" (web server adding jobs): fail fast, so a Redis outage never hangs a request.
 * - "worker": retry forever (BullMQ requires `maxRetriesPerRequest: null` for blocking commands).
 */
export function createRedis(role: "producer" | "worker"): Redis {
  const url = env().REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  const opts: RedisOptions = role === "worker"
    ? { maxRetriesPerRequest: null, enableReadyCheck: false }
    : { maxRetriesPerRequest: 2, enableOfflineQueue: false, connectTimeout: 5_000 };
  // rediss:// URLs (Upstash, Render external, Redis Cloud) need TLS; ioredis enables it from the scheme.
  return new Redis(url, opts);
}
