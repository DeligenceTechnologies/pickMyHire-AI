"use client";

import { useState } from "react";
import { Crown, Loader2, Trash2, UserPlus } from "lucide-react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { FormCard } from "@/components/settings/form-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/lib/client/use-action";
import { formatDate, initials, timeAgo } from "@/lib/format";
import { LinkResult } from "./link-result";
import { QuotaInput } from "./quota-input";

type Role = "owner" | "admin" | "recruiter" | "interviewer" | "viewer";
const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", recruiter: "Recruiter", interviewer: "Interviewer", viewer: "Viewer" };
const MEMBER_ROLES: Exclude<Role, "owner">[] = ["admin", "recruiter", "interviewer", "viewer"];

export type CompanyData = {
  org: { id: string; name: string; status: "active" | "suspended"; suspended_at: string | null; created_at: string; admin_notes: string | null; plan: "standard" | "trial"; trial_ends_at: string | null; trial_days_left: number | null; signup_domain: string | null };
  members: { id: string; user_id: string; name: string; email: string; role: Role; created_at: string; disabled_at: string | null; last_seen_at: string | null }[];
  invites: { id: string; email: string; role: Role; expires_at: string }[];
  quota: { quota: number | null; used: number; inProgress: number; remaining: number | null; countedFrom: string };
};

export function SuspendButton({ id, name, status }: { id: string; name: string; status: "active" | "suspended" }) {
  const { run } = useAction();
  return status === "active" ? (
    <ConfirmDialog
      title={`Suspend ${name}?`}
      description="Everyone in this company is signed out and can't log in. Their candidates' interview and apply links stop working. You can reactivate at any time; no data is deleted."
      confirmLabel="Suspend company"
      destructive
      onConfirm={async () => { await run("status", `/api/admin/companies/${id}`, { method: "PATCH", body: { status: "suspended" }, success: "Company suspended" }); }}
      trigger={(open) => <Button variant="destructive" onClick={open}>Suspend</Button>}
    />
  ) : (
    <Button onClick={() => run("status", `/api/admin/companies/${id}`, { method: "PATCH", body: { status: "active" }, success: "Company reactivated" })}>Reactivate</Button>
  );
}

/** Free-trial company: extend the trial or make it a full account. */
export function TrialCard({ id, endsAt, daysLeft, domain }: { id: string; endsAt: string | null; daysLeft: number | null; domain: string | null }) {
  const { run, pending } = useAction();
  const ended = daysLeft === 0;
  return (
    <FormCard title="Free trial" description={`${ended ? "Ended" : "Ends"} ${endsAt ? formatDate(endsAt) : "—"}${domain ? ` · signed up with @${domain}` : ""}. Interviews follow the free interviews below.`}>
      <div className="flex flex-wrap gap-2">
        {[7, 14].map((d) => (
          <Button key={d} variant="outline" size="sm" disabled={!!pending}
            onClick={() => run(`extend${d}`, `/api/admin/companies/${id}`, { method: "PATCH", body: { extendTrialDays: d }, success: `Trial extended by ${d} days` })}>
            {pending === `extend${d}` && <Loader2 className="animate-spin" />} Extend {d} days
          </Button>
        ))}
        <ConfirmDialog
          title="Convert to a full account?"
          description="The trial label and end date are removed. Free interviews stay as set below, so adjust them if needed."
          confirmLabel="Convert"
          onConfirm={async () => { await run("convert", `/api/admin/companies/${id}`, { method: "PATCH", body: { convertTrial: true }, success: "Converted to a full account" }); }}
          trigger={(open) => <Button size="sm" onClick={open}>Convert to full account</Button>}
        />
      </div>
    </FormCard>
  );
}

export function QuotaCard({ id, quota }: { id: string; quota: CompanyData["quota"] }) {
  const { run, pending } = useAction();
  const [value, setValue] = useState<number | null>(quota.quota);
  const save = (v: number | null) => run("quota", `/api/admin/companies/${id}`, { method: "PATCH", body: { quota: v }, success: "Interviews updated" });
  return (
    <FormCard title="Interviews" description={`Used when a candidate starts an interview, counted since ${formatDate(quota.countedFrom)}. Adding interviews emails any waiting candidates a new link.`}
      footer={<Button disabled={!!pending || value === quota.quota} onClick={() => save(value)}>{pending === "quota" && <Loader2 className="animate-spin" />} Save</Button>}>
      <div className="grid grid-cols-3 gap-3 text-center">
        {[["Used", quota.used], ["Waiting", quota.inProgress], ["Left", quota.remaining ?? "∞"]].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-0.5 text-xl font-semibold tabular">{v}</p></div>
        ))}
      </div>
      <QuotaInput id="company-quota" value={value} onChange={setValue} label="Allowed interviews" />
      {quota.quota !== null && (
        <div className="flex flex-wrap gap-2">
          {[1, 5, 10].map((n) => (
            <Button key={n} size="sm" variant="outline" disabled={!!pending} onClick={() => { const v = (quota.quota ?? 0) + n; setValue(v); save(v); }}>+{n}</Button>
          ))}
        </div>
      )}
    </FormCard>
  );
}

