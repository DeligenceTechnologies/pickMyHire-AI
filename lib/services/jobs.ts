import "server-only";
import { z } from "zod";
import { json, withOrg } from "@/lib/database/db";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { parseJob } from "@/lib/ai/job-parser";
import { log } from "@/lib/logger";
import { runInBackground } from "@/lib/background";
import type { JobRequirements } from "@/lib/validation/ai-schemas";
import { MAX_ROUNDS, RoundInputSchema, saveRounds } from "./rounds";
import { ApplicationFormSchema, DEFAULT_FORM, HiringLimitsSchema, NO_LIMITS, type ApplicationForm, type HiringLimits } from "@/lib/application-form";

const list = z.array(z.string().trim().min(1).max(80)).max(40);

export const JobInputSchema = z.object({
  title: z.string().trim().min(2, "Title is required").max(120),
  description: z.string().trim().max(20_000).default(""),
  location: z.string().trim().max(120).nullable().default(null),
  employment_type: z.enum(["full_time", "part_time", "contract", "internship", "temporary"]).nullable().default("full_time"),
  experience_min: z.number().int().min(0).max(50).nullable().default(null),
  experience_max: z.number().int().min(0).max(50).nullable().default(null),
  required_skills: list.default([]),
  preferred_skills: list.default([]),
  responsibilities: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  /** Interview rounds in order (e.g. Screening → Technical), each with its own template. */
  rounds: z.array(RoundInputSchema).min(1, "Add at least one interview round").max(MAX_ROUNDS),
  status: z.enum(["draft", "active", "paused", "closed"]).default("draft"),
  /** Compare the candidate's face with a reference photo during AI interviews. */
  face_verification: z.boolean().default(true),
  /** Questions on the apply page (and for direct invites). */
  application_form: ApplicationFormSchema.default(DEFAULT_FORM),
  /** Internal limits for the fit check: never shown to candidates. */
  hiring_limits: HiringLimitsSchema.default(NO_LIMITS),
}).refine((j) => j.experience_min == null || j.experience_max == null || j.experience_min <= j.experience_max, {
  message: "Minimum experience cannot exceed maximum",
  path: ["experience_min"],
});
export type JobInput = z.infer<typeof JobInputSchema>;

export type JobRow = {
  id: string;
  organization_id: string;
  title: string;
  description: string;
  location: string | null;
  employment_type: string | null;
  experience_min: number | null;
  experience_max: number | null;
  required_skills: string[];
  preferred_skills: string[];
  responsibilities: string[];
  status: "draft" | "active" | "paused" | "closed";
  parsed_requirements: JobRequirements | null;
  parse_status: "pending" | "processing" | "completed" | "failed" | null;
  parse_error: string | null;
  interview_template_id: string | null;
  apply_enabled: boolean;
  apply_slug: string | null;
  face_verification: boolean;
  application_form: ApplicationForm | null;
  hiring_limits: HiringLimits | null;
  created_at: Date;
  updated_at: Date;
};

export async function listJobs(orgId: string, opts: { q?: string; status?: string } = {}) {
  const q = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
  return withOrg(orgId, (tx) => tx<(JobRow & { template_name: string | null; interview_count: number; completed_count: number; in_progress_count: number })[]>`
    select j.*, t.name as template_name,
      (select count(*)::int from interviews i where i.job_id = j.id) as interview_count,
      (select count(*)::int from interviews i where i.job_id = j.id and i.status in ('completed','processing','report_ready')) as completed_count,
      (select count(*)::int from interviews i where i.job_id = j.id and i.status = 'in_progress') as in_progress_count
    from jobs j left join interview_templates t on t.id = j.interview_template_id
    where j.organization_id = ${orgId}
      ${opts.status ? tx`and j.status = ${opts.status}` : tx``}
      ${q ? tx`and (j.title ilike ${q} or j.location ilike ${q} or j.required_skills::text ilike ${q})` : tx``}
    order by case j.status when 'active' then 0 when 'draft' then 1 when 'paused' then 2 else 3 end, j.updated_at desc`);
}

export async function getJob(orgId: string, jobId: string) {
  const [job] = await withOrg(orgId, (tx) => tx<(JobRow & { template_name: string | null })[]>`
    select j.*, t.name as template_name from jobs j left join interview_templates t on t.id = j.interview_template_id
    where j.id = ${jobId} and j.organization_id = ${orgId}`);
  return job ?? null;
}

