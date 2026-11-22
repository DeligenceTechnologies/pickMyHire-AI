import { NextResponse } from "next/server";
import { ApiError, route, uuidParam } from "@/lib/api";
import { requirePlatformAdminApi } from "@/lib/auth/session";
import { adminPurchaseDocumentUrl, type PurchaseDoc } from "@/lib/services/billing";

const DOCS: PurchaseDoc[] = ["invoice", "pdf", "receipt"];

/** Platform admin: open any purchase's invoice, invoice PDF or receipt with a fresh Stripe link. */
export const GET = route<{ id: string; doc: string }>(async (_req, { id, doc }) => {
  await requirePlatformAdminApi();
  if (!DOCS.includes(doc as PurchaseDoc)) throw new ApiError(404, "Not found");
  const url = await adminPurchaseDocumentUrl(uuidParam(id), doc as PurchaseDoc);
  if (!url || !/^https:\/\/([a-z0-9-]+\.)*stripe\.com\//.test(url)) throw new ApiError(404, "This document isn't available.");
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
}, { rateLimit: { key: "admin-billing-document", limit: 120, windowMs: 60_000 } });
