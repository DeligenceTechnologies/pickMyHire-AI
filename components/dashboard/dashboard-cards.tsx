import Link from "next/link";
import { ArrowRight, Briefcase, CalendarDays, CheckCircle2, ClipboardCheck, PlayCircle, Send, Star, TrendingDown, TrendingUp, UserPlus, Users, Video, type LucideIcon } from "lucide-react";
import { formatInZone } from "@/lib/hiring";
import { formatDate, initials, timeAgo } from "@/lib/format";
import { STALE_DAYS, type ActivityItem, type Dashboard, type DashboardJob, type JobHealth } from "@/lib/services/dashboard";
import type { HumanListRow } from "@/lib/services/human-interviews";
import type { QuotaStatus } from "@/lib/services/quota";
import { cn } from "@/lib/utils";

// The dashboard's cards, in the app's card style (same icons and colours as the job page's stage cards).

const TONE = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-300",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300",
  teal: "bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-300",
  indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300",
  sky: "bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-300",
};
/** Pipeline bar colours, one per stage, in hiring order. */
export const STAGE_BAR = [
  { key: "to_invite", label: "Not invited", bar: "bg-slate-300 dark:bg-slate-600" },
  { key: "interview", label: "Interviewing", bar: "bg-amber-400" },
  { key: "review", label: "Ready to review", bar: "bg-violet-600 dark:bg-violet-400" },
  { key: "shortlisted", label: "Shortlisted", bar: "bg-emerald-500" },
  { key: "hired", label: "Hired", bar: "bg-teal-700 dark:bg-teal-400" },
] as const;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const Section = ({ id, title, hint, action, children }: { id: string; title: string; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) => (
  <section aria-labelledby={id} className="space-y-2.5">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="font-semibold">{title}</h2>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {action}
    </div>
    {children}
  </section>
);
const Circle = ({ icon: Icon, tone, small }: { icon: LucideIcon; tone: string; small?: boolean }) => (
  <span className={cn("flex shrink-0 items-center justify-center rounded-full", small ? "size-8" : "size-9", tone)}><Icon className={small ? "size-4" : "size-[18px]"} aria-hidden /></span>
);

type Card = {
  label: string; hint: string; n: number; icon: LucideIcon; tone: string;
  extra?: string; tone2?: "good" | "warn"; delta?: number | null; action?: { href: string; label: string };
};

/** One card in the job page's style: icon and number, name, what it means, then a detail or an action. */
function StatCard({ c }: { c: Card }) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-sm">
      <span className="flex items-center gap-3">
        <Circle icon={c.icon} tone={c.tone} />
        <span className="text-2xl font-semibold tracking-tight tabular">{c.n}</span>
        {c.delta != null && c.delta !== 0 && (
          <span className={cn("ml-auto inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular", c.delta > 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-muted text-muted-foreground")}
            title="Compared with the period before">
            {c.delta > 0 ? <TrendingUp className="size-3" aria-hidden /> : <TrendingDown className="size-3" aria-hidden />}{c.delta > 0 ? "+" : "−"}{Math.abs(c.delta)}
            <span className="sr-only"> compared with the period before</span>
          </span>
        )}
      </span>
      <span className="mt-2.5 block text-sm font-medium">{c.label}</span>
      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{c.hint}</span>
      <span className="mt-auto flex items-end justify-between gap-2 pt-2">
        {c.extra && <span className={cn("text-xs font-medium", c.tone2 === "warn" ? "text-amber-700 dark:text-amber-300" : c.tone2 === "good" ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>{c.extra}</span>}
        {c.action && (
          <Link href={c.action.href} className="group ml-auto inline-flex shrink-0 items-center gap-0.5 rounded text-xs font-semibold text-primary hover:underline">
            {c.action.label}<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        )}
      </span>
    </div>
  );
}

/** Overview: jobs, candidates, and the interviews invited, started and completed in the period. */
export function OverviewCards({ o, f, t, period, candidateData }: { o: Dashboard["overview"]; f: Dashboard["funnel"]; t: Dashboard["totals"]; period: string; candidateData: boolean }) {
  const rate = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  const startRate = rate(f.started, f.invited);
  const finishRate = rate(f.completed, f.started);
  const other = [o.jobs.draft && `${o.jobs.draft} ${plural(o.jobs.draft, "draft")}`, o.jobs.paused && `${o.jobs.paused} paused`].filter(Boolean).join(" · ");
  const cards: Card[] = [
    { label: "Active jobs", hint: "Open and taking candidates", n: o.jobs.active, icon: Briefcase, tone: TONE.blue,
      extra: [o.jobs.newInPeriod ? `+${o.jobs.newInPeriod} opened` : "", other].filter(Boolean).join(" · ") || undefined },
    ...(candidateData ? [{ label: "Candidates", hint: "Everyone active in your jobs", n: t.total, icon: Users, tone: TONE.indigo,
      extra: t.newInPeriod ? `+${t.newInPeriod} new` : "No new ones", tone2: t.newInPeriod ? "good" as const : undefined }] : []),
    { label: "Invited", hint: "Interview links sent", n: o.now.invited, icon: Send, tone: TONE.sky, delta: o.now.invited - o.before.invited,
      extra: o.now.invited ? undefined : "None sent" },
    { label: "Started", hint: "Opened the link and began answering", n: o.now.started, icon: PlayCircle, tone: TONE.amber, delta: o.now.started - o.before.started,
      extra: startRate != null ? `${startRate}% of invited started` : undefined, tone2: startRate != null && startRate < 60 ? "warn" : undefined },
    { label: "Completed", hint: "Finished all questions, report made", n: o.now.completed, icon: CheckCircle2, tone: TONE.emerald, delta: o.now.completed - o.before.completed,
      extra: finishRate != null ? `${finishRate}% finish once started` : undefined, tone2: finishRate != null && finishRate >= 80 ? "good" : undefined },
  ];
  return (
    <Section id="dash-overview" title="Overview" hint={<>Interview numbers: {period.toLowerCase()}. Arrows compare with the period before.</>}>
      <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", cards.length === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
        {cards.map((c) => <StatCard key={c.label} c={c} />)}
      </div>
    </Section>
  );
}

/** Where candidates are now: the job page's stages over every active job, with what to do next. */
export function StageCards({ t }: { t: Dashboard["totals"] }) {
  const pct = (n: number) => (t.total ? `${Math.round((n / t.total) * 100)}% of candidates` : undefined);
  const cards: Card[] = [
    { label: "Not invited", hint: "Added or applied, no interview sent yet", n: t.to_invite, icon: UserPlus, tone: TONE.slate, extra: pct(t.to_invite),
      action: t.to_invite ? { href: "/candidates?stage=not_invited", label: "Invite" } : undefined },
    { label: "Interviewing", hint: "Invited or taking the interview", n: t.interview, icon: Video, tone: TONE.amber,
      extra: t.notStarted ? `${t.notStarted} not opened yet` : t.liveNow ? `${t.liveNow} taking it right now` : pct(t.interview), tone2: t.notStarted ? "warn" : undefined,
      action: t.notStarted ? { href: "/interviews?status=pending&sort=waiting", label: "Remind" } : undefined },
    { label: "Ready to review", hint: "Interview done, needs your decision", n: t.review, icon: ClipboardCheck, tone: TONE.violet,
      extra: t.reviewWaiting ? `${t.reviewWaiting} waiting ${STALE_DAYS}+ days` : pct(t.review), tone2: t.reviewWaiting ? "warn" : undefined,
      action: t.review ? { href: "/interviews?status=review&sort=waiting", label: "Review" } : undefined },
    { label: "Shortlisted", hint: "Moving forward", n: t.shortlisted, icon: Star, tone: TONE.emerald, extra: t.shortlistedInPeriod ? `+${t.shortlistedInPeriod} this period` : "None new", tone2: t.shortlistedInPeriod ? "good" : undefined },
    { label: "Hired", hint: "Hired for a job", n: t.hired, icon: CheckCircle2, tone: TONE.teal, extra: t.hiredInPeriod ? `+${t.hiredInPeriod} this period` : "None new", tone2: t.hiredInPeriod ? "good" : undefined },
  ];
  return (
    <Section id="dash-stages" title="Where candidates are now" hint="Same stages as each job page. Together they add up to Candidates.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => <StatCard key={c.label} c={c} />)}
      </div>
    </Section>
  );
}

const HEALTH: Record<JobHealth, { label: string; cls: string }> = {
  on_track: { label: "On track", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/30" },
  needs_review: { label: "Needs review", cls: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-400/30" },
  slow_start: { label: "Slow start", cls: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/30" },
  few_candidates: { label: "Few candidates", cls: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300 dark:ring-red-400/30" },
  not_set_up: { label: "Not set up", cls: "bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/30" },
};
const Badge = ({ cls, children }: { cls: string; children: React.ReactNode }) => (
  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", cls)}>
    <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />{children}
  </span>
);

function PipelineBar({ j }: { j: DashboardJob }) {
  if (!j.total) return <span className="text-xs text-muted-foreground">No candidates yet</span>;
  return (
    <div role="img" aria-label={STAGE_BAR.map((s) => `${s.label} ${j[s.key]}`).join(", ")} className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
      {STAGE_BAR.map((s) => j[s.key] > 0 && <span key={s.key} title={`${s.label}: ${j[s.key]}`} className={s.bar} style={{ width: `${(j[s.key] / j.total) * 100}%` }} />)}
    </div>
  );
}

/** Active jobs, the ones with the most people waiting on you first. */
export function JobsHealth({ jobs, mine }: { jobs: DashboardJob[]; mine: boolean }) {
  const top = jobs.slice(0, 8);
  return (
    <section aria-labelledby="dash-jobs" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
        <div>
          <h2 id="dash-jobs" className="font-semibold">Active jobs</h2>
          <p className="text-xs text-muted-foreground">Jobs with the most people waiting on you come first.</p>
        </div>
        <Link href="/jobs" className="text-sm text-primary hover:underline">View all jobs{jobs.length > top.length ? ` (${jobs.length})` : ""}</Link>
      </div>
      {top.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">{mine ? "You have no active jobs." : "No active jobs yet."} <Link href="/jobs/new" className="font-medium text-primary hover:underline">Create a job</Link></p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 font-medium">Job</th>
                <th className="px-3 py-2.5 text-right font-medium">Candidates</th>
                <th className="w-[28%] px-3 py-2.5 font-medium">Pipeline</th>
                <th className="px-3 py-2.5 text-right font-medium">To review</th>
                <th className="px-3 py-2.5 text-right font-medium">Not invited</th>
                <th className="px-5 py-2.5 font-medium">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {top.map((j) => (
                <tr key={j.id} className="hover:bg-muted/40">
                  <td className="px-5 py-3">
                    <Link href={`/jobs/${j.id}`} className="font-medium hover:text-primary hover:underline">{j.title}</Link>
                    <p className="text-xs text-muted-foreground">{j.owner ?? "—"} · opened {timeAgo(j.created_at)}</p>
                  </td>
                  <td className="px-3 py-3 text-right tabular">{j.total}</td>
                  <td className="px-3 py-3"><PipelineBar j={j} /></td>
                  <td className="px-3 py-3 text-right tabular">
                    {j.review ? <Link href={`/jobs/${j.id}?stage=review`} className="font-semibold text-violet-700 hover:underline dark:text-violet-300">{j.review}</Link> : <span className="text-muted-foreground">0</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular">
                    {j.to_invite ? <Link href={`/jobs/${j.id}?stage=to_invite`} className="hover:text-primary hover:underline">{j.to_invite}</Link> : <span className="text-muted-foreground">0</span>}
                  </td>
                  <td className="px-5 py-3">
                    <Badge cls={HEALTH[j.health].cls}>{HEALTH[j.health].label}</Badge>
                    <p className="mt-1 text-xs text-muted-foreground">{j.why}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {top.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t px-5 py-3 text-xs text-muted-foreground">
          {STAGE_BAR.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", s.bar)} aria-hidden />{s.label}</span>)}
        </div>
      )}
    </section>
  );
}

const ACT: Record<ActivityItem["kind"], { tag: string; cls: string; text: (a: ActivityItem) => string }> = {
  report_ready: { tag: "Report ready", cls: HEALTH.on_track.cls, text: () => "finished the interview" },
  completed: { tag: "Completed", cls: HEALTH.on_track.cls, text: () => "finished the interview, report on the way" },
  started: { tag: "In progress", cls: "bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-400/30", text: () => "is taking the interview" },
  applied: { tag: "Applied", cls: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-400/30", text: () => "applied through the job link" },
  shortlisted: { tag: "Shortlisted", cls: HEALTH.on_track.cls, text: (a) => (a.by ? `was shortlisted by ${a.by}` : "was shortlisted") },
  hired: { tag: "Hired", cls: "bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-950 dark:text-teal-300 dark:ring-teal-400/30", text: (a) => (a.by ? `was hired by ${a.by}` : "was hired") },
  invited: { tag: "Invited", cls: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-400/30", text: () => "" },
};

/** Recent updates across jobs, newest first. */
export function RecentUpdates({ items }: { items: ActivityItem[] }) {
  return (
    <section aria-labelledby="dash-activity" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h2 id="dash-activity" className="font-semibold">Recent updates</h2>
        <Link href="/interviews" className="text-sm text-primary hover:underline">All interviews</Link>
      </div>
      {items.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nothing yet. Updates show here when candidates apply and take interviews.</p> : (
        <ul className="divide-y">
          {items.map((a) => {
            const k = ACT[a.kind];
            const invite = a.kind === "invited";
            const who = invite ? a.by ?? "Your team" : a.name;
            const what = invite ? `invited ${a.count === 1 ? a.name : `${a.count} candidates`}` : k.text(a);
            return (
              <li key={a.key}>
                <Link href={a.href} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden>{initials(who)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm"><span className="font-medium">{who}</span> <span className="text-muted-foreground">{what}</span></span>
                    <span className="block truncate text-xs text-muted-foreground">{a.job} · {timeAgo(a.at)}</span>
                  </span>
                  <Badge cls={k.cls}>{k.tag}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The interview balance: what's left, how fast it's going, when the oldest pack expires. */
export function InterviewsLeft({ quota, usage, minutes, canBuy }: { quota: QuotaStatus; usage: Dashboard["usage"]; minutes: number; canBuy: boolean }) {
  const unlimited = quota.remaining === null;
  const left = quota.remaining ?? 0;
  const total = quota.quota ?? 0;
  const perDay = usage.usedRecently / 14;
  const lasts = !unlimited && perDay > 0 ? Math.max(1, Math.round(left / perDay)) : null;
  const trial = quota.plan === "trial";
  return (
    <section aria-labelledby="dash-balance" className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 id="dash-balance" className="font-semibold">Interviews left</h2>
        {trial
          ? <Badge cls={HEALTH.slow_start.cls}>{quota.trialEnded ? "Trial ended" : `Free trial · ${quota.trialDaysLeft} ${plural(quota.trialDaysLeft ?? 0, "day")} left`}</Badge>
          : unlimited ? <Badge cls={HEALTH.on_track.cls}>Unlimited</Badge> : null}
      </div>
      {unlimited ? (
        <p className="mt-3 text-sm text-muted-foreground">Your company has unlimited interviews. <span className="font-medium text-foreground tabular">{quota.used}</span> used so far.</p>
      ) : (
        <>
          <p className="mt-2.5 flex items-baseline gap-1.5"><span className="text-3xl font-semibold tracking-tight tabular">{left}</span><span className="text-sm text-muted-foreground">of {total} left</span></p>
          <div className="my-2.5 h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", left <= 5 ? "bg-red-500" : "bg-primary")} style={{ width: `${total ? Math.min(100, (left / total) * 100) : 0}%` }} /></div>
          <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Used</dt><dd className="text-right tabular">{quota.used}</dd>
            {usage.nextExpiry && <><dt className="text-muted-foreground">Oldest pack valid until</dt><dd className="text-right">{formatDate(usage.nextExpiry.at)}</dd></>}
            {lasts != null && <><dt className="text-muted-foreground">At this pace</dt><dd className="text-right">lasts about {lasts} {plural(lasts, "day")}</dd></>}
            {quota.onHold > 0 && <><dt className="text-muted-foreground">Waiting to start</dt><dd className="text-right font-medium text-amber-700 dark:text-amber-300">{quota.onHold} {plural(quota.onHold, "candidate")}</dd></>}
          </dl>
        </>
      )}
      <p className="mb-3 text-xs text-muted-foreground">One interview counts for up to {minutes} minutes.</p>
      {canBuy && !unlimited && (
        <div className="flex flex-wrap gap-2">
          <Link href="/settings/billing" className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">Buy interviews</Link>
          <Link href="/settings/billing/history" className="inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted">Purchase history</Link>
        </div>
      )}
    </section>
  );
}

const HUMAN_TAG: Record<HumanListRow["kind"], string> = { scorecard_needed: "Scorecard needed", ready_to_decide: "Ready to decide", upcoming: "Upcoming" };

/** Live (human) interview rounds that need this person: upcoming, scorecard due or ready to decide. */
export function LiveInterviews({ rows }: { rows: HumanListRow[] }) {
  if (!rows.length) return null;
  return (
    <section aria-labelledby="dash-live" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="px-5 pt-4 pb-2.5">
        <h2 id="dash-live" className="font-semibold">Your live interviews</h2>
        <p className="text-xs text-muted-foreground">Rounds with a person where you&apos;re needed.</p>
      </div>
      <ul className="divide-y border-t">
        {rows.slice(0, 5).map((r) => (
          <li key={r.id}>
            <Link href={`/interviews/human/${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40">
              <Circle icon={CalendarDays} tone={TONE.blue} small />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.candidate_name}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.job_title} · {r.round_name}</span>
                <span className="mt-0.5 block text-xs font-medium text-primary">{formatInZone(r.scheduled_at, r.timezone)}{r.kind !== "upcoming" && <span className="font-normal text-muted-foreground"> · {HUMAN_TAG[r.kind]}</span>}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
