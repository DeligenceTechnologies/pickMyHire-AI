import { z } from "zod";
import { checkLocation } from "@/lib/hiring";
import { body, route } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { getSettings, updateSettings } from "@/lib/services/workspace";

export const GET = route(async () => {
  const auth = await requireApiAuth();
  return { id: auth.orgId, role: auth.role, ...(await getSettings(auth.orgId)) };
});

const Schema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  settings: z.object({
    interviewer_name: z.string().trim().min(1).max(40).optional(),
    retention_days: z.number().int().min(0).max(3650).optional(),
    invite_expiry_days: z.number().int().min(1).max(90).optional(),
    show_scores: z.boolean().optional(),
    notify_on_completion: z.boolean().optional(),
    candidate_feedback_email: z.boolean().optional(),
    candidate_contact_email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200).nullable().optional(),
    candidate_contact_phone: z.string().trim().max(40)
      .refine((v) => !checkLocation("phone", v).error, "Enter a valid phone number, with the country code").nullable().optional(),
  }).optional(),
});

export const PATCH = route(async (req) => {
  const input = await body(req, Schema);
  const needsPrivacy = input.settings?.retention_days !== undefined;
  const auth = await requireApiAuth(needsPrivacy ? "privacy:manage" : "org:manage");
  await updateSettings(auth.orgId, auth.userId, input);
  return { ok: true };
});