export async function createJob(orgId: string, userId: string, input: JobInput) {
  const id = await withOrg(orgId, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into jobs (organization_id, title, description, location, employment_type, experience_min, experience_max,
        required_skills, preferred_skills, responsibilities, interview_template_id, status, created_by, parse_status, face_verification,
        application_form, hiring_limits)
      values (${orgId}, ${input.title}, ${input.description}, ${input.location}, ${input.employment_type}, ${input.experience_min},
        ${input.experience_max}, ${json(input.required_skills)}, ${json(input.preferred_skills)}, ${json(input.responsibilities)},
        ${input.rounds.find((r) => r.kind !== "human")?.template_id ?? null}, ${input.status}, ${userId}, ${input.description ? "pending" : null}, ${input.face_verification},
        ${json(input.application_form)}, ${json(input.hiring_limits)})
      returning id`;
    await saveRounds(tx, orgId, row.id, input.rounds);
    await audit(tx, { orgId, userId, action: "job.created", entityType: "job", entityId: row.id });
    return row.id;
  });
  if (input.description) runInBackground("job.parse", () => parseJobRequirements(orgId, id, userId));
  return id;
}

export async function updateJob(orgId: string, userId: string, jobId: string, input: JobInput) {
  const descChanged = await withOrg(orgId, async (tx) => {
    const [prev] = await tx<{ description: string; required_skills: string[]; preferred_skills: string[] }[]>`
      select description, required_skills, preferred_skills from jobs where id = ${jobId} and organization_id = ${orgId}`;
    if (!prev) throw new ApiError(404, "Job not found");
    await tx`
      update jobs set title = ${input.title}, description = ${input.description}, location = ${input.location},
        employment_type = ${input.employment_type}, experience_min = ${input.experience_min}, experience_max = ${input.experience_max},
        required_skills = ${json(input.required_skills)}, preferred_skills = ${json(input.preferred_skills)},
        responsibilities = ${json(input.responsibilities)}, status = ${input.status}, face_verification = ${input.face_verification},
        application_form = ${json(input.application_form)}, hiring_limits = ${json(input.hiring_limits)}
      where id = ${jobId} and organization_id = ${orgId}`;
    await saveRounds(tx, orgId, jobId, input.rounds);
    await audit(tx, { orgId, userId, action: "job.updated", entityType: "job", entityId: jobId });
    return prev.description !== input.description
      || JSON.stringify(prev.required_skills) !== JSON.stringify(input.required_skills)
      || JSON.stringify(prev.preferred_skills) !== JSON.stringify(input.preferred_skills);
  });
  if (descChanged && input.description) runInBackground("job.parse", () => parseJobRequirements(orgId, jobId, userId));
}

export async function setJobStatus(orgId: string, userId: string, jobId: string, status: JobRow["status"]) {
  await withOrg(orgId, async (tx) => {
    const [row] = await tx`update jobs set status = ${status} where id = ${jobId} and organization_id = ${orgId} returning id`;
    if (!row) throw new ApiError(404, "Job not found");
    await audit(tx, { orgId, userId, action: "job.status_changed", entityType: "job", entityId: jobId, metadata: { status } });
  });
}

/** AI-parse the job description into structured requirements. Safe to call repeatedly. */
export async function parseJobRequirements(orgId: string, jobId: string, userId: string | null) {
  const job = await getJob(orgId, jobId);
  if (!job) throw new ApiError(404, "Job not found");
  await withOrg(orgId, (tx) => tx`update jobs set parse_status = 'processing', parse_error = null where id = ${jobId}`);
  try {
    const requirements = await parseJob({
      orgId,
      title: job.title,
      description: job.description,
      requiredSkills: job.required_skills,
      preferredSkills: job.preferred_skills,
    });
    await withOrg(orgId, async (tx) => {
      await tx`update jobs set parsed_requirements = ${json(requirements)}, parse_status = 'completed' where id = ${jobId}`;
      await audit(tx, { orgId, userId, actorType: userId ? "user" : "system", action: "job.parsed", entityType: "job", entityId: jobId });
    });
    return requirements;
  } catch (err) {
    log.warn("job.parse_failed", { jobId, err });
    await withOrg(orgId, (tx) => tx`update jobs set parse_status = 'failed', parse_error = ${"We couldn't analyze the job description. You can retry."} where id = ${jobId}`);
    throw err;
  }
}

export async function deleteJob(orgId: string, userId: string, jobId: string) {
  await withOrg(orgId, async (tx) => {
    const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from interviews where job_id = ${jobId}`;
    if (count > 0) throw new ApiError(409, "This job has interviews. Close it instead of deleting.");
    await tx`delete from jobs where id = ${jobId} and organization_id = ${orgId}`;
    await audit(tx, { orgId, userId, action: "job.deleted", entityType: "job", entityId: jobId });
  });
}
