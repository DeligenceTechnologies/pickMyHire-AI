import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const STYLE: Record<string, { label: string; cls: string }> = {
  strong_match: { label: "Strong match", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900" },
  good_match: { label: "Good match", cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900" },
  partial_match: { label: "Partial match", cls: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900" },
  low_match: { label: "Low match", cls: "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800" },
  insufficient_information: { label: "Not enough info", cls: "bg-muted text-muted-foreground ring-border" },
};

/** AI screening tag. A prioritisation aid for recruiters, never a decision. */
export function MatchBadge({ level, screeningStatus, className }: { level: string | null; screeningStatus?: string; className?: string }) {
  if (!level) {
    if (screeningStatus === "failed") return <span className="text-xs text-destructive">Screening failed</span>;
    return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Screening…</span>;
  }
  const s = STYLE[level] ?? { label: level, cls: "bg-muted text-muted-foreground ring-border" };
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", s.cls, className)}>{s.label}</span>;
}

export const APPLICATION_STATUS: Record<string, string> = {
  new: "New",
  interview_invited: "Interview invited",
  declined: "Not moving forward",
};
