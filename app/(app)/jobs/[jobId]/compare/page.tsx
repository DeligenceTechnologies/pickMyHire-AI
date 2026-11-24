import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { CompareTable } from "@/components/jobs/compare-table";
import { requireAuth } from "@/lib/auth/session";
import { isUuid } from "@/lib/ids";
import { getJob } from "@/lib/services/jobs";
import { getComparison, getSettings } from "@/lib/services/workspace";
import { requireJobAccess } from "@/lib/auth/job-scope";

export const metadata = { title: "Compare candidates" };

export default async function ComparePage(props: PageProps<"/jobs/[jobId]/compare">) {
  const auth = await requireAuth("report:view");
  const { jobId } = await props.params;
  if (!isUuid(jobId)) notFound();
  const job = await getJob(auth.orgId, jobId);
  await requireJobAccess(auth, jobId);
  if (!job) notFound();
  const sp = await props.searchParams;
  const [data, { settings }] = await Promise.all([getComparison(auth.orgId, jobId, typeof sp.round === "string" ? sp.round : null), getSettings(auth.orgId)]);
  return (
    <>
      <PageHeader back={{ href: `/jobs/${jobId}`, label: job.title }} title="Compare candidates"
        description="Section assessments side by side. These are evidence summaries, not rankings — open each report to review the evidence before deciding." />
      {data.rounds.length > 1 && (
        <nav className="mb-5 flex gap-1 overflow-x-auto border-b" aria-label="Interview round">
          {data.rounds.map((r) => (
            <Link key={r} href={`/jobs/${jobId}/compare?round=${encodeURIComponent(r)}`} aria-current={r === data.round ? "page" : undefined}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${r === data.round ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {r}
            </Link>
          ))}
        </nav>
      )}
      <CompareTable columns={data.columns} rows={data.rows.map((r) => ({ ...r, completed_at: r.completed_at?.toISOString() ?? null }))} showScores={settings.show_scores} />
    </>
  );
}
