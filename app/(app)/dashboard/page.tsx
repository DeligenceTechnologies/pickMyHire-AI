import Link from "next/link";
import { AlertCircle, Briefcase, CheckCircle2, PlayCircle, Send, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/states";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { getDashboard } from "@/lib/services/workspace";
import { getQuotaStatus } from "@/lib/services/quota";
import { listMyHumanInterviews } from "@/lib/services/human-interviews";
import { UpcomingHumanInterviews } from "@/components/hiring/upcoming-human";
import { timeAgo } from "@/lib/format";
import { RedeemCouponButton } from "@/components/coupons/redeem-coupon";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const auth = await requireAuth();
  const sp = await props.searchParams;
  const [{ stats, recent, attention }, quota, human] = await Promise.all([
    getDashboard(auth.orgId, { includeCandidateData: can(auth.role, "candidate:view") }),
    getQuotaStatus(auth.orgId),
    listMyHumanInterviews(auth.orgId, auth),
  ]);
  const completionRate = stats.started ? Math.round((stats.completed / stats.started) * 100) : null;
  return (
    <>
      <PageHeader
        title={`Welcome back, ${auth.name.split(" ")[0]}`}
        description={`Here's what's happening at ${auth.orgName}.`}
        actions={<>{can(auth.role, "usage:view") && quota.quota !== null && <RedeemCouponButton />}{can(auth.role, "candidate:write") && <Link href="/candidates?new=1" className={buttonVariants({ variant: "outline" })}>Add candidate</Link>}{can(auth.role, "job:write") && <Link href="/jobs/new" className={buttonVariants()}>New job</Link>}</>}
      />
      {sp.denied && <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">You don&apos;t have permission to view that page.</p>}
      {quota.plan !== "trial" && quota.remaining !== null && quota.remaining <= 1 && can(auth.role, "interview:write") && (
        <p className={`mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${quota.remaining === 0 ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"}`}>
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>
            {quota.remaining === 0
              ? `You've used all ${quota.quota} free interviews${quota.inProgress ? ` (${quota.inProgress} still in progress)` : ""}. Contact us to add more.`
              : `1 free interview left of ${quota.quota}. Contact us to add more.`}
            {" "}<Link href="/#contact" className="font-medium underline">Contact us</Link>
            {can(auth.role, "usage:view") && <> or <RedeemCouponButton variant="link" /></>}
          </span>
        </p>
      )}
      <UpcomingHumanInterviews rows={human} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Active jobs" value={stats.active_jobs} icon={Briefcase} />
        <StatCard label="Candidates" value={stats.candidates} icon={Users} />
        <StatCard label="Interviews invited" value={stats.invited} icon={Send} />
        <StatCard label="Started" value={stats.started} hint={stats.in_progress ? `${stats.in_progress} in progress now` : undefined} icon={PlayCircle} />
        <StatCard label="Completed" value={stats.completed} hint={completionRate != null ? `${completionRate}% completion rate` : "No interviews started yet"} icon={CheckCircle2} />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border bg-card lg:col-span-2">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h2 className="font-semibold">Recent interviews</h2>
            <Link href="/interviews" className="text-sm text-primary hover:underline">View all</Link>
          </div>
          {recent.length === 0 ? (
            <div className="p-5"><EmptyState icon={Send} title="No interviews yet" description="Create a job, add a candidate and send an interview invitation." action={<Link href="/jobs/new" className={buttonVariants()}>Create a job</Link>} /></div>
          ) : (
            <ul className="divide-y">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link href={`/interviews/${r.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.candidate_name}</p>
                      <p className="truncate text-sm text-muted-foreground">{r.job_title}</p>
                    </div>
                    <StatusBadge status={r.status} />
                    <span className="hidden w-20 text-right text-xs text-muted-foreground sm:block">{timeAgo(r.at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-xl border bg-card">
          <div className="border-b px-5 py-4"><h2 className="font-semibold">Jobs needing attention</h2></div>
          {attention.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nothing needs your attention.</p>
          ) : (
            <ul className="divide-y">
              {attention.map((a) => (
                <li key={a.id}>
                  <Link href={`/jobs/${a.id}`} className="flex gap-3 px-5 py-3 hover:bg-muted/50">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{a.title}</p>
                      <p className="text-xs text-muted-foreground">{a.reason}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
