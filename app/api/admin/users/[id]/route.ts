import { z } from "zod";
import { body, route, uuidParam } from "@/lib/api";
import { requirePlatformAdminApi } from "@/lib/auth/session";
import { changeUserEmail, setUserDisabled } from "@/lib/services/admin";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const admin = await requirePlatformAdminApi();
  const input = await body(req, z.object({ disabled: z.boolean().optional(), email: z.string().max(254).optional() }));
  if (input.email !== undefined) await changeUserEmail(admin.userId, uuidParam(id), input.email);
  if (input.disabled !== undefined) await setUserDisabled(admin.userId, uuidParam(id), input.disabled);
  return { ok: true };
});
