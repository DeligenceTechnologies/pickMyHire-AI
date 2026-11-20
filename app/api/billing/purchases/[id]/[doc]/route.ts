import { NextResponse } from "next/server";
import { ApiError, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { purchaseDocumentUrl, type PurchaseDoc } from "@/lib/services/billing";

const DOCS: PurchaseDoc[] = ["invoice", "pdf", "receipt"];

/** Open a purchase's invoice, invoice PDF or receipt with a fresh Stripe link (Stripe's links expire). */
export const GET = route<{ id: string; doc: string }>(async (req, { id, doc }) => {
  const auth = await requireApiAuth("billing:manage");
  if (!DOCS.includes(doc as PurchaseDoc)) throw new ApiError(404, "Not found");
  const url = await purchaseDocumentUrl(auth.orgId, uuidParam(id), doc as PurchaseDoc);
  if (!url || !/^https:\/\/([a-z0-9-]+\.)*stripe\.com\//.test(url)) throw new ApiError(404, "This document isn't available.");
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
}, { rateLimit: { key: "billing-document", limit: 60, windowMs: 60_000 } });
