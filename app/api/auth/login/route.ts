import { z } from "zod";
import { ApiError, body, route } from "@/lib/api";
import { createSession } from "@/lib/auth/session";
import { isRateLimited, rateLimit } from "@/lib/security/rate-limit";
import { authenticate } from "@/lib/services/accounts";

const Schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required").max(200),
});

/** Wrong passwords per account, across all IPs: stops slow brute force from many addresses. */
const ACCOUNT_FAILURES = { limit: 10, windowMs: 15 * 60_000 };

export const POST = route(async (req) => {
  const { email, password } = await body(req, Schema);
  const key = `login-account:${email}`;
  const blocked = isRateLimited(key, ACCOUNT_FAILURES.limit, ACCOUNT_FAILURES.windowMs);
  if (blocked.limited) throw new ApiError(429, "Too many sign-in attempts for this account. Please wait a few minutes or reset your password.", "rate_limited");
  let result: Awaited<ReturnType<typeof authenticate>>;
  try {
    result = await authenticate(email, password);
  } catch (err) {
    // Only wrong passwords count: a user signing in normally never uses up the limit.
    if (err instanceof ApiError && err.status === 401) rateLimit(key, ACCOUNT_FAILURES.limit, ACCOUNT_FAILURES.windowMs);
    throw err;
  }
  const { userId, orgId, isPlatformAdmin } = result;
  await createSession(userId, orgId);
  // Platform admins without a company of their own land in the admin area.
  return { ok: true, home: !orgId && isPlatformAdmin ? "/admin" : "/dashboard" };
}, { rateLimit: { key: "login", limit: 10, windowMs: 10 * 60_000 } });
