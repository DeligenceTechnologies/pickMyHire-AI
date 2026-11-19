import "server-only";
import { z } from "zod";
import { json, withOrg } from "@/lib/database/db";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { parseResume } from "@/lib/ai/resume-parser";
import { runInBackground } from "@/lib/background";
import { log } from "@/lib/logger";
import { paths, storage } from "@/lib/storage";
import type { ResumeProfile } from "@/lib/validation/ai-schemas";
import { detectResumeKind, extractText } from "./document-text";
import { calculateExperience } from "@/lib/resume/experience";
import { refreshMatches } from "./candidate-match";
import { ensurePipeline } from "./pipeline";

/** Total experience from the resume's role dates, checked (the resume's own stated total is compared too). */
export function experienceOf(profile: ResumeProfile | null) {
  return calculateExperience(profile?.roles ?? [], { statedYears: profile?.years_experience ?? null });
}

export const CandidateInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().max(40).nullable().default(null),
});
export type CandidateInput = z.infer<typeof CandidateInputSchema>;

export type CandidateRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  resume_file_path: string | null;
  parsed_profile: ResumeProfile | null;
  parse_status: "pending" | "processing" | "completed" | "failed" | null;
  parse_error: string | null;
  archived_at?: Date | null;
  archived_reason?: string | null;
  created_at: Date;
  updated_at: Date;
};

export const PAGE_SIZE = 20;

