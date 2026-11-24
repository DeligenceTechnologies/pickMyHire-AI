import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { jobScope } from "@/lib/auth/job-scope";
import { getDashboardData, listDashboardJobs, PERIODS, periodOf } from "@/lib/services/dashboard";
import { getQuotaStatus } from "@/lib/services/quota";
import { getPricingFor } from "@/lib/services/pricing";
import { listMyHumanInterviews } from "@/lib/services/human-interviews";
import { RedeemCouponButton } from "@/components/coupons/redeem-coupon";
import { InterviewsLeft, JobsHealth, LiveInterviews, OverviewCards, RecentUpdates, StageCards } from "@/components/dashboard/dashboard-cards";
import { DailyChart, DashboardFilters } from "@/components/dashboard/dashboard-client";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const auth = await requireAuth();
  const sp = await props.searchParams;
  const period = periodOf(sp.period);
  const jobIds = await jobScope(auth);
  const jobOptions = await listDashboardJobs(auth.orgId, jobIds);
  const jobId = typeof sp.job === "string" && jobOptions.some((j) => j.id === sp.job) ? sp.job : null;
  const mine = !jobId && sp.jobs === "mine";
  const candidateData = can(auth.role, "candidate:view");
  const showUsage = can(auth.role, "usage:view");
  const [data, quota, human, pricing] = await Promise.all([
    getDashboardData(auth.orgId, { userId: auth.userId, mine, jobId, days: period.days, candidateData, jobIds }),
    getQuotaStatus(auth.orgId),
    listMyHumanInterviews(auth.orgId, auth),
    showUsage ? getPricingFor(auth.orgId) : null,
  ]);
  const balance = showUsage ? pricing : null;
  return (
    <>
      <PageHeader
        title={`Welcome back, ${auth.name.split(" ")[0]}`}
        description={jobId ? <>Showing one job: <Link href={`/jobs/${jobId}`} className="font-medium text-foreground hover:underline">{jobOptions.find((j) => j.id === jobId)!.title}</Link></> : mine ? "Showing only the jobs you created." : `Here's what's happening at ${auth.orgName}.`}
        actions={<>
          <DashboardFilters periods={PERIODS.map(({ id, label }) => ({ id, label }))} period={period.id} scope={jobId ?? (mine ? "mine" : "all")} jobs={jobOptions} />
          {showUsage && quota.quota !== null && <RedeemCouponButton />}
          {can(auth.role, "candidate:write") && <Link href="/candidates?new=1" className={buttonVariants({ variant: "outline" })}>Add candidate</Link>}
          {can(auth.role, "job:write") && <Link href="/jobs/new" className={buttonVariants()}>New job</Link>}
        </>}
      />
      {sp.denied && <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">You don&apos;t have permission to view that page.</p>}
      <div className="space-y-6">
        <OverviewCards o={data.overview} f={data.funnel} t={data.totals} period={period.label} candidateData={candidateData} />
        {candidateData && <StageCards t={data.totals} />}
        {candidateData && <JobsHealth jobs={data.jobs} mine={mine} />}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className={balance ? "lg:col-span-2" : "lg:col-span-3"}>
            <DailyChart completed={data.daily.completed} unfinished={data.daily.unfinished} previous={data.daily.previousCompleted} days={period.days} period={period.label} />
          </div>
          {balance && <InterviewsLeft quota={quota} usage={data.usage} minutes={balance.pricing.minutesPerInterview} canBuy={can(auth.role, "billing:manage")} />}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className={human.length ? "lg:col-span-2" : "lg:col-span-3"}><RecentUpdates items={data.activity} /></div>
          <LiveInterviews rows={human} />
        </div>
      </div>
    </>
  );
}
