import "server-only";
import { createHash } from "node:crypto";
import { log } from "@/lib/logger";
import { AI_CONFIG } from "./config";
import { openai } from "./openai-client";

// The interviewer's introduction as an audio file, in the live interviewer's voice. Played on the Ready
// screen before the interview starts, so it needs no camera, microphone or live voice connection.
// Kept in memory for a while: a refresh or "Play again" doesn't make it again.

const MAX_CACHED = 100;
const cache = new Map<string, Buffer>();
const making = new Map<string, Promise<Buffer>>();

export async function introAudio(text: string): Promise<Buffer> {
  const key = createHash("sha256").update(`${AI_CONFIG.tts}|${AI_CONFIG.voice}|${text}`).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;
  // Two requests at once (double load, two tabs) share one call.
  const pending = making.get(key);
  if (pending) return pending;
  const job = (async () => {
    const started = Date.now();
    const res = await openai().audio.speech.create({
      model: AI_CONFIG.tts,
      voice: AI_CONFIG.voice,
      input: text,
      instructions: "A friendly, professional interviewer welcoming a candidate. Warm, clear and unhurried.",
      response_format: "mp3",
    });
    const audio = Buffer.from(await res.arrayBuffer());
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    cache.set(key, audio);
    log.info("intro_audio.made", { bytes: audio.length, ms: Date.now() - started });
    return audio;
  })().finally(() => making.delete(key));
  making.set(key, job);
  return job;
}
