"use client";

import Link from "next/link";
import { useState } from "react";
import { ClientPagination, usePaged } from "@/components/common/client-pagination";
import { STAGE_LABEL, STAGES, type Stage } from "@/lib/hiring";
import type { JobPipelineRow, PipelineRound } from "@/lib/services/pipeline";
import { cn } from "@/lib/utils";
import { RoundChip, StageBadge } from "./badges";

/** Candidates in a job by stage, with each round's result at a glance. */
export function JobPipeline({ rounds, rows }: { rounds: PipelineRound[]; rows: JobPipelineRow[] }) {
  const [tab, setTab] = useState<Stage>("in_progress");
  const counts = Object.fromEntries(STAGES.map((s) => [s, rows.filter((r) => r.stage === s).length])) as Record<Stage, number>;
  const shown = rows.filter((r) => r.stage === tab);
  const paged = usePaged(shown, tab);
  return (
    <div>
      <div className="flex gap-1 overflow-x-auto border-b px-3" role="tablist" aria-label="Stages">
        {STAGES.filter((s) => s !== "withdrawn" || counts.withdrawn).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={tab === s} onClick={() => setTab(s)}
            className={cn("-mb-px border-b-2 px-3 py-2.5 text-sm whitespace-nowrap", tab === s ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {STAGE_LABEL[s]} <span className="ml-1 text-xs text-muted-foreground tabular">{counts[s]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          {tab === "in_progress" ? "No candidates in progress. Invite someone to an interview to start." : `No ${STAGE_LABEL[tab].toLowerCase()} candidates yet.`}
        </p>
      ) : (
        <>
        <ul className="divide-y">
          {paged.rows.map((r) => (
            <li key={r.candidate_id}>
              <Link href={`/candidates/${r.candidate_id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                </div>
                <div className="flex items-center gap-1" aria-label="Round results">
                  {r.results.map((x) => <RoundChip key={x.round.id} name={x.round.name} decision={x.decision} state={x.state} />)}
                </div>
                {tab === "in_progress" && r.allQualified ? <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900">Ready to shortlist</span> : <StageBadge stage={r.stage} />}
              </Link>
            </li>
          ))}
        </ul>
        <ClientPagination {...paged} />
        </>
      )}
      {rounds.length > 0 && (
        <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">Rounds: {rounds.map((r, i) => `${i + 1}. ${r.name}`).join(" · ")}. Hover an icon for its result.</p>
      )}
    </div>
  );
}
