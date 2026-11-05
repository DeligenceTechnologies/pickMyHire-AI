import Link from "next/link";
import { UserRound } from "lucide-react";
import { formatInZone, LOCATION_LABEL } from "@/lib/hiring";
import type { HumanCardKind, HumanListRow } from "@/lib/services/human-interviews";

const BADGE: Record<HumanCardKind, string> = {
  scorecard_needed: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-900",
  ready_to_decide: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900",
  upcoming: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900",
};

function badge(r: HumanListRow): string | null {
  if (r.kind === "scorecard_needed") return "Your scorecard is needed";
  if (r.kind === "ready_to_decide") return `Ready for a decision · ${r.submitted} of ${r.panel_size} ${r.panel_size === 1 ? "scorecard" : "scorecards"} in`;
  return r.on_panel ? "You're interviewing" : null;
}

/** Dashboard card: human interviews that still need something from this person (see listMyHumanInterviews). */
export function UpcomingHumanInterviews({ rows }: { rows: HumanListRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="mb-6 rounded-xl border bg-card">
      <h2 className="flex items-center gap-2 border-b px-5 py-4 font-semibold"><UserRound className="size-4 text-primary" /> Human interviews</h2>
      <ul className="divide-y">
        {rows.map((r) => {
          const label = badge(r);
          return (
            <li key={r.id}>
              <Link href={`/interviews/human/${r.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/40">
                <div className="w-44 shrink-0 text-sm font-medium tabular">{formatInZone(r.scheduled_at, r.timezone)}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{r.candidate_name} · {r.round_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.job_title} · {LOCATION_LABEL[r.location_type]}</p>
                </div>
                {label && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[r.kind]}`}>{label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
