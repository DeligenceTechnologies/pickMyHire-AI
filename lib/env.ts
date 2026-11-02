import "server-only";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  /** Where files live: local disk (dev), Supabase Storage, Cloudflare R2 or AWS S3. */
  STORAGE_DRIVER: z.enum(["local", "supabase", "r2", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./.storage"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("interview-private"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Optional custom endpoint for S3-compatible providers (MinIO, Supabase S3, …). */
  S3_ENDPOINT: z.string().url().optional(),
  /** Redis for the background job queue (BullMQ). Unset = recordings are processed inside the web server. */
  REDIS_URL: z.string().optional(),
  /** x264 quality for playback files: lower = better quality and bigger files. 26–28 suits interviews. */
  RECORDING_CRF: z.coerce.number().int().min(18).max(35).default(27),
  /** Hours to keep the uploaded chunks after the playback file is verified (a safety window). */
  RECORDING_CHUNK_RETENTION_HOURS: z.coerce.number().min(0).max(24 * 90).default(24),
  /** Recordings the worker processes at once (each runs one ffmpeg). */
  RECORDING_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  /** ffmpeg binary; defaults to the one bundled by @ffmpeg-installer/ffmpeg. */
  FFMPEG_PATH: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(["auto", "openai", "mock"]).default("auto"),
  EMAIL_PROVIDER: z.enum(["log", "resend"]).default("log"),
  EMAIL_PROVIDER_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  /** New workspaces need this code (shared with approved customers). Unset = sign-up closed except by team invite. */
  SIGNUP_ACCESS_CODE: z.string().min(8).optional(),
}).superRefine((e, ctx) => {
  const required: Record<string, (keyof typeof e)[]> = {
    local: [],
    supabase: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    r2: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"],
    s3: ["S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
  };
  for (const key of required[e.STORAGE_DRIVER]) {
    if (!e[key]) ctx.addIssue({ code: "custom", path: [key], message: `is required when STORAGE_DRIVER=${e.STORAGE_DRIVER}` });
  }
});

type Env = z.infer<typeof EnvSchema>;
let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const raw = Object.fromEntries(
    Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** True when real OpenAI calls should be made. */
export function aiIsLive(): boolean {
  const e = env();
  if (e.AI_PROVIDER === "mock") return false;
  if (e.AI_PROVIDER === "openai") return true;
  return Boolean(e.OPENAI_API_KEY);
}
