"use client";

import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PAGE_SIZES } from "@/lib/jobs/job-list";
import { cn } from "@/lib/utils";

// List controls shared by the job page's candidate list, the Candidates page and the search bar:
// a filter dropdown button, and "Showing 1–5 of 24" with rows per page and numbered pages.

/** A filter button: the current choice, then an arrow at the end; opens a list with a tick on the chosen one. */
export function Pick({ label, value, onChange, options, plain, idle, small, className }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string, number?][]; plain?: boolean;
  /** Shown on the button while nothing is chosen (e.g. "Experience" instead of "Any experience"). */
  idle?: string;
  small?: boolean;
  className?: string;
}) {
  const on = !plain && !!value;
  const current = options.find(([v]) => v === value) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`${label}: ${current[1]}`}
        className={cn("inline-flex items-center gap-2 rounded-lg border bg-background text-sm font-medium whitespace-nowrap shadow-xs outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/30 data-popup-open:bg-muted/60",
          small ? "h-8 gap-1.5 pr-2 pl-2.5" : "h-10 pr-3 pl-3.5",
          on ? "border-primary/40 bg-accent text-accent-foreground hover:bg-accent" : "border-input text-foreground", className)}>
        <span>{!value && idle ? idle : current[1]}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform in-data-popup-open:rotate-180" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("w-auto", small ? "min-w-20" : "min-w-44")}>
        {options.map(([v, l, n]) => (
          <DropdownMenuItem key={v} onClick={() => onChange(v)} className="justify-between gap-6 py-2">
            <span className={cn("flex items-center gap-2", v === value && "font-medium text-primary")}>
              <Check className={cn("size-4", v === value ? "opacity-100" : "opacity-0")} aria-hidden />{l}
            </span>
            {n !== undefined && <span className="text-xs text-muted-foreground tabular">{n}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Showing 1–5 of 24", rows per page, and numbered pages. */
export function Pager({ page, pages, total, pageSize, setPage, setPageSize }: {
  page: number; pages: number; total: number; pageSize: number; setPage: (p: number) => void; setPageSize: (n: number) => void;
}) {
  if (!total) return null;
  const nums: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  const btn = "flex size-9 items-center justify-center rounded-lg border text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3.5">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="tabular">Showing {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}</span>
        <span className="flex items-center gap-2">
          <Pick label="Rows per page" value={String(pageSize)} onChange={(v) => setPageSize(Number(v))} options={PAGE_SIZES.map((n) => [String(n), String(n)])} plain small />
          per page
        </span>
      </div>
      {pages > 1 && (
        <nav className="flex items-center gap-1.5" aria-label="Pages">
          <button type="button" className={cn(btn, "hover:bg-muted")} onClick={() => setPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft className="size-4" /></button>
          {nums.map((n, i) => n === "…"
            ? <span key={`e${i}`} className="px-1 text-muted-foreground">…</span>
            : <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === page ? "page" : undefined}
                className={cn(btn, "tabular", n === page ? "border-primary bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted")}>{n}</button>)}
          <button type="button" className={cn(btn, "hover:bg-muted")} onClick={() => setPage(page + 1)} disabled={page >= pages} aria-label="Next page"><ChevronRight className="size-4" /></button>
        </nav>
      )}
    </div>
  );
}
