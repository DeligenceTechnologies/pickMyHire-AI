import "server-only";
import { env } from "@/lib/env";
import { LocalStorageDriver } from "./local";
import { S3StorageDriver } from "./s3";
import { SupabaseStorageDriver } from "./supabase";
import type { StorageDriver } from "./types";

export type { StorageDriver } from "./types";
export { ObjectTooLargeError } from "./types";

let driver: StorageDriver | null = null;

/**
 * Private object storage, chosen by STORAGE_DRIVER (local | supabase | r2 | s3).
 * All objects are private; access is via short-lived signed URLs.
 */
export function storage(): StorageDriver {
  if (driver) return driver;
  const e = env();
  switch (e.STORAGE_DRIVER) {
    case "supabase":
      driver = new SupabaseStorageDriver(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, e.SUPABASE_STORAGE_BUCKET);
      break;
    case "r2":
      driver = S3StorageDriver.r2({ accountId: e.R2_ACCOUNT_ID!, accessKeyId: e.R2_ACCESS_KEY_ID!, secretAccessKey: e.R2_SECRET_ACCESS_KEY!, bucket: e.R2_BUCKET! });
      break;
    case "s3":
      driver = new S3StorageDriver({
        bucket: e.S3_BUCKET!,
        region: e.S3_REGION!,
        accessKeyId: e.S3_ACCESS_KEY_ID!,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
        endpoint: e.S3_ENDPOINT,
        forcePathStyle: Boolean(e.S3_ENDPOINT),
      });
      break;
    default:
      driver = new LocalStorageDriver(e.LOCAL_STORAGE_DIR, e.APP_SECRET);
  }
  return driver;
}

export const paths = {
  resume: (orgId: string, candidateId: string, docId: string, ext: string) => `${orgId}/candidates/${candidateId}/resume-${docId}.${ext}`,
  candidatePrefix: (orgId: string, candidateId: string) => `${orgId}/candidates/${candidateId}/`,
  recordingChunk: (orgId: string, interviewId: string, part: number, index: number) =>
    `${orgId}/interviews/${interviewId}/recording/part-${part}/chunk-${String(index).padStart(6, "0")}.bin`,
  recordingChunkPrefix: (orgId: string, interviewId: string, part: number) => `${orgId}/interviews/${interviewId}/recording/part-${part}/`,
  recordingFile: (orgId: string, interviewId: string, part: number) => `${orgId}/interviews/${interviewId}/recording/part-${part}.webm`,
  /**
   * The joined, playable file for one part (mp4 video or m4a voice). Versioned:
   * a re-encode writes a new object instead of overwriting one that may be cached or playing.
   */
  recordingPlayback: (orgId: string, interviewId: string, part: number, version: number, ext: "mp4" | "m4a") =>
    `${orgId}/interviews/${interviewId}/recording/part-${part}-v${version}.${ext}`,
  interviewPrefix: (orgId: string, interviewId: string) => `${orgId}/interviews/${interviewId}/`,
  logo: (orgId: string, version: number, ext: string) => `${orgId}/branding/logo-${version}.${ext}`,
};
