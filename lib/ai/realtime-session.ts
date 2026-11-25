import "server-only";
import { aiIsLive } from "@/lib/env";
import { buildInstructions, version } from "@/prompts/realtime-interviewer/v1";
import { AI_CONFIG } from "./config";
import { AIError, openai, recordUsage } from "./openai-client";

export type RealtimeCredentials =
  | { mode: "openai"; clientSecret: string; expiresAt: number; model: string; callsUrl: string }
  | { mode: "mock" };

/**
 * Mint a short-lived client secret for the browser's WebRTC connection.
 * The browser never sees OPENAI_API_KEY. Automatic responses are disabled
 * (create_response: false): the backend decides every line the voice says.
 */
export async function createRealtimeCredentials(input: {
  orgId: string;
  interviewerName: string;
  companyName: string;
  jobTitle: string;
  /** Context for speech-to-text (role, company, candidate, likely terms). */
  transcriptionPrompt?: string;
}): Promise<RealtimeCredentials> {
  if (!aiIsLive()) return { mode: "mock" };
  const started = Date.now();
  try {
    const res = await openai().realtime.clientSecrets.create({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model: AI_CONFIG.realtime,
        instructions: buildInstructions(input),
        audio: {
          input: {
            transcription: { model: AI_CONFIG.transcription, language: "en", ...(input.transcriptionPrompt ? { prompt: input.transcriptionPrompt } : {}) },
            noise_reduction: { type: "near_field" },
            turn_detection: {
              type: "semantic_vad",
              // Report end-of-speech promptly; the client decides when an answer is done
              // (button, or a 10 s silence safety net), so pauses never cut answers short.
              eagerness: "auto",
              create_response: false,
              interrupt_response: false,
            },
          },
          // A touch slower than normal: many candidates are not native English speakers.
          output: { voice: AI_CONFIG.voice, speed: 0.95 },
        },
      },
    } as Parameters<ReturnType<typeof openai>["realtime"]["clientSecrets"]["create"]>[0]);
    await recordUsage({ orgId: input.orgId, feature: "realtime_session", model: AI_CONFIG.realtime, promptVersion: version, durationMs: Date.now() - started, success: true });
    return {
      mode: "openai",
      clientSecret: res.value,
      expiresAt: res.expires_at,
      model: AI_CONFIG.realtime,
      callsUrl: "https://api.openai.com/v1/realtime/calls",
    };
  } catch (err) {
    await recordUsage({ orgId: input.orgId, feature: "realtime_session", model: AI_CONFIG.realtime, promptVersion: version, durationMs: Date.now() - started, success: false, errorCode: "session_create_failed" });
    throw new AIError("request_failed", err instanceof Error ? err.message : "Could not create realtime session");
  }
}
