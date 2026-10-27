import "server-only";
import { z } from "zod";
import { json, withOrg, withSystem } from "@/lib/database/db";
import { audit, notify } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { reconcileMatch, screenApplicationAI, SCREENER_VERSION } from "@/lib/ai/application-screener";
import { runInBackground } from "@/lib/background";
import { env } from "@/lib/env";
import { companyBrand, emailTemplates, replyToUser, sendEmail } from "@/lib/email";
import { log } from "@/lib/logger";
import { generateToken } from "@/lib/security/tokens";
import type { ApplicationScreening, JobRequirements, MatchLevel, ResumeProfile } from "@/lib/validation/ai-schemas";
import { parseCandidateResume, storeResume } from "./candidates";
import { detectResumeKind } from "./document-text";
import { createInterview, type CreateInterviewInput } from "./interviews";
import { checkAnswers, saveAnswersTx } from "./application-answers";
import { readForm, type ApplicationForm } from "@/lib/application-form";

export type ApplicationStatus = "new" | "interview_invited" | "declined";

export const ApplyInputSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.string().trim().toLowerCase().email("Please enter a valid email"),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  linkedin_url: z.string().trim().max(300).optional().transform((v) => v || null)
    .refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "Enter a full URL starting with https://"),
  cover_note: z.string().trim().max(3000).optional().transform((v) => v || null),
  consent: z.literal(true, { error: "Please agree to continue" }),
});
export type ApplyInput = z.infer<typeof ApplyInputSchema>;

export function applyUrl(slug: string) {
  return `${env().APP_URL}/apply/${slug}`;
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "job";
}

/** Turn the public apply link on/off. The slug is created once and kept stable. */
export async function setApplyLink(orgId: string, userId: string, jobId: string, enabled: boolean) {
  return withOrg(orgId, async (tx) => {
    const [job] = await tx<{ title: string; apply_slug: string | null }[]>`select title, apply_slug from jobs where id = ${jobId} and organization_id = ${orgId}`;
    if (!job) throw new ApiError(404, "Job not found");
    const slug = job.apply_slug ?? `${slugify(job.title)}-${generateToken(6).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6)}`;
    await tx`update jobs set apply_enabled = ${enabled}, apply_slug = ${slug} where id = ${jobId}`;
    await audit(tx, { orgId, userId, action: "job.apply_link_changed", entityType: "job", entityId: jobId, metadata: { enabled } });
    return { enabled, slug, url: applyUrl(slug) };
  });
}

export type PublicJob = {
  id: string; organization_id: string; title: string; description: string; location: string | null; employment_type: string | null;
  experience_min: number | null; experience_max: number | null; required_skills: string[]; preferred_skills: string[];
  responsibilities: string[]; company_name: string;
  logo_path: string | null; logo_updated_at: Date | null; brand_color: string | null;
  /** The job's application questions (never the internal hiring limits). */
  application_form: ApplicationForm;
};

/** Public job lookup: only active jobs with the apply link switched on. */
export async function getPublicJob(slug: string): Promise<PublicJob | null> {
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) return null;
  const [job] = await withSystem((tx) => tx<PublicJob[]>`
    select j.id, j.organization_id, j.title, j.description, j.location, j.employment_type, j.experience_min, j.experience_max,
      j.required_skills, j.preferred_skills, j.responsibilities, o.name as company_name,
      o.logo_path, o.logo_updated_at, o.brand_color, j.application_form
    from jobs j join organizations o on o.id = j.organization_id
    where j.apply_slug = ${slug} and j.apply_enabled and j.status = 'active' and o.status = 'active'`);
  return job ? { ...job, application_form: readForm(job.application_form) } : null;
}

