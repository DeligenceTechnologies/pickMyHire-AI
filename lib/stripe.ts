import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";

let client: Stripe | null = null;

/** True when online payments are set up (a Stripe secret key is configured). */
export function paymentsEnabled(): boolean {
  return Boolean(env().STRIPE_SECRET_KEY);
}

/** True in Stripe test mode (sk_test_…): nothing is really charged. */
export function paymentsTestMode(): boolean {
  return env().STRIPE_SECRET_KEY?.startsWith("sk_test_") ?? false;
}

/** The Stripe client. Only call when paymentsEnabled(). */
export function stripe(): Stripe {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)");
  client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "PickMyHire.ai" } });
  return client;
}
