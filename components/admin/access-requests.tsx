"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Loader2, Mail, Phone, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/lib/client/use-action";
import { INQUIRY_TOPIC_LABEL, type InquiryTopic } from "@/lib/marketing";
import { cn } from "@/lib/utils";
import { LinkResult } from "./link-result";
import { QuotaInput } from "./quota-input";
import { LocalTime } from "@/components/common/local-time";

type Status = "new" | "contacted" | "approved" | "rejected" | "closed";
export type AccessRequest = {
  id: string; topic: InquiryTopic; topic_other: string | null; name: string; email: string; company: string | null; team_size: string | null; phone: string | null; message: string | null;
  status: Status; notes: string | null; created_at: string; reviewed_at: string | null; reviewer: string | null;
};

const STATUS: Record<Status, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  contacted: { label: "Contacted", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  rejected: { label: "Rejected", cls: "bg-muted text-muted-foreground" },
  closed: { label: "Closed", cls: "bg-muted text-muted-foreground" },
};

export function AccessRequestList({ requests, defaultQuota }: { requests: AccessRequest[]; defaultQuota: number | null }) {
  return (
    <ul className="space-y-3">
      {requests.map((r) => <RequestCard key={r.id} r={r} defaultQuota={defaultQuota} />)}
    </ul>
  );
}

function RequestCard({ r, defaultQuota }: { r: AccessRequest; defaultQuota: number | null }) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [notes, setNotes] = useState(r.notes ?? "");
  const [approving, setApproving] = useState(false);
  const [companyName, setCompanyName] = useState(r.company ?? "");
  const access = r.topic === "access";
  const done = access ? r.status === "approved" || r.status === "rejected" : r.status === "closed";
  const [email, setEmail] = useState(r.email);
  const [quota, setQuota] = useState<number | null>(defaultQuota);
  const [link, setLink] = useState<string | null>(null);
  const notesChanged = notes !== (r.notes ?? "");
  return (
    <li className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", access ? "bg-primary/10 text-primary" : "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300")}>
              {r.topic === "other" && r.topic_other ? `Other: ${r.topic_other}` : INQUIRY_TOPIC_LABEL[r.topic]}
            </span>
            <span className="font-semibold">{r.company ?? r.name}</span>
          </p>
          {r.company && <p className="text-sm">{r.name}</p>}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Mail className="size-3.5" />{r.email}</span>
            {r.phone && <span className="flex items-center gap-1"><Phone className="size-3.5" />{r.phone}</span>}
            {r.team_size && <span className="flex items-center gap-1"><Users className="size-3.5" />{r.team_size} employees</span>}
            <span>Received <LocalTime date={r.created_at} /></span>
          </div>
        </div>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS[r.status].cls)}>{STATUS[r.status].label}</span>
      </div>
      {r.message && <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">{r.message}</p>}
      <div className="mt-4 space-y-1.5">
        <Label htmlFor={`notes-${r.id}`} className="text-xs text-muted-foreground">Private notes</Label>
        <Textarea id={`notes-${r.id}`} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Call notes, follow-up date…" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {notesChanged && <Button size="sm" variant="outline" disabled={!!pending} onClick={() => run("notes", `/api/admin/requests/${r.id}`, { method: "PATCH", body: { notes: notes.trim() || null }, success: "Notes saved" })}>Save notes</Button>}
        {!done && (
          <>
            {access && <Button size="sm" onClick={() => { setLink(null); setApproving(true); }}><CheckCircle2 /> Approve</Button>}
            {r.status !== "contacted" && <Button size="sm" variant={access ? "outline" : "default"} disabled={!!pending} onClick={() => run("st", `/api/admin/requests/${r.id}`, { method: "PATCH", body: { status: "contacted" }, success: "Marked as contacted" })}>Mark contacted</Button>}
            {access
              ? <Button size="sm" variant="ghost" disabled={!!pending} onClick={() => run("st", `/api/admin/requests/${r.id}`, { method: "PATCH", body: { status: "rejected" }, success: "Request rejected" })}>Reject</Button>
              : <Button size="sm" variant="outline" disabled={!!pending} onClick={() => run("st", `/api/admin/requests/${r.id}`, { method: "PATCH", body: { status: "closed" }, success: "Closed" })}>Close</Button>}
          </>
        )}
        {done && (
          <Button size="sm" variant="ghost" disabled={!!pending} onClick={() => run("st", `/api/admin/requests/${r.id}`, { method: "PATCH", body: { status: "new" }, success: "Moved back to new" })}>Move back to new</Button>
        )}
        {r.reviewer && <span className="ml-auto text-xs text-muted-foreground">Last updated by {r.reviewer} · <LocalTime date={r.reviewed_at} /></span>}
      </div>

      <Dialog open={approving} onOpenChange={(o) => { setApproving(o); if (!o && link) router.refresh(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve {r.company ?? r.name}</DialogTitle>
            <DialogDescription>Creates a one-time sign-up link. The company is created when they use it, with them as owner.</DialogDescription>
          </DialogHeader>
          {link ? (
            <LinkResult link={link} note="Approved. Send this link to the client. It works once, only for this email, and expires in 14 days." />
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor={`cn-${r.id}`} required>Company name</Label><Input id={`cn-${r.id}`} value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor={`em-${r.id}`} required>Owner email</Label><Input id={`em-${r.id}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <QuotaInput id={`q-${r.id}`} value={quota} onChange={setQuota} />
            </div>
          )}
          <DialogFooter>
            {link ? <Button onClick={() => { setApproving(false); router.refresh(); }}>Done</Button> : (
              <Button disabled={!!pending || !companyName.trim() || !email.trim()} onClick={async () => {
                const res = await run<{ link: string }>("approve", `/api/admin/requests/${r.id}/approve`, { body: { companyName, email, quota }, success: "Access approved", refresh: false });
                if (res) setLink(res.link);
              }}>
                {pending === "approve" && <Loader2 className="animate-spin" />} Approve and create link
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
