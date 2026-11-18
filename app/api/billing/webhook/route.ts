import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { handleStripeEvent } from "@/lib/services/billing";
import { paymentsEnabled, stripe } from "@/lib/stripe";

// Stripe calls this when a payment completes, fails, expires or is refunded.
// Every request is checked against the webhook signing secret; anything unsigned is rejected.
export async function POST(req: NextRequest) {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!paymentsEnabled() || !secret) return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const payload = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, secret);
  } catch {
    log.warn("billing.webhook_bad_signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, result });
  } catch (err) {
    log.error("billing.webhook_failed", { type: event.type, id: event.id, error: err instanceof Error ? err.message : String(err) });
    // A 500 makes Stripe retry later.
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
