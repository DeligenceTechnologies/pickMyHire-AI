import { body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { assertCandidateAccess } from "@/lib/auth/job-scope";
import { deleteNote, NoteSchema, updateNote } from "@/lib/services/candidate-notes";

export const PATCH = route<{ id: string; noteId: string }>(async (req, { id, noteId }) => {
  const auth = await requireApiAuth("note:write");
  await assertCandidateAccess(auth, uuidParam(id));
  const { body: text } = await body(req, NoteSchema.pick({ body: true }));
  await updateNote(auth.orgId, auth.userId, uuidParam(id), uuidParam(noteId), text);
  return { ok: true };
});

export const DELETE = route<{ id: string; noteId: string }>(async (_req, { id, noteId }) => {
  const auth = await requireApiAuth("note:write");
  await assertCandidateAccess(auth, uuidParam(id));
  await deleteNote(auth.orgId, auth.userId, uuidParam(id), uuidParam(noteId));
  return { ok: true };
});
