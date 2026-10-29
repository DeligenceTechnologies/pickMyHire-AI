"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { AssessmentBadge, StatusBadge } from "@/components/common/status-badge";
import { formatDuration } from "@/lib/format";

type Row = {
  id: string;
  candidate_name: string;
  status: string;
  duration_seconds: number | null;
  completed_at: string | null;
  attempt?: number;
  sections: Record<string, { assessment: string | null; score: number | null; status: string }>;
};

const RANK: Record<string, number> = { very_strong: 5, strong: 4, adequate: 3, limited: 2, insufficient_evidence: 1 };

export function CompareTable({ columns, rows, showScores }: { columns: string[]; rows: Row[]; showScores: boolean }) {
  // Sorting only happens on a column the recruiter explicitly chooses.
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [dir, setDir] = useState<1 | -1>(-1);
  const sorted = useMemo(() => {
    if (!sortBy) return rows;
    const val = (r: Row) => sortBy === "__duration" ? r.duration_seconds ?? -1 : RANK[r.sections[sortBy]?.assessment ?? ""] ?? 0;
    return [...rows].sort((a, b) => (val(a) - val(b)) * dir);
  }, [rows, sortBy, dir]);
  const toggle = (c: string) => { if (sortBy === c) setDir((d) => (d === 1 ? -1 : 1)); else { setSortBy(c); setDir(-1); } };

  if (!rows.length) return <p className="text-sm text-muted-foreground">No completed interviews to compare yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="sticky left-0 bg-muted/40 px-4 py-3 font-medium">Candidate</th>
            <th className="px-4 py-3 font-medium">Status</th>
            {columns.map((c) => (
              <th key={c} className="px-4 py-3 font-medium">
                <button type="button" onClick={() => toggle(c)} className="inline-flex items-center gap-1 hover:text-foreground">{c}<ArrowUpDown className="size-3" /></button>
              </th>
            ))}
            <th className="px-4 py-3 font-medium">
              <button type="button" onClick={() => toggle("__duration")} className="inline-flex items-center gap-1 hover:text-foreground">Duration<ArrowUpDown className="size-3" /></button>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((r) => (
            <tr key={r.id} className="hover:bg-muted/30">
              <td className="sticky left-0 bg-card px-4 py-3 font-medium"><Link href={`/interviews/${r.id}/report`} className="hover:text-primary">{r.candidate_name}</Link>{(r.attempt ?? 1) > 1 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">attempt {r.attempt}</span>}</td>
              <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
              {columns.map((c) => (
                <td key={c} className="px-4 py-3">
                  {r.sections[c]?.status === "skipped" ? <span className="text-xs text-muted-foreground">Skipped</span> : <AssessmentBadge assessment={r.sections[c]?.assessment} score={r.sections[c]?.score} showScore={showScores} />}
                </td>
              ))}
              <td className="px-4 py-3 tabular text-muted-foreground">{formatDuration(r.duration_seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
