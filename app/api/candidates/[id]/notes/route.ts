import { body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { addNote, NoteSchema } from "@/lib/services/candidate-notes";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("candidate:write");
  return addNote(auth.orgId, auth.userId, uuidParam(id), await body(req, NoteSchema));
});
