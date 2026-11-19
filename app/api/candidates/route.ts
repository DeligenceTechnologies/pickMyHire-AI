import { ApiError, route } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { CandidateInputSchema, createCandidateWithResume, listCandidates } from "@/lib/services/candidates";
import { RESUME_MAX_BYTES } from "@/lib/services/document-text";

export const GET = route(async (req) => {
  const auth = await requireApiAuth("candidate:view");
  const sp = req.nextUrl.searchParams;
  return listCandidates(auth.orgId, { q: sp.get("q") ?? undefined, jobId: sp.get("jobId") ?? undefined, page: Number(sp.get("page") ?? 1) });
});

/** Add a candidate: name, email, optional phone, their resume (required) and optionally the job they're for, as a form upload. */
export const POST = route(async (req) => {
  const auth = await requireApiAuth("candidate:write");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > RESUME_MAX_BYTES + 64 * 1024) throw new ApiError(413, "Resume files must be 10 MB or smaller.");
  const form = await req.formData().catch(() => { throw new ApiError(400, "Add the candidate's details and resume."); });
  const text = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : undefined; };
  const parsed = CandidateInputSchema.safeParse({ name: text("name"), email: text("email"), phone: text("phone")?.trim() || null });
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? "Check the candidate's details.", "validation",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new ApiError(400, "Add the candidate's resume (PDF, DOCX or TXT).", "resume_required", [{ path: "file", message: "A resume is required." }]);
  }
  const jobId = text("jobId")?.trim() || null;
  if (jobId && !/^[0-9a-f-]{36}$/i.test(jobId)) throw new ApiError(400, "Choose a valid job.");
  const id = await createCandidateWithResume(auth.orgId, auth.userId, parsed.data, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, jobId);
  return { id };
}, { rateLimit: { key: "candidate-create", limit: 120, windowMs: 60 * 60_000 } });
