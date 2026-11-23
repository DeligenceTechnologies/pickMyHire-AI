"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/** Period and job pickers (all jobs, jobs I created, or one job); they live in the address. */
export function DashboardFilters({ periods, period, scope, jobs }: { periods: { id: string; label: string }[]; period: string; scope: string; jobs: { id: string; title: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (change: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(change)) { if (v) q.set(k, v); else q.delete(k); }
    router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const cls = "h-9 rounded-lg border bg-background px-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <>
      <label className="sr-only" htmlFor="dash-period">Period</label>
      <select id="dash-period" className={cls} value={period} onChange={(e) => go({ period: e.target.value === "30" ? null : e.target.value })}>
        {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <label className="sr-only" htmlFor="dash-job">Jobs</label>
      <select id="dash-job" className={cn(cls, "max-w-56 truncate")} value={scope}
        onChange={(e) => { const v = e.target.value; go({ jobs: v === "mine" ? "mine" : null, job: v === "all" || v === "mine" ? null : v }); }}>
        <option value="all">All jobs</option>
        <option value="mine">My jobs</option>
        {jobs.length > 0 && (
          <optgroup label="One job">
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </optgroup>
        )}
      </select>
    </>
  );
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * Interviews completed per day (per week for 90 days), in the viewer's own time zone, with interviews
 * that were started but never finished stacked on top.
 */
export function DailyChart({ completed, unfinished, previous, days, period }: { completed: string[]; unfinished: string[]; previous: number; days: number; period: string }) {
  const buckets = useMemo(() => {
    const weekly = days > 31;
    const size = weekly ? 7 : 1;
    const count = Math.ceil(days / size);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const list = Array.from({ length: count }, (_, i) => {
      const start = new Date(today); start.setDate(today.getDate() - (count - 1 - i) * size - (size - 1));
      return { start, done: 0, left: 0 };
    });
    const index = new Map<string, number>();
    list.forEach((b, i) => { for (let d = 0; d < size; d++) { const x = new Date(b.start); x.setDate(b.start.getDate() + d); index.set(dayKey(x), i); } });
    for (const t of completed) { const i = index.get(dayKey(new Date(t))); if (i != null) list[i].done++; }
    for (const t of unfinished) { const i = index.get(dayKey(new Date(t))); if (i != null) list[i].left++; }
    return list.map((b) => ({
      ...b,
      label: weekly ? b.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : days <= 7 ? b.start.toLocaleDateString("en-US", { weekday: "short" }) : String(b.start.getDate()),
      title: weekly ? `Week of ${b.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : b.start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    }));
  }, [completed, unfinished, days]);
  const max = Math.max(1, ...buckets.map((b) => b.done + b.left));
  const total = completed.length;
  const diff = total - previous;
  const showEvery = buckets.length > 16 ? 5 : 1;
  return (
    <section aria-labelledby="dash-chart" className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="dash-chart" className="font-semibold">Interviews completed</h2>
          <p className="text-xs text-muted-foreground">
            {period}: <span className="font-semibold text-foreground tabular">{total}</span>
            {previous || total ? <> · {diff === 0 ? "same as" : `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} than`} the period before</> : null}
          </p>
        </div>
        <div className="flex items-center gap-3.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" aria-hidden />Completed</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary/30" aria-hidden />Started, didn&apos;t finish</span>
        </div>
      </div>
      <div role="img" aria-label={`Interviews completed: ${buckets.map((b) => `${b.title} ${b.done}`).join(", ")}`}
        className="relative mt-4 flex h-44 items-end gap-[3px] border-b sm:gap-1.5">
        {total === 0 && unfinished.length === 0 && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">No interviews completed in this period.</p>}
        {buckets.map((b, i) => (
          <div key={i} title={`${b.title}: ${b.done} completed${b.left ? `, ${b.left} didn't finish` : ""}`} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            {buckets.length <= 16 && <span className="text-[11px] font-medium tabular">{b.done || ""}</span>}
            <div className="flex w-full max-w-10 flex-col gap-px">
              {b.left > 0 && <div className="rounded-t-[3px] bg-primary/30" style={{ height: `${(b.left / max) * 140}px` }} />}
              <div className={cn(b.left ? "" : "rounded-t-[3px]", "bg-primary group-hover:bg-primary/85")} style={{ height: `${(b.done / max) * 140}px` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px] sm:gap-1.5">
        {buckets.map((b, i) => <span key={i} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground">{i % showEvery === 0 || i === buckets.length - 1 ? b.label : ""}</span>)}
      </div>
    </section>
  );
}
