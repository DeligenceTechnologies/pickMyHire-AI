import { z } from "zod";

export const OrgSettingsSchema = z.object({
  interviewer_name: z.string().trim().min(1).max(40).default("Alex"),
  retention_days: z.number().int().min(0).max(3650).default(180),
  invite_expiry_days: z.number().int().min(1).max(90).default(14),
  show_scores: z.boolean().default(true),
  consent_version: z.string().default("2026-09-v1"),
  notify_on_completion: z.boolean().default(true),
  /** Email candidates short AI feedback after their interview (they always get a confirmation). */
  candidate_feedback_email: z.boolean().default(true),
});
export type OrgSettings = z.infer<typeof OrgSettingsSchema>;

export function readSettings(raw: unknown): OrgSettings {
  const parsed = OrgSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : OrgSettingsSchema.parse({});
}
