"use client";

import { useState } from "react";
import { Check, Loader2, Minus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/common/copy-button";
import { useAction } from "@/lib/client/use-action";
import { formatDate, initials } from "@/lib/format";
import { ROLE_INFO, ROLE_MATRIX, ROLE_ORDER } from "@/lib/auth/role-info";
import { cn } from "@/lib/utils";
import { FormCard } from "./form-card";

type Role = "owner" | "admin" | "recruiter" | "interviewer" | "viewer";
const LABEL = Object.fromEntries(ROLE_ORDER.map((r) => [r, ROLE_INFO[r].label])) as Record<Role, string>;

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
                    {assignable.map((r) => <option key={r} value={r} title={ROLE_INFO[r].summary}>{LABEL[r]}</option>)}
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
      <FormCard title="Roles" description="What each role can do. Pick the smallest role that lets someone do their job.">
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-1 py-2 font-medium"><span className="sr-only">Can</span></th>
                {ROLE_ORDER.map((r) => <th key={r} className="px-1 py-2 text-center font-medium text-foreground">{LABEL[r]}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {ROLE_MATRIX.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-1 py-2 text-left font-normal text-muted-foreground">{row.label}</th>
                  {ROLE_ORDER.map((r) => {
                    const v = row.can[r];
                    return (
                      <td key={r} className="px-1 py-2 text-center">
                        {v === true ? <Check className="mx-auto size-4 text-emerald-600 dark:text-emerald-400" aria-label="Yes" />
                          : v === false ? <Minus className="mx-auto size-4 text-muted-foreground/50" aria-label="No" />
                          : <span className="text-xs text-amber-700 dark:text-amber-300">{v}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FormCard>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Invite a team member</DialogTitle><DialogDescription>They&apos;ll get an email with a link to join. Links expire after 7 days.</DialogDescription></DialogHeader>
          {link ? (
            <div className="space-y-2"><p className="text-sm">Invitation sent. You can also share this link directly:</p><div className="flex gap-2"><Input readOnly value={link} className="font-mono text-xs" /><CopyButton value={link} /></div></div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="inv-email" required>Email</Label><Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 text-sm font-medium">Role <span className="font-normal text-muted-foreground">· pick the smallest one that fits</span></legend>
                <div className="space-y-2">
                  {assignable.map((r) => (
                    <label key={r} className={cn("flex cursor-pointer gap-3 rounded-xl border px-3.5 py-3 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
                      role === r ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50")}>
                      <input type="radio" name="inv-role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-1 size-4 shrink-0 accent-primary" />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">{LABEL[r]}{r === "recruiter" && <span className="text-xs font-normal text-muted-foreground">Most common</span>}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{ROLE_INFO[r].summary}</span>
                        <span className="mt-1 block text-xs"><span className="text-muted-foreground">Best for: </span>{ROLE_INFO[r].bestFor}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {!assignable.includes("admin") && <p className="pt-1 text-xs text-muted-foreground">Only the Owner can add Admins.</p>}
              </fieldset>
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
