"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Briefcase, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { STAGE_GROUP_LABEL, STAGE_GROUPS, STAGE_STYLE, type StageCounts } from "@/lib/candidates/stages";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type JobChoice = { id: string | null; title: string; n: number; href: string; closed?: boolean; stages: StageCounts };

/**
 * Job filter as a row of cards: each job with its number of candidates and a bar showing where they are
 * (not invited, invited, in progress, completed, expired). The row scrolls sideways; "Find a job" searches
 * every job, so it works with 3 jobs or 300. The selected card is scrolled into view.
 */
export function JobPicker({ jobs, selected }: { jobs: JobChoice[]; selected: string | null }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = () => {
    const el = row.current;
    if (el) setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  // Bring the selected job into view (scrolling only the row, never the page) as soon as the row has its
  // width, and keep the scroll arrows right when the window is resized.
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    let centred = false;
    const show = () => {
      const card = el.querySelector<HTMLElement>("[aria-current=page]");
      if (!centred && card && el.clientWidth) {
        centred = true;
        if (card.offsetLeft < el.scrollLeft || card.offsetLeft + card.offsetWidth > el.scrollLeft + el.clientWidth) {
          el.scrollTo({ left: Math.max(0, card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2), behavior: "instant" });
        }
      }
      update();
    };
    const watch = new ResizeObserver(show);
    watch.observe(el);
    return () => watch.disconnect();
  }, [selected]);
  const scroll = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * (row.current.clientWidth * 0.8), behavior: "smooth" });

  return (
    <div className="flex items-stretch gap-2">
      {jobs.length > 3 && <FindJob jobs={jobs} selected={selected} />}
      <div className="relative min-w-0 flex-1">
        <div ref={row} onScroll={update} className="relative -my-2 flex snap-x gap-2.5 overflow-x-auto scroll-smooth px-0.5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="list" aria-label="Jobs">
          {jobs.map((j) => <JobCard key={j.id ?? "all"} job={j} on={j.id === selected} />)}
        </div>
        {edges.left && <Edge side="left" onClick={() => scroll(-1)} />}
        {edges.right && <Edge side="right" onClick={() => scroll(1)} />}
      </div>
    </div>
  );
}

function JobCard({ job, on }: { job: JobChoice; on: boolean }) {
  const total = STAGE_GROUPS.reduce((a, s) => a + job.stages[s], 0);
  const summary = STAGE_GROUPS.filter((s) => job.stages[s]).map((s) => `${job.stages[s]} ${STAGE_GROUP_LABEL[s].toLowerCase()}`).join(", ");
  return (
    <Tooltip>
      <TooltipTrigger delay={250} render={
        <Link href={job.href} role="listitem" aria-current={on ? "page" : undefined}
          className={cn("group relative w-52 shrink-0 snap-start overflow-hidden rounded-xl border px-3.5 py-3 transition-all duration-200",
            on
              ? "border-transparent bg-gradient-to-br from-primary to-indigo-700 text-primary-foreground shadow-lg shadow-primary/30"
              : "border-border/70 bg-card shadow-sm hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md")} />
      }>
        {/* soft light in the corner of the selected card */}
        {on && <span className="pointer-events-none absolute -top-8 -right-8 size-20 rounded-full bg-white/15 blur-xl" aria-hidden />}
        <span className="relative flex items-center gap-1.5">
          {job.id === null && <Briefcase className={cn("size-3.5 shrink-0", on ? "text-white/90" : "text-primary")} aria-hidden />}
          <span className={cn("truncate text-[13.5px] font-semibold tracking-tight", !on && "text-foreground group-hover:text-primary")}>{job.title}</span>
          {job.closed && <span className={cn("shrink-0 rounded px-1 text-[10px]", on ? "bg-white/20" : "bg-muted text-muted-foreground")}>Closed</span>}
        </span>
        <span className={cn("relative mt-0.5 block text-xs tabular", on ? "text-white/80" : "text-muted-foreground")}>
          <b className={cn("font-semibold", on ? "text-white" : "text-foreground")}>{job.n}</b> {job.n === 1 ? "candidate" : "candidates"}
        </span>
        <span className={cn("relative mt-2.5 flex h-2 gap-0.5 overflow-hidden rounded-full", on ? "bg-white/20" : "bg-muted")} aria-hidden>
          {total > 0 && STAGE_GROUPS.map((s) => job.stages[s]
            ? <span key={s} className={cn("h-full first:rounded-l-full last:rounded-r-full", on && s === "in_progress" ? "bg-white" : STAGE_STYLE[s].bar)} style={{ width: `${(job.stages[s] / total) * 100}%` }} />
            : null)}
        </span>
        <span className="sr-only">{summary}</span>
      </TooltipTrigger>
      {/* What each colour in the bar means, with this job's numbers */}
      <TooltipContent side="bottom" sideOffset={8} className="min-w-52 flex-col items-stretch gap-1.5 px-3.5 py-3">
        <span className="max-w-60 truncate font-semibold">{job.title}</span>
        <span className="mb-0.5 text-[11px] opacity-70">What the colours in the bar mean</span>
        {STAGE_GROUPS.map((s) => (
          <span key={s} className={cn("flex items-center gap-2", !job.stages[s] && "opacity-50")}>
            <span className={cn("size-2.5 shrink-0 rounded-full", STAGE_STYLE[s].bar)} aria-hidden />
            <span className="flex-1">{STAGE_GROUP_LABEL[s]}</span>
            <span className="font-semibold tabular">{job.stages[s]}</span>
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function Edge({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <div className={cn("pointer-events-none absolute inset-y-0 flex w-14 items-center from-background to-transparent", side === "left" ? "left-0 justify-start bg-gradient-to-r" : "right-0 justify-end bg-gradient-to-l")}>
      <button type="button" onClick={onClick} aria-label={side === "left" ? "Scroll jobs left" : "Scroll jobs right"}
        className="pointer-events-auto flex size-8 items-center justify-center rounded-full border bg-card shadow-sm hover:bg-accent">
        {side === "left" ? <ChevronLeft className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

/** "Find a job": search every job by name. */
function FindJob({ jobs, selected }: { jobs: JobChoice[]; selected: string | null }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const list = jobs.filter((j) => j.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox"
        className={cn("flex h-full w-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-primary/30 bg-accent/40 px-2 text-xs font-medium text-primary transition-all hover:border-primary/50 hover:bg-accent hover:shadow-sm", open && "border-primary/50 bg-accent shadow-sm")}>
        <Search className="size-4" aria-hidden />Find a job
        <span className="text-[11px] tabular opacity-70">{jobs.length - 1} jobs</span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border bg-popover shadow-xl ring-1 ring-black/5">
          <div className="relative border-b p-2">
            <Search className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a job…" aria-label="Find a job"
              className="h-9 w-full rounded-lg bg-muted/60 pr-3 pl-8 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <ul role="listbox" className="max-h-80 overflow-y-auto p-1">
            {list.map((j) => (
              <li key={j.id ?? "all"}>
                <Link href={j.href} onClick={() => setOpen(false)}
                  className={cn("flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent", j.id === selected && "bg-accent font-medium text-primary")}>
                  <span className="truncate">{j.title}{j.closed && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(closed)</span>}</span>
                  <span className="rounded-md bg-muted px-1.5 py-px text-[11px] text-muted-foreground tabular">{j.n}</span>
                </Link>
              </li>
            ))}
            {!list.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No job matches “{q}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
