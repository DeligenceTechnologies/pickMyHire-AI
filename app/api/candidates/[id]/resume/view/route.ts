import { ApiError, route, uuidParam } from "@/lib/api";
import { assertCandidateAccess } from "@/lib/auth/job-scope";
import { requireApiAuth } from "@/lib/auth/session";
import { withOrg } from "@/lib/database/db";
import { storage } from "@/lib/storage";

/**
 * The candidate's PDF resume, shown inside the app (next to the scorecard), from our own address so it
 * can be framed by our pages only. Other file types are downloaded instead; their text is shown in the page.
 */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("candidate:view");
  const candidateId = uuidParam(id);
  await assertCandidateAccess(auth, candidateId);
  const [doc] = await withOrg(auth.orgId, (tx) => tx<{ file_path: string; mime_type: string; file_name: string }[]>`
    select file_path, mime_type, file_name from candidate_documents where candidate_id = ${candidateId} and organization_id = ${auth.orgId}
    order by created_at desc limit 1`);
  if (!doc) throw new ApiError(404, "No resume uploaded");
  const bytes = await storage().get(doc.file_path);
  // Only real PDFs are shown inline.
  if (doc.mime_type !== "application/pdf" || Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") {
    throw new ApiError(415, "Only PDF resumes can be shown here. Download it instead.");
  }
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.file_name.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