/** Public submission: create/reuse the candidate, store the resume, then parse + screen in the background. */
export async function submitApplication(slug: string, input: ApplyInput, file: { name: string; bytes: Uint8Array }, rawAnswers: unknown = {}) {
  const job = await getPublicJob(slug);
  if (!job) throw new ApiError(404, "This job is no longer accepting applications.");
  const answers = checkAnswers(job.application_form, rawAnswers); // before anything is created
  detectResumeKind(file.name, file.bytes); // fail fast on bad files before creating anything
  const orgId = job.organization_id;

  const { candidateId, created } = await withOrg(orgId, async (tx) => {
    const [existing] = await tx<{ id: string }[]>`select id from candidates where organization_id = ${orgId} and email = ${input.email}`;
    if (existing) {
      const dup = await tx`select 1 from job_applications where job_id = ${job.id} and candidate_id = ${existing.id}`;
      if (dup.length) throw new ApiError(409, "You've already applied for this role. We'll be in touch.");
      await tx`update candidates set phone = coalesce(phone, ${input.phone}) where id = ${existing.id}`;
      return { candidateId: existing.id, created: false };
    }
    const [c] = await tx<{ id: string }[]>`
      insert into candidates (organization_id, name, email, phone) values (${orgId}, ${input.name}, ${input.email}, ${input.phone}) returning id`;
    await audit(tx, { orgId, actorType: "candidate", action: "candidate.created", entityType: "candidate", entityId: c.id, metadata: { source: "public_apply" } });
    return { candidateId: c.id, created: true };
  });

  try {
    await storeResume(orgId, null, candidateId, file);
  } catch (err) {
    if (created) await withOrg(orgId, (tx) => tx`delete from candidates where id = ${candidateId}`);
    throw err;
  }

  const applicationId = await withOrg(orgId, async (tx) => {
    const [a] = await tx<{ id: string }[]>`
      insert into job_applications (organization_id, job_id, candidate_id, linkedin_url, cover_note, consent_given, consent_timestamp)
      values (${orgId}, ${job.id}, ${candidateId}, ${input.linkedin_url}, ${input.cover_note}, true, now())
      on conflict (job_id, candidate_id) do nothing returning id`;
    if (!a) throw new ApiError(409, "You've already applied for this role. We'll be in touch.");
    await saveAnswersTx(tx, orgId, { jobId: job.id, candidateId, form: job.application_form, answers, answeredBy: null });
    await audit(tx, { orgId, actorType: "candidate", action: "application.received", entityType: "application", entityId: a.id, metadata: { job_id: job.id } });
    await notify(tx, { orgId, type: "application.received", payload: { application_id: a.id, job_id: job.id, candidate: input.name, job: job.title } });
    return a.id;
  });

  runInBackground("application.process", async () => {
    await parseCandidateResume(orgId, candidateId).catch(() => {});
    await screenApplication(orgId, applicationId);
  });
  runInBackground("application.confirm_email", async () => {
    const tpl = emailTemplates.applicationReceived({ candidateName: input.name.split(" ")[0], jobTitle: job.title, companyName: job.company_name });
    // Replies reach whoever created the job.
    const [owner] = await withSystem((tx) => tx<{ created_by: string | null }[]>`select created_by from jobs where id = ${job.id}`);
    await sendEmail({ to: input.email, ...tpl, orgId, replyTo: await replyToUser(owner?.created_by), brand: await companyBrand(orgId) });
  });
  log.info("application.received", { jobId: job.id, applicationId });
  return { applicationId };
}

/** AI screening against the job's requirements. Idempotent; safe to retry. */
export async function screenApplication(orgId: string, applicationId: string) {
  const [ctx] = await withOrg(orgId, (tx) => tx<{
    job_title: string; job_description: string; parsed_requirements: JobRequirements | null; required_skills: string[]; preferred_skills: string[];
    parsed_profile: ResumeProfile | null; resume_text: string | null; cover_note: string | null;
  }[]>`
    update job_applications a set screening_status = 'processing', screening_error = null
    from jobs j, candidates c
    where a.id = ${applicationId} and a.organization_id = ${orgId} and j.id = a.job_id and c.id = a.candidate_id
    returning j.title as job_title, j.description as job_description, j.parsed_requirements, j.required_skills, j.preferred_skills,
      c.parsed_profile, c.resume_text, a.cover_note`);
  if (!ctx) throw new ApiError(404, "Application not found");
  // Fall back to the recruiter-entered skills if the description hasn't been parsed.
  const requirements: JobRequirements | null = ctx.parsed_requirements ?? (ctx.required_skills.length || ctx.preferred_skills.length ? {
    summary: ctx.job_title,
    skills: [...ctx.required_skills.map((name) => ({ name, importance: "required" as const })), ...ctx.preferred_skills.map((name) => ({ name, importance: "preferred" as const }))],
    experience: { minimum_years: null, maximum_years: null },
    responsibilities: [],
    seniority: "unknown",
  } : null);
  try {
    const { screening, source } = await screenApplicationAI({
      orgId,
      jobTitle: ctx.job_title,
      jobDescription: ctx.job_description,
      requirements,
      profile: ctx.parsed_profile,
      resumeText: ctx.resume_text ?? "",
      coverNote: ctx.cover_note,
    });
    const { level, met, total } = reconcileMatch(screening);
    await withOrg(orgId, async (tx) => {
      await tx`update job_applications set screening_status = 'completed', match_level = ${level}, requirements_met = ${met}, requirements_total = ${total},
        screening = ${json({ ...screening, ai_match_level: screening.match_level, source, prompt_version: source === "openai" ? SCREENER_VERSION : "demo-heuristic" })}
        where id = ${applicationId}`;
      await audit(tx, { orgId, actorType: "system", action: "application.screened", entityType: "application", entityId: applicationId, metadata: { level, source } });
    });
  } catch (err) {
    log.warn("application.screen_failed", { applicationId, err });
    await withOrg(orgId, (tx) => tx`update job_applications set screening_status = 'failed',
      screening_error = ${"AI screening failed. The application is saved — you can retry."} where id = ${applicationId}`);
    throw err;
  }
}

