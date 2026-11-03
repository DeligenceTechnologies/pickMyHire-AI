import "server-only";
import { json, withOrg } from "@/lib/database/db";
import { audit } from "@/lib/audit";
import { writeSimpleReport, SIMPLE_REPORT_VERSION } from "@/lib/ai/simple-report";
import { log } from "@/lib/logger";
import type { SimpleReport } from "@/lib/validation/ai-schemas";
import type { StoredReport } from "./processing";

/**
 * Write the one-page simple report from the finished detailed report and save it.
 * Runs after every report generation and on demand for older reports. Throws on
 * failure; the pipeline calls it through `buildSimpleReportQuietly`.
 */
export async function buildSimpleReport(orgId: string, interviewId: string, userId: string | null = null): Promise<SimpleReport> {
  const data = await withOrg(orgId, async (tx) => {
    const [row] = await tx<{ job_title: string; parsed_requirements: unknown; status: string; report_json: StoredReport | null }[]>`
      select j.title as job_title, j.parsed_requirements, r.status, r.report_json
      from interview_reports r join interviews i on i.id = r.interview_id join jobs j on j.id = i.job_id
      where r.interview_id = ${interviewId} and r.organization_id = ${orgId}`;
    return row;
  });
  if (!data || data.status !== "completed" || !data.report_json?.final) throw new Error("The detailed report isn't ready yet.");
  const stored = data.report_json;
  const sections = stored.sections.filter((s) => s.status === "completed");

  const { report, source } = await writeSimpleReport(orgId, {
    jobTitle: data.job_title,
    requirements: data.parsed_requirements,
    summary: stored.final.summary,
    strengths: stored.final.strengths.map((s) => s.point),
    areasToExplore: stored.final.areas_to_explore.map((a) => a.point),
    missingEvidence: stored.final.missing_evidence,
    sections: sections.map((s) => ({ name: s.name, assessment: s.assessment, summary: s.summary })),
  });
  // Section rows follow the interview's own sections, in order, so badges line up.
  const notes = new Map(report.sections.map((s) => [s.name.trim().toLowerCase(), s.note]));
  const simple: SimpleReport = {
    ...report,
    requirements: report.requirements.slice(0, 10),
    sections: sections.map((s) => ({ name: s.name, note: notes.get(s.name.trim().toLowerCase()) ?? "" })).filter((s) => s.note),
    generated_by: source,
    prompt_version: source === "openai" ? SIMPLE_REPORT_VERSION : "demo-heuristic",
    generated_at: new Date().toISOString(),
  };
  await withOrg(orgId, async (tx) => {
    await tx`update interview_reports set simple_report = ${json(simple)} where interview_id = ${interviewId} and status = 'completed'`;
    await audit(tx, { orgId, userId, actorType: userId ? "user" : "system", action: "interview.simple_report_generated", entityType: "interview", entityId: interviewId, metadata: { source } });
  });
  return simple;
}

/** Pipeline use: the detailed report is already saved, so a failure here only logs. */
export async function buildSimpleReportQuietly(orgId: string, interviewId: string) {
  try {
    await buildSimpleReport(orgId, interviewId);
  } catch (err) {
    log.warn("simple_report.failed", { interviewId, err });
  }
}
