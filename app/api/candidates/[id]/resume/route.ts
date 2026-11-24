import { NextResponse } from "next/server";
import { ApiError, route, uuidParam } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/session";
import { resumeDownloadUrl, uploadResume } from "@/lib/services/candidates";
import { RESUME_MAX_BYTES } from "@/lib/services/document-text";
import { assertCandidateAccess } from "@/lib/auth/job-scope";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("candidate:write");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > RESUME_MAX_BYTES + 64 * 1024) throw new ApiError(413, "Resume files must be 10 MB or smaller.");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Choose a file to upload.");
  await uploadResume(auth.orgId, auth.userId, uuidParam(id), { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  return { ok: true };
}, { rateLimit: { key: "resume-upload", limit: 60, windowMs: 60 * 60_000 } });

export const GET = route<{ id: string }>(async (req, { id }) => {
  const auth = await requireApiAuth("candidate:view");
  await assertCandidateAccess(auth, uuidParam(id));
  const url = await resumeDownloadUrl(auth.orgId, uuidParam(id));
  return NextResponse.redirect(new URL(url, req.nextUrl.origin));
});
