"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Inbox, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/states";
import { api } from "@/lib/client/api";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FIT_LABEL, type Fit } from "@/lib/application-form";
import { APPLICATION_STATUS, MatchBadge } from "./match-badge";
import { FitBadge } from "./answers-card";

type Row = {
  id: string; job_id: string; status: string; created_at: string; screening_status: string; match_level: string | null;
  requirements_met: number | null; requirements_total: number | null; candidate_name: string; candidate_email: string; fit: Fit;
};

const MATCH_FILTERS = [
  { v: "", l: "All" }, { v: "strong_match", l: "Strong" }, { v: "good_match", l: "Good" }, { v: "partial_match", l: "Partial" },
  { v: "low_match", l: "Low" }, { v: "insufficient_information", l: "Not enough info" },
];
const ORDER: Record<string, number> = { strong_match: 5, good_match: 4, partial_match: 3, low_match: 2, insufficient_information: 1 };
/** Good or strong on skills, and nothing outside the job's limits. */
const isTopFit = (r: Row) => (r.match_level === "strong_match" || r.match_level === "good_match") && (r.fit.level === "ok" || r.fit.level === "none");

export function ApplicationsTable({ rows, canInvite = false }: { rows: Row[]; canInvite?: boolean }) {
  const router = useRouter();
  const [match, setMatch] = useState("");
  const [top, setTop] = useState(false);
  const [fit, setFit] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<"recent" | "match">("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const shown = useMemo(() => {
    const r = rows.filter((x) => (!top || isTopFit(x)) && (!match || x.match_level === match) && (!fit || x.fit.level === fit) && (!status || x.status === status));
    return sort === "match" ? [...r].sort((a, b) => (ORDER[b.match_level ?? ""] ?? 0) - (ORDER[a.match_level ?? ""] ?? 0)) : r;
  }, [rows, match, top, fit, status, sort]);
  const invitable = shown.filter((r) => r.status === "new");
  const chosen = rows.filter((r) => selected.has(r.id) && r.status === "new");
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  const inviteAll = async () => {
    setProgress({ done: 0, total: chosen.length });
    const failed: string[] = [];
    for (const [i, r] of chosen.entries()) {
      try {
        await api(`/api/applications/${r.id}/invite`, { body: { sendInvite: sendEmail } });
      } catch (e) {
        failed.push(`${r.candidate_name}: ${(e as Error).message}`);
        if ((e as { status?: number }).status === 402 || /quota|free interviews|limit/i.test((e as Error).message)) break;
      }
      setProgress({ done: i + 1, total: chosen.length });
    }
    setProgress(null);
    setConfirm(false);
    setSelected(new Set());
    const ok = chosen.length - failed.length;
    if (ok) toast.success(`${ok} ${ok === 1 ? "applicant" : "applicants"} invited`);
    if (failed.length) toast.error(failed.slice(0, 3).join("\n"));
    router.refresh();
  };

  if (!rows.length) return <div className="p-5"><EmptyState icon={Inbox} title="No applications yet" description="Turn on the public application link and share it on job boards, LinkedIn or your careers page." /></div>;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => setTop(!top)} aria-pressed={top}
            className={cn("rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", top ? "bg-emerald-600 text-white ring-emerald-600" : "bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900")}>
            Matches skills and limits · {rows.filter(isTopFit).length}
          </button>
          {MATCH_FILTERS.map((f) => (
            <button key={f.v} type="button" onClick={() => setMatch(f.v)} className={cn("rounded-full px-2.5 py-1 text-xs font-medium", match === f.v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>
              {f.l}{f.v && ` · ${rows.filter((r) => r.match_level === f.v).length}`}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <select aria-label="Fit" value={fit} onChange={(e) => setFit(e.target.value)} className="h-7 rounded-md border border-input bg-background px-2 text-xs">
            <option value="">Any fit</option>
            {(["ok", "warn", "fail", "none"] as const).map((k) => <option key={k} value={k}>{FIT_LABEL[k]}</option>)}
          </select>
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-7 rounded-md border border-input bg-background px-2 text-xs">
            <option value="">All statuses</option>
            {Object.entries(APPLICATION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as "recent" | "match")} className="h-7 rounded-md border border-input bg-background px-2 text-xs">
            <option value="recent">Newest first</option>
            <option value="match">By AI match</option>
          </select>
        </div>
      </div>
      {canInvite && chosen.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-accent/50 px-5 py-2.5">
          <p className="text-sm">{chosen.length} selected</p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button size="sm" onClick={() => setConfirm(true)}><Send /> Invite selected to AI interview</Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              {canInvite && (
                <th className="w-10 px-4 py-2.5">
                  <Checkbox aria-label="Select all new applications shown" disabled={!invitable.length}
                    checked={invitable.length > 0 && invitable.every((r) => selected.has(r.id))}
                    onCheckedChange={(c) => setSelected(c ? new Set(invitable.map((r) => r.id)) : new Set())} />
                </th>
              )}
              <th className="px-4 py-2.5 font-medium">Applicant</th><th className="px-4 py-2.5 font-medium">AI screening</th><th className="px-4 py-2.5 font-medium">Fit</th>
              <th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 text-right font-medium">Applied</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((a) => (
              <tr key={a.id} className="group relative hover:bg-muted/40">
                {canInvite && (
                  <td className="relative z-10 px-4 py-3">
                    {a.status === "new" && <Checkbox aria-label={`Select ${a.candidate_name}`} checked={selected.has(a.id)} onCheckedChange={(c) => toggle(a.id, !!c)} />}
                  </td>
                )}
                <td className="px-4 py-3">
                  <Link href={`/jobs/${a.job_id}/applications/${a.id}`} className="font-medium after:absolute after:inset-0 group-hover:text-primary">{a.candidate_name}</Link>
                  <p className="text-xs text-muted-foreground">{a.candidate_email}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <MatchBadge level={a.match_level} screeningStatus={a.screening_status} />
                    {a.requirements_total ? <span className="text-xs text-muted-foreground tabular">{a.requirements_met}/{a.requirements_total} requirements</span> : null}
                  </div>
                </td>
                <td className="px-4 py-3" title={a.fit.items.map((i) => `${i.label}: ${i.detail}`).join("\n") || undefined}><FitBadge fit={a.fit} /></td>
                <td className="px-4 py-3"><span className={cn("text-xs font-medium", a.status === "new" ? "text-primary" : a.status === "declined" ? "text-muted-foreground" : "")}>{APPLICATION_STATUS[a.status]}</span></td>
                <td className="px-4 py-3 text-right text-muted-foreground">{timeAgo(a.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="p-6 text-center text-sm text-muted-foreground">No applications match these filters.</p>}
      </div>
      <Dialog open={confirm} onOpenChange={(o) => !progress && setConfirm(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite {chosen.length} {chosen.length === 1 ? "applicant" : "applicants"} to an AI interview?</DialogTitle>
            <DialogDescription>Each gets a personal interview link for the job&apos;s next AI round, built from the job and their resume.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">{chosen.map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><span>{r.candidate_name}</span><FitBadge fit={r.fit} /></li>)}</ul>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={sendEmail} onCheckedChange={(c) => setSendEmail(!!c)} /> Email the invitations now</label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={!!progress}>Cancel</Button>
            <Button onClick={inviteAll} disabled={!!progress}>{progress && <Loader2 className="animate-spin" />}{progress ? `Inviting ${progress.done}/${progress.total}…` : "Invite"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
