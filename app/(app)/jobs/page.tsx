import Link from "next/link";
import { Suspense } from "react";
import { Briefcase, MapPin, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { SearchBar } from "@/components/common/search-bar";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/states";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { employmentTypeLabel, timeAgo } from "@/lib/format";
import { listJobs } from "@/lib/services/jobs";
import { jobScope } from "@/lib/auth/job-scope";

export const metadata = { title: "Jobs" };

export default async function JobsPage(props: PageProps<"/jobs">) {
  const auth = await requireAuth();
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const status = typeof sp.status === "string" ? sp.status : undefined;
  const jobs = await listJobs(auth.orgId, { q, status, jobIds: await jobScope(auth) });
  const canWrite = can(auth.role, "job:write");
  return (
    <>
      <PageHeader title="Jobs" description="Roles you're interviewing for." actions={canWrite && <Link href="/jobs/new" className={buttonVariants()}>New job</Link>} />
      <div className="mb-4">
        <Suspense>
          <SearchBar placeholder="Search jobs, skills, locations…" filters={[{ name: "status", label: "All statuses", options: ["active", "draft", "paused", "closed"].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) }]} />
        </Suspense>
      </div>
      {jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title={q || status ? "No matching jobs" : "No jobs yet"} description={q || status ? "Try a different search or filter." : "Create your first job to start inviting candidates to AI interviews."}
          action={canWrite && !q && !status && <Link href="/jobs/new" className={buttonVariants()}>Create job</Link>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {jobs.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="group rounded-xl border bg-card p-5 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold leading-snug group-hover:text-primary">{j.title}</h3>
                <StatusBadge status={j.status} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {j.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{j.location}</span>}
                {j.employment_type && <span>{employmentTypeLabel[j.employment_type]}</span>}
                {j.experience_min != null && <span>{j.experience_min}{j.experience_max != null ? `–${j.experience_max}` : "+"} yrs</span>}
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {j.required_skills.slice(0, 5).map((s) => <span key={s} className="rounded-md bg-muted px-2 py-0.5 text-xs">{s}</span>)}
                {j.required_skills.length > 5 && <span className="text-xs text-muted-foreground">+{j.required_skills.length - 5}</span>}
              </div>
              <div className="mt-5 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{j.interview_count} interviews · {j.completed_count} completed</span>
                <span>Updated {timeAgo(j.updated_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
