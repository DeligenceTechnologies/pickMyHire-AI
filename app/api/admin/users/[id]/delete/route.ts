import { z } from "zod";
import { body, route, uuidParam } from "@/lib/api";
import { requirePlatformAdminApi } from "@/lib/auth/session";
import { deleteUser, userDeletionPreview } from "@/lib/services/admin";

/** What deleting this user would remove, and anything that blocks it. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const admin = await requirePlatformAdminApi();
  return userDeletionPreview(admin.userId, uuidParam(id));
});

/** Permanently delete the user (and companies where they're the only member). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const admin = await requirePlatformAdminApi();
  const { confirmEmail } = await body(req, z.object({ confirmEmail: z.string().max(254) }));
  await deleteUser(admin.userId, uuidParam(id), confirmEmail);
  return { ok: true };
}, { rateLimit: { key: "admin-delete", limit: 30, windowMs: 60 * 60_000 } });