export function MembersCard({ id, members, invites }: { id: string; members: CompanyData["members"]; invites: CompanyData["invites"] }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("recruiter");
  const [result, setResult] = useState<{ added: boolean; link: string | null } | null>(null);
  return (
    <>
      <FormCard title="Members" description="People in this company." footer={<Button onClick={() => { setEmail(""); setResult(null); setOpen(true); }}><UserPlus /> Add member</Button>}>
        <ul className="-my-2 divide-y">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{initials(m.name)}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{m.name}{m.disabled_at && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300">Disabled</span>}</p>
                <p className="truncate text-sm text-muted-foreground">{m.email} · {m.last_seen_at ? `active ${timeAgo(m.last_seen_at)}` : "no active session"}</p>
              </div>
              {m.role === "owner" ? <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"><Crown className="size-3" /> Owner</span> : (
                <>
                  <select aria-label={`Role for ${m.name}`} value={m.role} disabled={!!pending}
                    onChange={(e) => run("role", `/api/admin/companies/${id}/members/${m.id}`, { method: "PATCH", body: { role: e.target.value }, success: "Role updated" })}
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm">
                    {MEMBER_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <ConfirmDialog title={`Make ${m.name} the owner?`} description="The current owner becomes an admin." confirmLabel="Transfer ownership"
                    onConfirm={async () => { await run("owner", `/api/admin/companies/${id}/members/${m.id}/owner`, { success: "Ownership transferred" }); }}
                    trigger={(o) => <Button variant="ghost" size="icon-sm" aria-label={`Make ${m.name} owner`} title="Make owner" onClick={o}><Crown /></Button>} />
                  <ConfirmDialog title={`Remove ${m.name}?`} description="They lose access to this company immediately. Their account isn't deleted." confirmLabel="Remove" destructive
                    onConfirm={async () => { await run("rm", `/api/admin/companies/${id}/members/${m.id}`, { method: "DELETE", success: "Member removed" }); }}
                    trigger={(o) => <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.name}`} onClick={o}><Trash2 /></Button>} />
                </>
              )}
            </li>
          ))}
        </ul>
      </FormCard>
      {invites.length > 0 && (
        <FormCard title="Pending invitations">
          <ul className="-my-2 divide-y">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-3 text-sm">
                <div className="flex-1"><p className="font-medium">{i.email}</p><p className="text-xs text-muted-foreground">{ROLE_LABEL[i.role]} · expires {formatDate(i.expires_at)}</p></div>
                <Button variant="ghost" size="sm" disabled={!!pending} onClick={() => run("revoke", `/api/admin/companies/${id}/invites/${i.id}`, { method: "DELETE", success: "Invitation revoked" })}>Revoke</Button>
              </li>
            ))}
          </ul>
        </FormCard>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a member</DialogTitle><DialogDescription>People who already have an account join right away. Others get an invite link (valid 7 days).</DialogDescription></DialogHeader>
          {result ? (result.added ? <p className="text-sm">Added. They&apos;ll see this company the next time they sign in.</p> : <LinkResult link={result.link!} note="Invitation created. Share this link with them:" />) : (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="am-email" required>Email</Label><Input id="am-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="am-role" required>Role</Label>
                <select id="am-role" value={role} onChange={(e) => setRole(e.target.value as Exclude<Role, "owner">)} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm">
                  {MEMBER_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </div>
            </div>
          )}
          <DialogFooter>
            {result ? <Button onClick={() => setOpen(false)}>Done</Button> : (
              <Button disabled={!!pending || !email.trim()} onClick={async () => {
                const r = await run<{ added: boolean; link: string | null }>("add", `/api/admin/companies/${id}/members`, { body: { email, role }, success: "Member added" });
                if (r) setResult(r);
              }}>{pending === "add" && <Loader2 className="animate-spin" />} Add member</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NotesCard({ id, notes }: { id: string; notes: string | null }) {
  const { run, pending } = useAction();
  const [value, setValue] = useState(notes ?? "");
  return (
    <FormCard title="Private notes" description="Only platform admins see these."
      footer={<Button disabled={!!pending || value === (notes ?? "")} onClick={() => run("notes", `/api/admin/companies/${id}`, { method: "PATCH", body: { notes: value.trim() || null }, success: "Notes saved" })}>Save notes</Button>}>
      <Textarea aria-label="Private notes" rows={4} maxLength={4000} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Pilot terms, contacts, renewal dates…" />
    </FormCard>
  );
}
