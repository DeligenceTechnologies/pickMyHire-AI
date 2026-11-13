// In-memory sliding-window limiter. Adequate for a single Node instance;
// swap for Redis/Upstash when running multiple instances.
const buckets = new Map<string, number[]>();
/** Longest window seen, so a sweep never drops hits another limit still counts. */
let longestWindowMs = 0;
const MAX_KEYS = 50_000;

/** Drop keys whose hits have all expired. Never clears live counters, so flooding new keys can't reset anyone's limit. */
function sweep(now: number) {
  for (const [key, hits] of buckets) {
    if (!hits.length || now - hits[hits.length - 1] >= longestWindowMs) buckets.delete(key);
  }
  // Still full of live keys (a flood): drop single-hit keys first (what a flood of new
  // keys looks like), oldest first, so counters that are close to a limit survive.
  // Trims to 90% so the next sweep isn't on the very next request.
  if (buckets.size > MAX_KEYS) {
    let excess = buckets.size - Math.floor(MAX_KEYS * 0.9);
    for (const pass of [1, Infinity]) {
      for (const [key, hits] of buckets) {
        if (excess <= 0) return;
        if (hits.length <= pass) {
          buckets.delete(key);
          excess--;
        }
      }
    }
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (windowMs > longestWindowMs) longestWindowMs = windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > MAX_KEYS) sweep(now);
  return { ok: true, retryAfterSec: 0 };
}

/** Whether `key` is over its limit, without counting this call (for "count only failures" limits). */
export function isRateLimited(key: string, limit: number, windowMs: number): { limited: boolean; retryAfterSec: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length < limit) return { limited: false, retryAfterSec: 0 };
  return { limited: true, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)) };
}

/** Test helper: forget every counter. */
export function resetRateLimits() {
  buckets.clear();
  longestWindowMs = 0;
}

/**
 * The caller's IP for rate limiting.
 *
 * The left of X-Forwarded-For is whatever the client sent, so it can't be trusted on its own:
 * - CLIENT_IP_HEADER names a header your edge sets and clients can't override
 *   (for example "cf-connecting-ip" behind Cloudflare, "true-client-ip").
 * - Otherwise TRUSTED_PROXY_HOPS (the number of proxies in front of the app) picks the
 *   X-Forwarded-For entry the outermost trusted proxy appended.
 * - With neither set, the old behaviour (left-most entry) is kept so a deploy never
 *   puts every user behind one shared IP by mistake.
 */
export function clientIp(headers: Headers, cfg: { header?: string; hops?: number } = ipConfig()): string {
  if (cfg.header) {
    const v = headers.get(cfg.header)?.trim();
    if (v) return v;
  }
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (chain.length) {
    if (cfg.hops && cfg.hops > 0) return chain[Math.max(0, chain.length - cfg.hops)];
    return chain[0];
  }
  return headers.get("x-real-ip")?.trim() || "local";
}

function ipConfig(): { header?: string; hops?: number } {
  const header = process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || undefined;
  const hops = Number(process.env.TRUSTED_PROXY_HOPS);
  return { header, hops: Number.isInteger(hops) && hops > 0 ? hops : undefined };
}