export async function listCandidates(orgId: string, opts: { q?: string; jobId?: string; page?: number } = {}) {
  const q = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
  const page = Math.max(1, opts.page ?? 1);
  return withOrg(orgId, async (tx) => {
    const where = tx`c.organization_id = ${orgId}
      ${q ? tx`and (c.name ilike ${q} or c.email::text ilike ${q} or (c.parsed_profile->'skills')::text ilike ${q})` : tx``}
      ${opts.jobId ? tx`and exists (select 1 from interviews i where i.candidate_id = c.id and i.job_id = ${opts.jobId})` : tx``}`;
    const rows = await tx<(CandidateRow & { interview_count: number; latest_status: string | null; latest_job: string | null })[]>`
      select c.id, c.name, c.email, c.phone, c.resume_file_path, c.parsed_profile, c.parse_status, c.parse_error, c.created_at, c.updated_at,
        (select count(*)::int from interviews i where i.candidate_id = c.id) as interview_count,
        (select i.status::text from interviews i where i.candidate_id = c.id order by i.created_at desc limit 1) as latest_status,
        (select j.title from interviews i join jobs j on j.id = i.job_id where i.candidate_id = c.id order by i.created_at desc limit 1) as latest_job
      from candidates c where ${where}
      order by c.created_at desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
    const [{ total }] = await tx<{ total: number }[]>`select count(*)::int as total from candidates c where ${where}`;
    return { rows, total, page, pageSize: PAGE_SIZE };
  });
}

export async function getCandidate(orgId: string, candidateId: string) {
  return withOrg(orgId, async (tx) => {
    const [c] = await tx<(CandidateRow & { resume_text: string | null })[]>`
      select * from candidates where id = ${candidateId} and organization_id = ${orgId}`;
    if (!c) return null;
    const documents = await tx<{ id: string; file_name: string; mime_type: string; file_size: number; created_at: Date }[]>`
      select id, file_name, mime_type, file_size, created_at from candidate_documents where candidate_id = ${candidateId} order by created_at desc`;
    // AI and human interviews together; human ones are dated by when they're scheduled.
    const interviews = await tx<{ id: string; kind: "ai" | "human"; status: string; job_title: string; job_id: string; created_at: Date; completed_at: Date | null; round_name: string | null; attempt: number; scheduled_at: Date | null; timezone: string | null }[]>`
      select * from (
        select i.id, 'ai' as kind, i.status::text as status, j.title as job_title, j.id as job_id, i.created_at, i.completed_at, i.round_name, i.attempt,
          null::timestamptz as scheduled_at, null::text as timezone
        from interviews i join jobs j on j.id = i.job_id where i.candidate_id = ${candidateId}
        union all
        select h.id, 'human', h.status, j.title, j.id, h.created_at, null, h.round_name, h.attempt, h.scheduled_at, h.timezone
        from human_interviews h join jobs j on j.id = h.job_id where h.candidate_id = ${candidateId}
      ) x order by job_title, coalesce(scheduled_at, created_at) desc`;
    return { ...c, documents, interviews };
  });
}

export async function createCandidate(orgId: string, userId: string, input: CandidateInput) {
  return withOrg(orgId, async (tx) => {
    const existing = await tx`select id from candidates where organization_id = ${orgId} and email = ${input.email}`;
    if (existing.length) throw new ApiError(409, "A candidate with this email already exists.");
    const [row] = await tx<{ id: string }[]>`
      insert into candidates (organization_id, name, email, phone, created_by)
      values (${orgId}, ${input.name}, ${input.email}, ${input.phone}, ${userId}) returning id`;
    await audit(tx, { orgId, userId, action: "candidate.created", entityType: "candidate", entityId: row.id });
    return row.id;
  });
}

/**
 * Add a candidate with their resume (required). The file is checked first, so an unreadable resume adds
 * nobody; if storing it still fails, the new candidate is removed again.
 */
export async function createCandidateWithResume(orgId: string, userId: string, input: CandidateInput, file: { name: string; bytes: Uint8Array }, jobId: string | null = null) {
  await readResume(file);
  if (jobId) {
    const [job] = await withOrg(orgId, (tx) => tx`select 1 from jobs where id = ${jobId} and organization_id = ${orgId}`);
    if (!job) throw new ApiError(404, "Job not found");
  }
  const id = await createCandidate(orgId, userId, input);
  // Added for a job: they join its pipeline (Not invited yet), and their resume is checked against it once analysed.
  if (jobId) await withOrg(orgId, (tx) => ensurePipeline(tx, orgId, jobId, id));
  try {
    await uploadResume(orgId, userId, id, file);
  } catch (err) {
    await withOrg(orgId, (tx) => tx`delete from candidates where id = ${id} and organization_id = ${orgId}`).catch(() => {});
    await storage().deletePrefix(paths.candidatePrefix(orgId, id)).catch(() => {});
    throw err;
  }
  return id;
}

export async function updateCandidate(orgId: string, userId: string, candidateId: string, input: CandidateInput) {
  await withOrg(orgId, async (tx) => {
    const dup = await tx`select 1 from candidates where organization_id = ${orgId} and email = ${input.email} and id <> ${candidateId}`;
    if (dup.length) throw new ApiError(409, "Another candidate already uses this email.");
    const [row] = await tx`update candidates set name = ${input.name}, email = ${input.email}, phone = ${input.phone}
      where id = ${candidateId} and organization_id = ${orgId} returning id`;
    if (!row) throw new ApiError(404, "Candidate not found");
    await audit(tx, { orgId, userId, action: "candidate.updated", entityType: "candidate", entityId: candidateId });
  });
}

/** Store a resume privately, extract text, then parse it with AI in the background. */
export async function uploadResume(orgId: string, userId: string, candidateId: string, file: { name: string; bytes: Uint8Array }) {
  await storeResume(orgId, userId, candidateId, file);
  runInBackground("resume.parse", () => parseCandidateResume(orgId, candidateId));
}

/** Validate, extract text and privately store a resume. Parsing is left to the caller. */
export async function storeResume(orgId: string, userId: string | null, candidateId: string, file: { name: string; bytes: Uint8Array }) {
  const exists = await withOrg(orgId, (tx) => tx`select 1 from candidates where id = ${candidateId} and organization_id = ${orgId}`);
  if (!exists.length) throw new ApiError(404, "Candidate not found");
  const { kind, mime, text } = await readResume(file, candidateId);

  const docId = crypto.randomUUID();
  const path = paths.resume(orgId, candidateId, docId, kind);
  await storage().put(path, file.bytes, mime);

  await withOrg(orgId, async (tx) => {
    await tx`insert into candidate_documents (id, organization_id, candidate_id, type, file_name, file_path, mime_type, file_size, extracted_text)
      values (${docId}, ${orgId}, ${candidateId}, 'resume', ${file.name.slice(0, 200)}, ${path}, ${mime}, ${file.bytes.byteLength}, ${text})`;
    await tx`update candidates set resume_file_path = ${path}, resume_text = ${text}, parse_status = 'pending', parse_error = null
      where id = ${candidateId}`;
    await audit(tx, { orgId, userId, actorType: userId ? "user" : "candidate", action: "candidate.resume_uploaded", entityType: "candidate", entityId: candidateId, metadata: { kind, size: file.bytes.byteLength } });
  });
}

/** Check a resume file and extract its text (throws a clear 4xx error for wrong or unreadable files). */
async function readResume(file: { name: string; bytes: Uint8Array }, candidateId?: string) {
  const { kind, mime } = detectResumeKind(file.name, file.bytes);
  let text: string;
  try {
    text = await extractText(kind, file.bytes);
  } catch (err) {
    log.warn("resume.extract_failed", { candidateId, kind, err });
    throw new ApiError(422, "We couldn't read text from this file. Try exporting it as a PDF or DOCX again.");
  }
  if (text.length < 40) throw new ApiError(422, "This file doesn't contain readable text (scanned images aren't supported yet).");
  return { kind, mime, text };
}

export async function parseCandidateResume(orgId: string, candidateId: string) {
  const [c] = await withOrg(orgId, (tx) => tx<{ resume_text: string | null }[]>`
    update candidates set parse_status = 'processing', parse_error = null where id = ${candidateId} and organization_id = ${orgId}
    returning resume_text`);
  if (!c?.resume_text) throw new ApiError(400, "Upload a resume first.");
  try {
    const { profile } = await parseResume({ orgId, resumeText: c.resume_text });
    const exp = experienceOf(profile);
    await withOrg(orgId, (tx) => tx`update candidates set parsed_profile = ${json(profile)}, parse_status = 'completed',
      experience_months = ${exp.months}, experience_approximate = ${exp.approximate}, experience_flags = ${json(exp.flags)} where id = ${candidateId}`);
    runInBackground("candidate.match", () => refreshMatches(orgId, candidateId));
    return profile;
  } catch (err) {
    log.warn("resume.parse_failed", { candidateId, err });
    await withOrg(orgId, (tx) => tx`update candidates set parse_status = 'failed', parse_error = ${"Resume analysis failed. The file is stored safely — you can retry."} where id = ${candidateId}`);
    throw err;
  }
}

export async function resumeDownloadUrl(orgId: string, candidateId: string) {
  const [doc] = await withOrg(orgId, (tx) => tx<{ file_path: string; mime_type: string }[]>`
    select file_path, mime_type from candidate_documents where candidate_id = ${candidateId} and organization_id = ${orgId}
    order by created_at desc limit 1`);
  if (!doc) throw new ApiError(404, "No resume uploaded");
  return storage().signedUrl(doc.file_path, 300, doc.mime_type);
}

/** Delete a candidate and every artifact: resume files, recordings, transcripts, reports. */
export async function deleteCandidate(orgId: string, userId: string, candidateId: string) {
  const interviewIds = await withOrg(orgId, async (tx) => {
    const [c] = await tx`select id from candidates where id = ${candidateId} and organization_id = ${orgId}`;
    if (!c) throw new ApiError(404, "Candidate not found");
    const rows = await tx<{ id: string }[]>`select id from interviews where candidate_id = ${candidateId}`;
    await tx`delete from candidates where id = ${candidateId}`;
    await audit(tx, { orgId, userId, action: "candidate.deleted", entityType: "candidate", entityId: candidateId, metadata: { interviews: rows.length } });
    return rows.map((r) => r.id);
  });
  await storage().deletePrefix(paths.candidatePrefix(orgId, candidateId));
  for (const id of interviewIds) await storage().deletePrefix(paths.interviewPrefix(orgId, id));
}
