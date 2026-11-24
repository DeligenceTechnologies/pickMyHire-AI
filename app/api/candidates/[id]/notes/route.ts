import { ApiError, body, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { addNote, NoteSchema } from "@/lib/services/candidate-notes";
import { candidateJobsInScope } from "@/lib/auth/job-scope";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("note:write");
  const candidateId = uuidParam(id);
  const input = await body(req, NoteSchema);
  // Interviewers note on candidates of their jobs, and each note is tagged with one of those jobs.
  const jobs = await candidateJobsInScope(auth, candidateId);
  if (jobs) {
    if (!jobs.length) throw new ApiError(404, "Candidate not found");
    if (!input.job_id || !jobs.includes(input.job_id)) input.job_id = jobs[0];
  }
  return addNote(auth.orgId, auth.userId, candidateId, input);
});
