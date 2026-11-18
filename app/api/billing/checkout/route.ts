import { z } from "zod";
import { ApiError, body, route } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { hasPurchaseAccess } from "@/lib/purchase-access";
import { startCheckout } from "@/lib/services/billing";

const Schema = z.object({
  quantity: z.number().int().min(1).max(100_000),
  accept_terms: z.literal(true, { message: "Please agree to the Terms of Service and Refund policy." }),
});

/** Open a Stripe Checkout page for the chosen number of interviews. The server works out the price. */
export const POST = route(async (req) => {
  const auth = await requireApiAuth("billing:manage");
  if (!(await hasPurchaseAccess())) throw new ApiError(403, "Buying online isn't open yet. Contact us to add interviews.", "purchase_locked");
  const input = await body(req, Schema);
  return startCheckout(auth, input.quantity);
}, { rateLimit: { key: "billing-checkout", limit: 10, windowMs: 60_000 } });
