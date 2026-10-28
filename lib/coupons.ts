import { z } from "zod";

// Promo codes: shared by the admin pages, the redeem box and the server.

export const CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/;

/** Codes are case-insensitive and stored in capitals; spaces people paste in are ignored. */
export const normalizeCode = (code: string) => code.replace(/\s+/g, "").toUpperCase();

export const CouponSchema = z.object({
  code: z.string().transform(normalizeCode).pipe(z.string().regex(CODE_PATTERN, "Use 4–32 letters, numbers, - or _")),
  interviews: z.number().int().min(0).max(10000),
  trialDays: z.number().int().min(0).max(365),
  maxUses: z.number().int().min(1, "At least 1").max(1_000_000).nullable(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date").nullable(),
  active: z.boolean(),
  note: z.string().trim().max(500).nullable(),
}).refine((c) => c.interviews > 0 || c.trialDays > 0, { path: ["interviews"], message: "Add free interviews, trial days or both" });
export type CouponInput = z.infer<typeof CouponSchema>;

export const RedeemSchema = z.object({ code: z.string().max(64).transform(normalizeCode) });

/** "10 free interviews · 14 extra trial days" */
export function describeReward(interviews: number, trialDays: number) {
  return [
    interviews > 0 && `${interviews} free interview${interviews === 1 ? "" : "s"}`,
    trialDays > 0 && `${trialDays} extra trial day${trialDays === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ");
}

/** Readable random code, without look-alike characters (0/O, 1/I/L). */
export function generateCode(length = 8) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** The last valid day, as picked in the admin form (stored as the end of that day, UTC). */
export const formatExpiry = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
