"use client";

import { useState } from "react";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/common/copy-button";
import { useAction } from "@/lib/client/use-action";
import { formatDate, initials } from "@/lib/format";
import { FormCard } from "./form-card";

type Role = "owner" | "admin" | "recruiter" | "interviewer" | "viewer";
const LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", recruiter: "Recruiter", interviewer: "Interviewer", viewer: "Viewer" };
const DESC: Record<Role, string> = {
  owner: "Everything, including billing and organization settings",
  admin: "Manage jobs, candidates, templates, team, privacy and usage",
  recruiter: "Jobs, candidates, templates, interviews and reports",
  interviewer: "View interviews, reports and recordings",
  viewer: "Read-only access to interviews and reports",
};

export function TeamManager({ members, invites, me, assignable, canManage }: {
  members: { id: string; user_id: string; name: string; email: string; role: Role; created_at: string }[];
  invites: { id: string; email: string; role: Role; expires_at: string }[];
  me: string;
  assignable: Role[];
  canManage: boolean;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(assignable.includes("recruiter") ? "recruiter" : assignable[0]);
  const [link, setLink] = useState<string | null>(null);
  return (
    <>
      <FormCard title="Members" description="People with access to this workspace." footer={canManage && <Button onClick={() => { setLink(null); setEmail(""); setOpen(true); }}><UserPlus /> Invite member</Button>}>
        <ul className="-my-2 divide-y">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{initials(m.name)}</span>
              <div className="min-w-0 flex-1"><p className="font-medium">{m.name}{m.user_id === me && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</p><p className="text-sm text-muted-foreground">{m.email}</p></div>
              {canManage && m.user_id !== me && m.role !== "owner" && assignable.includes(m.role) ? (
                <>
                  <select aria-label={`Role for ${m.name}`} value={m.role} disabled={!!pending} onChange={(e) => run("role", `/api/organizations/members/${m.id}`, { method: "PATCH", body: { role: e.target.value }, success: "Role updated" })}
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm">
                    {assignable.map((r) => <option key={r} value={r}>{LABEL[r]}</option>)}
                  </select>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.name}`} onClick={() => run("rm", `/api/organizations/members/${m.id}`, { method: "DELETE", success: "Member removed" })}><Trash2 /></Button>
                </>
              ) : <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{LABEL[m.role]}</span>}
            </li>
          ))}
        </ul>
      </FormCard>
      {invites.length > 0 && (
        <FormCard title="Pending invitations">
          <ul className="-my-2 divide-y">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-3 text-sm">
                <div className="flex-1"><p className="font-medium">{i.email}</p><p className="text-xs text-muted-foreground">{LABEL[i.role]} · expires {formatDate(i.expires_at)}</p></div>
                {canManage && <Button variant="ghost" size="sm" onClick={() => run("revoke", `/api/organizations/invites/${i.id}`, { method: "DELETE", success: "Invitation revoked" })}>Revoke</Button>}
              </li>
            ))}
          </ul>
        </FormCard>
      )}
      <FormCard title="Roles">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">{(Object.keys(LABEL) as Role[]).map((r) => <div key={r}><dt className="font-medium">{LABEL[r]}</dt><dd className="text-muted-foreground">{DESC[r]}</dd></div>)}</dl>
      </FormCard>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite a team member</DialogTitle><DialogDescription>They&apos;ll get an email with a link to join. Links expire after 7 days.</DialogDescription></DialogHeader>
          {link ? (
            <div className="space-y-2"><p className="text-sm">Invitation sent. You can also share this link directly:</p><div className="flex gap-2"><Input readOnly value={link} className="font-mono text-xs" /><CopyButton value={link} /></div></div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="inv-email" required>Email</Label><Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="inv-role" required>Role</Label>
                <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm">
                  {assignable.map((r) => <option key={r} value={r}>{LABEL[r]} — {DESC[r]}</option>)}
                </select>
              </div>
            </div>
          )}
          <DialogFooter>
            {link ? <Button onClick={() => setOpen(false)}>Done</Button> : (
              <Button disabled={!!pending || !email} onClick={async () => { const r = await run<{ link: string }>("invite", "/api/organizations/members", { body: { email, role }, success: "Invitation sent", emailFix: "Copy the invite link below and send it to them yourself." }); if (r) setLink(r.link); }}>
                {pending === "invite" && <Loader2 className="animate-spin" />}Send invitation
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