export type ApplicationRow = {
  id: string; job_id: string; candidate_id: string; status: ApplicationStatus; created_at: Date; screening_status: string;
  match_level: MatchLevel | null; requirements_met: number | null; requirements_total: number | null; interview_id: string | null;
  candidate_name: string; candidate_email: string; interview_status: string | null;
};

export async function listApplications(orgId: string, jobId: string, opts: { match?: string; status?: string } = {}) {
  return withOrg(orgId, (tx) => tx<ApplicationRow[]>`
    select a.id, a.job_id, a.candidate_id, a.status, a.created_at, a.screening_status, a.match_level, a.requirements_met, a.requirements_total,
      a.interview_id, c.name as candidate_name, c.email as candidate_email, i.status::text as interview_status
    from job_applications a join candidates c on c.id = a.candidate_id left join interviews i on i.id = a.interview_id
    where a.job_id = ${jobId} and a.organization_id = ${orgId}
      ${opts.match ? tx`and a.match_level = ${opts.match}` : tx``}
      ${opts.status ? tx`and a.status = ${opts.status}` : tx``}
    order by a.created_at desc`);
}

export async function applicationCounts(orgId: string, jobId: string) {
  const [row] = await withOrg(orgId, (tx) => tx<{ total: number; new: number }[]>`
    select count(*)::int as total, count(*) filter (where status = 'new')::int as new from job_applications where job_id = ${jobId} and organization_id = ${orgId}`);
  return row;
}

export async function getApplication(orgId: string, applicationId: string) {
  const [a] = await withOrg(orgId, (tx) => tx<(ApplicationRow & {
    linkedin_url: string | null; cover_note: string | null; consent_timestamp: Date | null; screening: (ApplicationScreening & { ai_match_level: MatchLevel; source: string }) | null;
    screening_error: string | null; reviewed_at: Date | null; reviewer_name: string | null; job_title: string; candidate_phone: string | null;
    parsed_profile: ResumeProfile | null; parse_status: string | null; has_resume: boolean;
  })[]>`
    select a.id, a.job_id, a.candidate_id, a.status, a.created_at, a.screening_status, a.match_level, a.requirements_met, a.requirements_total,
      a.interview_id, a.linkedin_url, a.cover_note, a.consent_timestamp, a.screening, a.screening_error, a.reviewed_at,
      u.name as reviewer_name, j.title as job_title, c.name as candidate_name, c.email as candidate_email, c.phone as candidate_phone,
      c.parsed_profile, c.parse_status, (c.resume_file_path is not null) as has_resume, i.status::text as interview_status
    from job_applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id
    left join users u on u.id = a.reviewed_by left join interviews i on i.id = a.interview_id
    where a.id = ${applicationId} and a.organization_id = ${orgId}`);
  return a ?? null;
}

export async function setApplicationStatus(orgId: string, userId: string, applicationId: string, status: "new" | "declined") {
  await withOrg(orgId, async (tx) => {
    const [a] = await tx`update job_applications set status = ${status}, reviewed_by = ${userId}, reviewed_at = now()
      where id = ${applicationId} and organization_id = ${orgId} and status <> 'interview_invited' returning id`;
    if (!a) throw new ApiError(409, "This application already has an interview.");
    await audit(tx, { orgId, userId, action: "application.status_changed", entityType: "application", entityId: applicationId, metadata: { status } });
  });
}

/** Recruiter decision: invite the applicant to the AI interview for this job. */
export async function inviteApplicant(orgId: string, userId: string, applicationId: string, sendInvite: boolean,
  round: Omit<CreateInterviewInput, "jobId" | "candidateId" | "sendInvite"> = {}) {
  const app = await getApplication(orgId, applicationId);
  if (!app) throw new ApiError(404, "Application not found");
  const { id, link } = await createInterview(orgId, userId, { ...round, jobId: app.job_id, candidateId: app.candidate_id, sendInvite });
  await withOrg(orgId, async (tx) => {
    await tx`update job_applications set status = 'interview_invited', interview_id = ${id}, reviewed_by = ${userId}, reviewed_at = now() where id = ${applicationId}`;
    await audit(tx, { orgId, userId, action: "application.interview_invited", entityType: "application", entityId: applicationId, metadata: { interview_id: id } });
  });
  return { interviewId: id, link };
}
