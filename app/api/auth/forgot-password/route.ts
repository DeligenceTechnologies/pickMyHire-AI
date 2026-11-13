import { z } from "zod";
import { body, route } from "@/lib/api";
import { rateLimit } from "@/lib/security/rate-limit";
import { requestPasswordReset } from "@/lib/services/accounts";

export const POST = route(async (req) => {
  const { email } = await body(req, z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email") }));
  // Per address too, so nobody can flood one inbox from many IPs. Same response either way (no account probing).
  if (rateLimit(`forgot-account:${email}`, 3, 60 * 60_000).ok) await requestPasswordReset(email);
  return { ok: true };
}, { rateLimit: { key: "forgot", limit: 5, windowMs: 15 * 60_000 } });
