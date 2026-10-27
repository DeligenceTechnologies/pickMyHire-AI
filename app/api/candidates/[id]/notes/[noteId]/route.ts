import { body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { deleteNote, NoteSchema, updateNote } from "@/lib/services/candidate-notes";

export const PATCH = route<{ id: string; noteId: string }>(async (req, { id, noteId }) => {
  const auth = await requireApiAuth("candidate:write");
  const { body: text } = await body(req, NoteSchema.pick({ body: true }));
  await updateNote(auth.orgId, auth.userId, uuidParam(id), uuidParam(noteId), text);
  return { ok: true };
});

export const DELETE = route<{ id: string; noteId: string }>(async (_req, { id, noteId }) => {
  const auth = await requireApiAuth("candidate:write");
  await deleteNote(auth.orgId, auth.userId, uuidParam(id), uuidParam(noteId));
  return { ok: true };
});
