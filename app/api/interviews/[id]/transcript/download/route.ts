import { ApiError, route, uuidParam } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/session";
import { assertInterviewAccess } from "@/lib/auth/job-scope";
import { withOrg } from "@/lib/database/db";
import { formatClock } from "@/lib/format";
import { getInterviewDetail, getTranscript } from "@/lib/services/interviews";

/** The transcript as a plain-text file: "[mm:ss] Speaker: text", times from the start of the interview. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const auth = await requireApiAuth("interview:view");
  await assertInterviewAccess(auth, uuidParam(id));
  const interviewId = uuidParam(id);
  const detail = await getInterviewDetail(auth.orgId, interviewId);
  if (!detail) throw new ApiError(404, "Interview not found");
  const segments = await getTranscript(auth.orgId, interviewId);
  const who = { interviewer: "Interviewer", candidate: detail.candidate_name, system: "Note" } as const;
  const lines = segments.map((s) => `[${formatClock(s.start_time_ms)}] ${who[s.speaker]}: ${s.text.trim()}`);
  const title = `${detail.candidate_name} · ${detail.job_title}${detail.round_name ? ` · ${detail.round_name}` : ""}`;
  const started = detail.started_at ? new Date(detail.started_at).toUTCString() : "Not started";
  const body = `${title}\nInterview started: ${started}\nTranscript from PickMyHire.ai\n\n${lines.join("\n\n")}\n`;
  await withOrg(auth.orgId, (tx) => audit(tx, { orgId: auth.orgId, userId: auth.userId, action: "interview.transcript_downloaded", entityType: "interview", entityId: interviewId }));
  const name = `${detail.candidate_name} - ${detail.job_title} - transcript`.replace(/[^\w .-]+/g, "").trim();
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.txt"`,
      "Cache-Control": "no-store",
    },
  });
});
