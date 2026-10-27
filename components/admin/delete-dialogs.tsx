"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client/api";

type Impact = { id: string; name: string; jobs: number; candidates: number; interviews: number };
const summary = (c: Impact) => `${c.jobs} job${c.jobs === 1 ? "" : "s"}, ${c.candidates} candidate${c.candidates === 1 ? "" : "s"}, ${c.interviews} interview${c.interviews === 1 ? "" : "s"}`;

/** Fix a mistyped email. */
export function ChangeEmailDialog({ id, name, email, open, onOpenChange }: { id: string; name: string; email: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [value, setValue] = useState(email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change email for {name}</DialogTitle>
          <DialogDescription>For a mistyped email. Their account, companies and history stay the same; they sign in with the new email.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="ce-email">New email</Label>
          <Input id="ce-email" type="email" value={value} onChange={(e) => setValue(e.target.value)} />
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !value.trim() || value.trim().toLowerCase() === email.toLowerCase()} onClick={async () => {
            setBusy(true); setError(null);
            try {
              await api(`/api/admin/users/${id}`, { method: "PATCH", body: { email: value } });
              toast.success("Email changed");
              onOpenChange(false);
              router.refresh();
            } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
          }}>{busy && <Loader2 className="animate-spin" />}Change email</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Permanently delete a user, after showing what goes with them. */
export function DeleteUserDialog({ id, name, open, onOpenChange }: { id: string; name: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [preview, setPreview] = useState<{ email: string; blockers: string[]; companiesDeleted: Impact[]; staysIn: string[] } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api<NonNullable<typeof preview>>(`/api/admin/users/${id}/delete`).then((p) => { if (live) { setPreview(p); setConfirm(""); setError(null); } })
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [open, id]);
  const blocked = !preview || preview.blockers.length > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name} permanently?</DialogTitle>
          <DialogDescription>The account is removed and the email can be used to sign up again. This can&apos;t be undone.</DialogDescription>
        </DialogHeader>
        {!preview && !error && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking…</p>}
        {preview && preview.blockers.length > 0 && (
          <div role="alert" className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" /> Can&apos;t delete yet</p>
            <ul className="list-disc space-y-0.5 pl-5">{preview.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
        {preview && !preview.blockers.length && (
          <div className="space-y-3 text-sm">
            {preview.companiesDeleted.length > 0 && (
              <div className="rounded-lg bg-destructive/10 p-3 text-destructive">
                <p className="font-medium">They&apos;re the only member of these companies, which are deleted too, with all their data and files:</p>
                <ul className="mt-1 list-disc pl-5">{preview.companiesDeleted.map((c) => <li key={c.id}><span className="font-medium">{c.name}</span>: {summary(c)}</li>)}</ul>
              </div>
            )}
            {preview.staysIn.length > 0 && <p className="text-muted-foreground">They&apos;re removed from: {preview.staysIn.join(", ")}. Those companies and their data stay.</p>}
            <div className="space-y-1.5">
              <Label htmlFor="du-confirm">Type <span className="font-mono">{preview.email}</span> to confirm</Label>
              <Input id="du-confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant="destructive" disabled={busy || blocked || confirm.trim().toLowerCase() !== preview?.email.toLowerCase()} onClick={async () => {
            setBusy(true); setError(null);
            try {
              await api(`/api/admin/users/${id}/delete`, { body: { confirmEmail: confirm } });
              toast.success(`${name} deleted`);
              onOpenChange(false);
              router.refresh();
            } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
          }}>{busy && <Loader2 className="animate-spin" />}<Trash2 /> Delete permanently</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Permanently delete a suspended company. */
export function DeleteCompanyButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<(Impact & { recording_bytes: number; onlyHere: { id: string; name: string; email: string }[] }) | null>(null);
  const [confirm, setConfirm] = useState("");
  const [members, setMembers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api<NonNullable<typeof preview>>(`/api/admin/companies/${id}/delete`).then((p) => { if (live) { setPreview(p); setConfirm(""); setError(null); } })
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [open, id]);
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}><Trash2 /> Delete company</Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {name} permanently?</DialogTitle>
            <DialogDescription>Everything in this company is deleted, including files in storage. This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          {!preview && !error && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking…</p>}
          {preview && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-destructive/10 p-3 text-destructive">
                <p className="font-medium">{summary(preview)}{preview.recording_bytes > 0 ? `, ${Math.round(preview.recording_bytes / 1048576)} MB of recordings` : ""}, plus resumes, reports, notes and settings.</p>
              </div>
              {preview.onlyHere.length > 0 && (
                <label className="flex items-start gap-2">
                  <Checkbox checked={members} onCheckedChange={(c) => setMembers(!!c)} className="mt-0.5" />
                  <span>Also delete the accounts of members who aren&apos;t in any other company, so their emails can be used again: {preview.onlyHere.map((u) => u.email).join(", ")}</span>
                </label>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="dc-confirm">Type <span className="font-medium">{preview.name}</span> to confirm</Label>
                <Input id="dc-confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" disabled={busy || !preview || confirm.trim() !== preview.name.trim()} onClick={async () => {
              setBusy(true); setError(null);
              try {
                await api(`/api/admin/companies/${id}/delete`, { body: { confirmName: confirm, deleteMembers: members } });
                toast.success(`${name} deleted`);
                router.push("/admin/companies");
                router.refresh();
              } catch (e) { setError((e as Error).message); setBusy(false); }
            }}>{busy && <Loader2 className="animate-spin" />}<Trash2 /> Delete permanently</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
