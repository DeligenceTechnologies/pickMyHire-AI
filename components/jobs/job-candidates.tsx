"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Ban, BarChart3, CalendarClock, CheckCircle2, Clock3, ExternalLink, FileText, Loader2,
  MoreVertical, PlayCircle, Search, Send, TimerOff, UserRound, Users, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pager, Pick } from "@/components/common/list-controls";
import { BalanceNote, useBalance } from "@/components/billing/balance-note";
import { InviteDialog } from "@/components/interview/invite-dialog";
import { MatchCell, avatarTone } from "@/components/candidates/candidate-list";
import { FitBadge } from "@/components/applications/answers-card";
import { ExperienceFlags } from "@/components/candidates/experience-flags";
import { api } from "@/lib/client/api";
import { emailFailedIn, toastEmailResult } from "@/lib/client/email-result";
import { initials, timeAgo } from "@/lib/format";
import { shortExperience } from "@/lib/resume/experience";
import { JOB_STAGE_HINT, JOB_STAGE_LABEL, STAGE_GROUPS, inStageGroup, stageGroup, type JobStage } from "@/lib/jobs/job-stages";
import {
  EXPERIENCE, MATCHES, SORTS, filterJobList, filtersOn, jobListQuery, jobRowHref, parseJobListFilters, type JobListFilters, type JobListSort,
} from "@/lib/jobs/job-list";
import type { Fit } from "@/lib/application-form";
import type { JobCandidateRow } from "@/lib/services/job-candidates";
import type { RoundResult } from "@/lib/services/pipeline";
import { cn } from "@/lib/utils";

export type JobCandidateItem = Omit<JobCandidateRow, "added_at" | "last_activity" | "results"> & {
  added_at: string; last_activity: string; fit: Fit["level"];
  results: (Omit<RoundResult, "entry"> & { entry: { kind: "ai" | "human"; id: string; status: string } | null })[];
};

