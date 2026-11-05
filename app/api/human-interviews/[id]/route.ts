import { z } from "zod";
import { body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { cancelHumanInterview, rescheduleHumanInterview, ScheduleSchema, setHumanOutcome } from "@/lib/services/human-interviews";

const Schema = z.discriminatedUnion("action", [
  ScheduleSchema.extend({ action: z.literal("reschedule"), reason: z.string().trim().max(500).nullable().optional() }),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(1, "Add a reason").max(500), sendEmail: z.boolean().default(true) }),
  z.object({ action: z.literal("outcome"), status: z.enum(["completed", "no_show", "scheduled"]) }),
]);

/** Reschedule, cancel, or record what happened (completed / no-show / undo). */
export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("interview:write");
  const hid = uuidParam(id);
  const input = await body(req, Schema);
  if (input.action === "reschedule") return { ok: true, ...(await rescheduleHumanInterview(auth.orgId, auth.userId, hid, input)) };
  if (input.action === "cancel") return { ok: true, ...(await cancelHumanInterview(auth.orgId, auth.userId, hid, input)) };
  await setHumanOutcome(auth.orgId, auth.userId, hid, input.status);
  return { ok: true };
});
