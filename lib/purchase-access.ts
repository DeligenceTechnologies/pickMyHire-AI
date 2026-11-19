import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

// Before launch, buying online (Settings → Billing and Stripe checkout) is open only to people who entered
// PURCHASE_ACCESS_CODE (kept in a cookie for 30 days). Remove the variable to open buying to everyone.
const COOKIE = "pmh_buy_access";
const MAX_AGE = 30 * 24 * 3600;

/** A value that proves the code was entered, without storing the code. Changing the code signs everyone out. */
function proof(code: string) {
  return createHmac("sha256", env().APP_SECRET).update(`purchase-access:${code}`).digest("base64url");
}

function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** True while buying is limited to people with the access code. */
export function purchaseLocked(): boolean {
  return Boolean(env().PURCHASE_ACCESS_CODE);
}

/** True when buying is open to this visitor (no code set, or they entered it). */
export async function hasPurchaseAccess(): Promise<boolean> {
  const code = env().PURCHASE_ACCESS_CODE;
  if (!code) return true;
  const value = (await cookies()).get(COOKIE)?.value;
  return !!value && same(value, proof(code));
}

/** Checks the code and, if right, remembers it in this browser. */
export async function unlockPurchases(input: string): Promise<boolean> {
  const code = env().PURCHASE_ACCESS_CODE;
  if (!code) return true;
  if (!same(proof(input.trim()), proof(code))) return false;
  (await cookies()).set(COOKIE, proof(code), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: MAX_AGE });
  return true;
}