export const STAGE_TONE: Record<JobStage, { dot: string; pill: string }> = {
  to_invite: { dot: "bg-slate-400", pill: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  invited: { dot: "bg-amber-500", pill: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  interviewing: { dot: "bg-violet-500", pill: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  review: { dot: "bg-blue-500", pill: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  shortlisted: { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  hired: { dot: "bg-teal-600", pill: "bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-300" },
  rejected: { dot: "bg-rose-400", pill: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
};
/** The job's candidate pipeline: everyone in the job once, filters, a compact table and pages. */
export function JobCandidates({ jobId, rows, canInvite, completedCount }: { jobId: string; rows: JobCandidateItem[]; canInvite: boolean; completedCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Every filter and the page live in the address, so they survive opening a candidate and coming back,
  // and the candidate / application pages can walk the same list with Previous / Next.
  const f = parseJobListFilters(params);
  const listQuery = jobListQuery(f, false);
  const set = (patch: Partial<JobListFilters>) => {
    const next = { ...f, page: 1, ...patch };
    const q = jobListQuery(next);
    window.history.replaceState(null, "", q ? `${pathname}?${q}` : pathname);
  };
  const { stage, q, exp, match, sort } = f;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const balance = useBalance(confirm);

  const shown = filterJobList(rows, f);
  const pageSize = f.size;
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(f.page, pages);
  const visible = shown.slice((current - 1) * pageSize, current * pageSize);
  const anyFilter = filtersOn(f);

  // New applicants can be invited together while "Not invited" is selected.
  const invitable = (r: JobCandidateItem) => canInvite && r.stage === "to_invite" && r.application_status === "new" && !!r.application_id;
  const bulk = stage === "to_invite" && visible.some(invitable);
  const chosen = rows.filter((r) => r.application_id && selected.has(r.application_id) && invitable(r));
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const pageInvitable = visible.filter(invitable);
  const allOnPage = pageInvitable.length > 0 && pageInvitable.every((r) => selected.has(r.application_id!));

  const inviteChosen = async () => {
    setProgress({ done: 0, total: chosen.length });
    const failed: string[] = [];
    const notEmailed: string[] = [];
    for (const [i, r] of chosen.entries()) {
      try {
        const res = await api(`/api/applications/${r.application_id}/invite`, { body: { sendInvite: sendEmail } });
        notEmailed.push(...emailFailedIn(res));
      } catch (e) {
        failed.push(`${r.name}: ${(e as Error).message}`);
        if ((e as { status?: number }).status === 402 || /quota|free interviews|limit|balance/i.test((e as Error).message)) break;
      }
      setProgress({ done: i + 1, total: chosen.length });
    }
    setProgress(null);
    setConfirm(false);
    setSelected(new Set());
    const ok = chosen.length - failed.length;
    if (ok) toastEmailResult({ emailFailed: notEmailed }, `${ok} ${ok === 1 ? "candidate" : "candidates"} invited`,
      "Their interviews were created: open each one and use “Resend invitation”, or copy its link.");
    if (failed.length) toast.error(failed.slice(0, 3).join("\n"));
    router.refresh();
  };

  return (
    <section className="rounded-2xl border bg-card shadow-sm" aria-labelledby="pipeline-title">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div>
          <h2 id="pipeline-title" className="text-lg font-semibold tracking-tight">Candidate pipeline</h2>
          <p className="text-sm text-muted-foreground">Everyone who applied, was added or was interviewed for this job.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {completedCount > 1 && <Link href={`/jobs/${jobId}/compare`} className={buttonVariants({ variant: "outline" })}><BarChart3 /> Compare</Link>}
          {canInvite && <InviteDialog jobId={jobId} triggerLabel="Add candidate" />}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
        <label className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={q} onChange={(e) => set({ q: e.target.value })} placeholder="Search candidates…" aria-label="Search candidates"
            className="h-10 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30" />
        </label>
        <Pick label="Stage" value={stage} onChange={(v) => set({ stage: v as JobListFilters["stage"] })}
          options={[["", "All active", rows.filter((r) => r.stage !== "rejected").length], ...STAGE_GROUPS.map((g) => [g.id, g.label, rows.filter((r) => inStageGroup(g.id, r.stage)).length] as [string, string, number])]} />
        <Pick label="Experience" value={exp} onChange={(v) => set({ exp: v })} options={EXPERIENCE.map(([v, l]) => [v, l])} idle="Experience" />
        <Pick label="Resume match" idle="Match" value={match} onChange={(v) => set({ match: v })} options={MATCHES} />
        <Pick label="Sort" value={sort} onChange={(v) => set({ sort: v as JobListSort })} options={SORTS.map(([v, l]) => [v, l])} plain />
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-y bg-accent px-5 py-2 text-sm font-medium text-accent-foreground">
          {chosen.length} selected
          <Button size="sm" onClick={() => setConfirm(true)}><Send /> Invite to AI interview</Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {!rows.length ? (
        <div className="flex flex-col items-center gap-2 border-t px-5 py-12 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-accent text-primary"><Users className="size-5" aria-hidden /></span>
          <p className="font-medium">No candidates yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">Share the apply link, or add a candidate with their resume and the AI tailors the interview to their experience.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto border-t">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-muted/40 text-left text-[13px] text-muted-foreground">
                  {bulk && (
                    <th className="w-10 py-3 pl-5">
                      <Checkbox aria-label="Select everyone on this page who can be invited" checked={allOnPage} onCheckedChange={(c) => pageInvitable.forEach((r) => toggle(r.application_id!, !!c))} />
                    </th>
                  )}
                  <th className={cn("py-3 pr-3 font-medium", !bulk && "pl-5")}>Candidate</th>
                  <th className="px-3 py-3 font-medium">Applied</th>
                  <th className="px-3 py-3 font-medium">Stage</th>
                  <th className="px-3 py-3 font-medium">Match</th>
                  <th className="px-3 py-3 font-medium">Interview</th>
                  <th className="px-3 py-3 font-medium whitespace-nowrap">Last activity</th>
                  <th className="py-3 pr-4 pl-2 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((r) => (
                  <Row key={r.id} r={r} jobId={jobId} listQuery={listQuery} bulk={bulk} invitable={invitable(r)} canInvite={canInvite}
                    checked={!!r.application_id && selected.has(r.application_id)} onCheck={(on) => toggle(r.application_id!, on)}
                    onInvite={() => { setSelected(new Set([r.application_id!])); setConfirm(true); }} />
                ))}
              </tbody>
            </table>
            {!shown.length && (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                {anyFilter ? "No one matches these filters." : stage ? `No one is in ${stageGroup(stage)?.label}.` : "Everyone in this job is in Rejected."}
              </p>
            )}
          </div>
          <Pager page={current} pages={pages} total={shown.length} pageSize={pageSize} setPage={(p) => set({ page: p })}
            setPageSize={(n) => set({ size: n })} />
        </>
      )}

      <Dialog open={confirm} onOpenChange={(o) => { if (!progress) { setConfirm(o); if (!o && chosen.length === 1) setSelected(new Set()); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite {chosen.length === 1 ? chosen[0].name : `${chosen.length} candidates`} to an AI interview?</DialogTitle>
            <DialogDescription>Each gets a personal interview link for the job&apos;s next AI round, built from the job and their resume.</DialogDescription>
          </DialogHeader>
          {chosen.length > 1 && <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">{chosen.map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><span>{r.name}</span><MatchCell r={{ ...r, job_id: jobId }} /></li>)}</ul>}
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={sendEmail} onCheckedChange={(c) => setSendEmail(!!c)} /> Email the invitations now</label>
          <BalanceNote balance={balance} count={chosen.length} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={!!progress}>Cancel</Button>
            <Button onClick={inviteChosen} disabled={!!progress || !chosen.length}>{progress && <Loader2 className="animate-spin" />}{progress ? `Inviting ${progress.done}/${progress.total}…` : "Invite"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Row({ r, jobId, listQuery, bulk, invitable, canInvite, checked, onCheck, onInvite }: {
  r: JobCandidateItem; jobId: string; listQuery: string; bulk: boolean; invitable: boolean; canInvite: boolean; checked: boolean; onCheck: (on: boolean) => void; onInvite: () => void;
}) {
  // A new application opens the application (screening and answers); anyone else opens their profile.
  // The detail page gets the list's filters, for Previous / Next and the way back to this exact list.
  const href = jobRowHref(jobId, r, listQuery);
  const flags = r.experience_flags ?? [];
  return (
    <tr className={cn("group relative transition-colors hover:bg-accent/40", checked && "bg-accent/60")}>
      {bulk && <td className="relative z-10 w-10 py-3 pl-5">{invitable && <Checkbox aria-label={`Select ${r.name}`} checked={checked} onCheckedChange={(c) => onCheck(!!c)} />}</td>}
      <td className={cn("py-3 pr-3", !bulk && "pl-5")}>
        <div className="flex items-center gap-3">
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold", avatarTone(r.id))}>{initials(r.name)}</span>
          <div className="min-w-0">
            <Link href={href} className="block max-w-44 truncate font-semibold after:absolute after:inset-0 group-hover:text-primary">{r.name}</Link>
            <p className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
              {r.source === "applied" ? "Applied" : "Added"}
              {r.experience_months !== null && <><span aria-hidden>·</span><span className="tabular">{r.experience_approximate ? "~" : ""}{shortExperience(r.experience_months)}</span></>}
              <ExperienceFlags flags={flags} />
              {!r.has_resume && <><span aria-hidden>·</span>No resume</>}
              {r.fit !== "none" && <FitBadge fit={{ level: r.fit }} className="ml-0.5 px-1.5 py-0 text-[11px]" />}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground tabular">{new Date(r.added_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
      <td className="px-3 py-3">
        <span title={JOB_STAGE_HINT[r.stage]} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap", STAGE_TONE[r.stage].pill)}>
          <span className={cn("size-1.5 rounded-full", STAGE_TONE[r.stage].dot)} aria-hidden />{JOB_STAGE_LABEL[r.stage]}
        </span>
      </td>
      <td className="px-3 py-3">{r.match_level || r.match_status === "pending" || r.match_status === "processing" ? <MatchCell r={{ ...r, job_id: jobId }} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
      <td className="px-3 py-3"><InterviewCell r={r} /></td>
      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{lastSeen(r.last_activity)}</td>
      <td className="relative z-10 py-3 pr-4 pl-2 text-right"><Actions r={r} jobId={jobId} listQuery={listQuery} invitable={invitable} canInvite={canInvite} onInvite={onInvite} /></td>
    </tr>
  );
}

/** "2h ago", "Yesterday", "3 days ago", then a short date. */
function lastSeen(at: string) {
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  if (days < 1) return timeAgo(at);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The latest interview for this job, as an icon and a word. */
function InterviewCell({ r }: { r: JobCandidateItem }) {
  const human = r.results.find((x) => x.state === "waiting" && x.entry?.kind === "human");
  const s = r.interview_status;
  const [Icon, label, tone] = human ? [CalendarClock, `${human.round.name} scheduled`, "text-blue-600 dark:text-blue-400"]
    : !s ? [Clock3, "Not invited", "text-muted-foreground"]
    : ["created", "invited", "consent_pending", "device_check", "ready"].includes(s) ? [CalendarClock, "Invited", "text-blue-600 dark:text-blue-400"]
    : ["in_progress", "completing"].includes(s) ? [PlayCircle, "In progress", "text-violet-600 dark:text-violet-400"]
    : ["completed", "processing", "report_ready"].includes(s) ? [CheckCircle2, s === "processing" ? "Report pending" : "Completed", "text-emerald-600 dark:text-emerald-400"]
    : s === "expired" ? [TimerOff, "Expired", "text-amber-600 dark:text-amber-400"]
    : s === "cancelled" ? [Ban, "Cancelled", "text-muted-foreground"]
    : [XCircle, "Failed", "text-rose-600 dark:text-rose-400"];
  const done = r.results.filter((x) => x.decision || x.state === "done").length;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon className={cn("size-4", tone)} aria-hidden /><span className={cn("font-medium", tone === "text-muted-foreground" ? "text-muted-foreground" : "text-foreground")}>{label}</span>
      {r.results.length > 1 && <span className="text-xs text-muted-foreground tabular" title={`${done} of ${r.results.length} rounds done`}>· {done}/{r.results.length}</span>}
    </span>
  );
}

function Actions({ r, jobId, listQuery, invitable, canInvite, onInvite }: { r: JobCandidateItem; jobId: string; listQuery: string; invitable: boolean; canInvite: boolean; onInvite: () => void }) {
  const router = useRouter();
  const profile = jobRowHref(jobId, { id: r.id, application_id: null, application_status: null }, listQuery);
  const application = r.application_id ? jobRowHref(jobId, { id: r.id, application_id: r.application_id, application_status: "new" }, listQuery) : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={`Actions for ${r.name}`} />}><MoreVertical /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {invitable && <DropdownMenuItem onClick={onInvite}><Send /> Invite to AI interview</DropdownMenuItem>}
        {!invitable && canInvite && r.stage === "to_invite" && (
          <DropdownMenuItem onClick={() => router.push(profile)}><Send /> {r.has_resume ? "Invite from profile" : "Add resume to invite"}</DropdownMenuItem>
        )}
        {r.stage === "review" && <DropdownMenuItem onClick={() => router.push(profile)}><CheckCircle2 /> Review and decide</DropdownMenuItem>}
        {r.interview_id && <DropdownMenuItem onClick={() => router.push(`/interviews/${r.interview_id}`)}><ExternalLink /> View interview</DropdownMenuItem>}
        {application && <DropdownMenuItem onClick={() => router.push(application)}><FileText /> View application</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push(profile)}><UserRound /> Open profile</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
