import { z } from "zod";
import { body, route, uuidParam } from "@/lib/api";
import { requirePlatformAdminApi } from "@/lib/auth/session";
import { companyDeletionPreview, deleteCompany } from "@/lib/services/admin";

/** What deleting this company would remove. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  await requirePlatformAdminApi();
  return companyDeletionPreview(uuidParam(id));
});

/** Permanently delete a suspended company and all its data. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const admin = await requirePlatformAdminApi();
  const input = await body(req, z.object({ confirmName: z.string().max(200), deleteMembers: z.boolean() }));
  await deleteCompany(admin.userId, uuidParam(id), input);
  return { ok: true };
}, { rateLimit: { key: "admin-delete", limit: 30, windowMs: 60 * 60_000 } });
