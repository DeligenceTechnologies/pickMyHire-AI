"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { MatchBadge } from "@/components/applications/match-badge";

export type MatchInfo = { status: string; level: string | null; met: number | null; total: number | null; summary: string | null; source: string } | null;

/**
 * The resume-vs-job check in the invite dialog. A low match asks the team to confirm before inviting;
 * it never blocks (the AI can be wrong, and people decide).
 */
export function MatchNote({ match, checking, jobTitle, confirmed, onConfirm }: {
  match: MatchInfo; checking: boolean; jobTitle?: string; confirmed: boolean; onConfirm: (v: boolean) => void;
}) {
  if (checking) return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden />Checking the resume against {jobTitle ?? "the job"}…</p>;
  if (!match || match.status === "failed" || !match.level) return null;
  const low = match.level === "low_match";
  const fit = match.total ? ` · ${match.met} of ${match.total} requirements met` : "";
  if (!low) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Resume match:</span><MatchBadge level={match.level} /><span>{fit.slice(3)}</span>
      </div>
    );
  }
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span><b>This resume looks like a low match for {jobTitle ?? "this job"}</b>{fit}.{match.summary ? ` ${match.summary}` : ""}</span>
      </p>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox checked={confirmed} onCheckedChange={(c) => onConfirm(!!c)} /> Invite anyway: I&apos;ve checked the resume
      </label>
    </div>
  );
}
