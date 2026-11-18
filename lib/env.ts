import "server-only";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./.storage"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("interview-private"),
  OPENAI_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(["auto", "openai", "mock"]).default("auto"),
  EMAIL_PROVIDER: z.enum(["log", "resend"]).default("log"),
  EMAIL_PROVIDER_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  /** New workspaces need this code (shared with approved customers). Unset = sign-up closed except by team invite. */
  SIGNUP_ACCESS_CODE: z.string().min(8).optional(),
  /** Online payments (Stripe Checkout). Unset = "Buy" explains how to get interviews instead. */
  STRIPE_SECRET_KEY: z.string().startsWith("sk_", "STRIPE_SECRET_KEY must start with sk_").optional(),
  /** Signing secret of the Stripe webhook (whsec_…), from the Stripe dashboard or `stripe listen`. */
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_", "STRIPE_WEBHOOK_SECRET must start with whsec_").optional(),
  /** While set, buying online and the pricing page are only for people who entered this code (testing before launch). */
  PURCHASE_ACCESS_CODE: z.string().min(8, "PURCHASE_ACCESS_CODE must be at least 8 characters").optional(),
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
