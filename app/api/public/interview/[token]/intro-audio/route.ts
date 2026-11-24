import { ApiError, route } from "@/lib/api";
import { introAudio } from "@/lib/ai/intro-audio";
import { aiIsLive } from "@/lib/env";
import { getIntroText } from "@/lib/interview/controller";

/** The interviewer's spoken introduction (mp3), before the interview starts. 204 in demo mode (the browser speaks it). */
export const GET = route<{ token: string }>(async (_req, { token }) => {
  const text = await getIntroText(token);
  if (!text) throw new ApiError(404, "There's no introduction for this interview.");
  if (!aiIsLive()) return new Response(null, { status: 204 });
  const audio = await introAudio(text);
  return new Response(new Uint8Array(audio), {
    headers: { "Content-Type": "audio/mpeg", "Content-Length": String(audio.length), "Cache-Control": "private, max-age=3600" },
  });
}, { rateLimit: { key: "intro-audio", limit: 30, windowMs: 60_000 } });
