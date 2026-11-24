import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { JobForm } from "@/components/jobs/job-form";
import { requireAuth } from "@/lib/auth/session";
import { getJob } from "@/lib/services/jobs";
import { listRounds } from "@/lib/services/rounds";
import { listTemplates } from "@/lib/services/templates";
import { listJobTeam, listTeamOptions } from "@/lib/services/job-team";
import { readForm, readLimits } from "@/lib/application-form";

export const metadata = { title: "Edit job" };

export default async function EditJobPage(props: PageProps<"/jobs/[jobId]/edit">) {
  const auth = await requireAuth("job:write");
  const { jobId } = await props.params;
  const [job, templates, rounds, teamOptions, team] = await Promise.all([getJob(auth.orgId, jobId).catch(() => null), listTemplates(auth.orgId), listRounds(auth.orgId, jobId).catch(() => []),
    listTeamOptions(auth.orgId), listJobTeam(auth.orgId, jobId).catch(() => [])]);
  if (!job) notFound();
  return (
    <>
      <PageHeader title={`Edit ${job.title}`} back={{ href: `/jobs/${job.id}`, label: job.title }} />
      <JobForm jobId={job.id} templates={templates} teamOptions={teamOptions} currentUserId={auth.userId} initial={{
        title: job.title, description: job.description, location: job.location, employment_type: job.employment_type,
        experience_min: job.experience_min, experience_max: job.experience_max, required_skills: job.required_skills,
        preferred_skills: job.preferred_skills, responsibilities: job.responsibilities, status: job.status, face_verification: job.face_verification,
        application_form: readForm(job.application_form), hiring_limits: readLimits(job.hiring_limits), team: team.map((m) => m.user_id),
        rounds: rounds.length
          ? rounds.map((r) => ({ id: r.id, key: r.id, name: r.name, kind: r.kind, template_id: r.template_id ?? "", criteria: r.criteria, guide: r.guide ?? "" }))
          : [{ key: "first", name: "Screening", kind: "ai" as const, template_id: templates.find((t) => t.is_default)?.id ?? templates[0]?.id ?? "", criteria: [], guide: "" }],
      }} />
    </>
  );
}
