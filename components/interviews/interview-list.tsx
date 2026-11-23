"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bell, Briefcase, ExternalLink, MoreVertical, UserRound } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { DecisionBadge } from "@/components/hiring/badges";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAction } from "@/lib/client/use-action";
import { formatDuration, initials, timeAgo } from "@/lib/format";
import type { InterviewListRow } from "@/lib/services/interviews";
import { cn } from "@/lib/utils";

const NOT_STARTED = ["invited", "consent_pending", "device_check", "ready"];

/** One plain line saying what's happening with this interview. */
const STAGE_DONE: Record<string, string> = { shortlisted: "shortlisted", hired: "hired", rejected: "not moving forward", withdrawn: "withdrew" };

export function interviewSituation(r: Pick<InterviewListRow, "status" | "invited_at" | "started_at" | "completed_at" | "last_reminder_at" | "decision" | "created_at" | "job_stage">) {
  const ago = (d: Date | null) => (d ? timeAgo(d) : "");
  switch (r.status) {
    case "created": return { text: "Not sent yet" };
    case "invited": {
      const old = r.invited_at && Date.now() - new Date(r.invited_at).getTime() > 3 * 86_400_000;
      return { text: `Invited ${ago(r.invited_at)}, link not opened${r.last_reminder_at ? ` · reminded ${ago(r.last_reminder_at)}` : ""}`, warn: !!old };
    }
    case "consent_pending": case "device_check": case "ready": return { text: "Opened the link, hasn't started yet" };
    case "in_progress": case "completing": return { text: `Taking it now · started ${ago(r.started_at)}` };
    case "processing": return { text: `Finished ${ago(r.completed_at)}, report being made` };
    case "completed": case "report_ready":
      if (r.job_stage && STAGE_DONE[r.job_stage]) return { text: `Finished ${ago(r.completed_at)} · candidate ${STAGE_DONE[r.job_stage]}` };
      return r.decision ? { text: `Finished ${ago(r.completed_at)}` } : { text: `Finished ${ago(r.completed_at)} · needs your decision`, todo: true };
    case "expired": return { text: "The link expired before it was used" };
    case "cancelled": return { text: "Cancelled" };
    case "failed": return { text: "Something went wrong. Open it to see why.", warn: true };
    default: return { text: "" };
  }
}

/** The Interviews page's list: each interview on one row (a card on phones) with a ⋮ menu. */
export function InterviewList({ rows, canWrite, canSeeCandidates }: { rows: InterviewListRow[]; canWrite: boolean; canSeeCandidates: boolean }) {
  const router = useRouter();
  const { run } = useAction();
  return (
    <ul className="divide-y" aria-label="Interviews">
      <li className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.5fr)_5rem_6rem_2.5rem] gap-4 bg-muted/40 px-5 py-2.5 text-xs font-medium text-muted-foreground lg:grid" aria-hidden>
        <span>Candidate</span><span>Job · round</span><span>Status</span><span>Length</span><span className="text-right">Last activity</span><span />
      </li>
      {rows.map((r) => {
        const s = interviewSituation(r);
        const round = r.round_name ? `${r.round_name}${r.attempt > 1 ? ` · attempt ${r.attempt}` : ""}` : null;
        return (
          <li key={r.id} className="group relative grid grid-cols-[minmax(0,1fr)_2.5rem] gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-muted/40 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.5fr)_5rem_6rem_2.5rem] lg:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden>{initials(r.candidate_name)}</span>
              <span className="min-w-0">
                <Link href={`/interviews/${r.id}`} className="block truncate font-medium outline-none after:absolute after:inset-0 group-hover:text-primary focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset">{r.candidate_name}</Link>
                <span className="block truncate text-xs text-muted-foreground">{r.candidate_email}</span>
              </span>
            </div>
            <div className="col-start-1 min-w-0 text-sm lg:col-start-auto">
              <p className="truncate">{r.job_title}</p>
              {round && <p className="truncate text-xs text-muted-foreground">{round}</p>}
            </div>
            <div className="col-start-1 min-w-0 lg:col-start-auto">
              <span className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={r.status} />
                {r.decision && <DecisionBadge decision={r.decision} />}
                {r.issue_count > 0 && (
                  <span title={`Candidate reported ${r.issue_count === 1 ? "an issue" : `${r.issue_count} issues`}`} className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                    <AlertTriangle className="size-3.5" aria-hidden /> Issue
                  </span>
                )}
              </span>
              {s.text && <p className={cn("mt-1 text-xs", s.warn ? "font-medium text-amber-700 dark:text-amber-300" : s.todo ? "font-medium text-violet-700 dark:text-violet-300" : "text-muted-foreground")}>{s.text}</p>}
            </div>
            <div className="col-start-1 flex gap-4 text-xs text-muted-foreground lg:contents lg:text-sm">
              <span className="tabular"><span className="lg:hidden">Length </span>{formatDuration(r.duration_seconds)}</span>
              <span className="lg:text-right"><span className="lg:hidden">Last activity </span>{timeAgo(r.completed_at ?? r.started_at ?? r.invited_at ?? r.created_at)}</span>
            </div>
            <div className="relative z-10 col-start-2 row-start-1 self-start justify-self-end lg:col-start-auto lg:row-start-auto lg:self-center">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={`Actions for ${r.candidate_name}'s interview`} />}>
                  <MoreVertical />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuItem onClick={() => router.push(`/interviews/${r.id}`)}><ExternalLink /> Open interview</DropdownMenuItem>
                  {canSeeCandidates && <DropdownMenuItem onClick={() => router.push(`/candidates/${r.candidate_id}`)}><UserRound /> Open candidate</DropdownMenuItem>}
                  <DropdownMenuItem onClick={() => router.push(`/jobs/${r.job_id}`)}><Briefcase /> Open job</DropdownMenuItem>
                  {canWrite && NOT_STARTED.includes(r.status) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => run("remind", `/api/interviews/${r.id}/remind`, { success: `Reminder sent to ${r.candidate_name}`, emailFix: "Open the interview to copy the new link and send it yourself." })}>
                        <Bell /> Send reminder
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
