"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ClientApiError } from "@/lib/client/api";
import { describeReward, generateCode, normalizeCode } from "@/lib/coupons";
import { useAction } from "@/lib/client/use-action";

export type CouponValues = {
  code: string; interviews: string; trialDays: string; maxUses: string; expiresAt: string; active: boolean; note: string;
};

const EMPTY = (): CouponValues => ({ code: generateCode(), interviews: "10", trialDays: "0", maxUses: "", expiresAt: "", active: true, note: "" });
const int = (s: string) => (s.trim() === "" ? 0 : Math.max(0, Math.round(Number(s))));

function CouponDialog({ open, onOpenChange, id, initial, used }: {
  open: boolean; onOpenChange: (o: boolean) => void; id?: string; initial: CouponValues; used: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof CouponValues>(k: K, x: CouponValues[K]) => { setV((p) => ({ ...p, [k]: x })); setErrors((e) => ({ ...e, [k]: "" })); };
  const reward = describeReward(int(v.interviews), int(v.trialDays));

  const save = async () => {
    setBusy(true); setErrors({});
    const payload = {
      code: v.code, interviews: int(v.interviews), trialDays: int(v.trialDays),
      maxUses: v.maxUses.trim() ? int(v.maxUses) : null, expiresAt: v.expiresAt || null, active: v.active, note: v.note.trim() || null,
    };
    try {
      const res = await api<{ id?: string }>(id ? `/api/admin/coupons/${id}` : "/api/admin/coupons", { method: id ? "PATCH" : "POST", body: payload });
      toast.success(id ? "Coupon saved" : "Coupon created");
      onOpenChange(false);
      if (!id && res.id) router.push(`/admin/coupons/${res.id}`);
      router.refresh();
    } catch (err) {
      const issues = err instanceof ClientApiError ? err.issues : undefined;
      if (issues?.length) setErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
      else toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{id ? "Edit coupon" : "New coupon"}</DialogTitle>
          <DialogDescription>Companies apply the code from Settings → Usage or their dashboard. Each company can use it once.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cp-code" required>Code</Label>
            <div className="flex gap-2">
              <Input id="cp-code" className="font-mono uppercase" value={v.code} disabled={used} maxLength={32}
                onChange={(e) => set("code", normalizeCode(e.target.value))} aria-invalid={!!errors.code} />
              {!used && <Button type="button" variant="outline" size="icon" aria-label="Generate a new code" onClick={() => set("code", generateCode())}><RefreshCw /></Button>}
            </div>
            {errors.code ? <p className="text-xs text-destructive">{errors.code}</p> : used && <p className="text-xs text-muted-foreground">The code can&apos;t change after it has been used.</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cp-interviews">Free interviews to add</Label>
              <Input id="cp-interviews" inputMode="numeric" value={v.interviews} onChange={(e) => set("interviews", e.target.value.replace(/\D/g, ""))} aria-invalid={!!errors.interviews} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-days">Extra trial days</Label>
              <Input id="cp-days" inputMode="numeric" value={v.trialDays} onChange={(e) => set("trialDays", e.target.value.replace(/\D/g, ""))} aria-invalid={!!errors.trialDays} />
            </div>
          </div>
          {errors.interviews ? <p className="-mt-2 text-xs text-destructive">{errors.interviews}</p>
            : <p className="-mt-2 text-xs text-muted-foreground">{reward ? `Gives: ${reward}.` : "Add free interviews, trial days or both."} Trial days only apply to companies on a free trial, and restart an ended trial.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cp-max">Maximum companies <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="cp-max" inputMode="numeric" placeholder="No limit" value={v.maxUses} onChange={(e) => set("maxUses", e.target.value.replace(/\D/g, ""))} aria-invalid={!!errors.maxUses} />
              {errors.maxUses && <p className="text-xs text-destructive">{errors.maxUses}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-expires">Valid until <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="cp-expires" type="date" value={v.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} aria-invalid={!!errors.expiresAt} />
              {errors.expiresAt && <p className="text-xs text-destructive">{errors.expiresAt}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-note">Campaign / note <span className="font-normal text-muted-foreground">(only admins see this)</span></Label>
            <Textarea id="cp-note" rows={2} maxLength={500} placeholder="e.g. LinkedIn launch campaign, November" value={v.note} onChange={(e) => set("note", e.target.value)} />
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={v.active} onCheckedChange={(c) => set("active", c)} aria-label="Coupon on" />
            {v.active ? "On: companies can apply this code" : "Off: the code is refused"}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !v.code || !reward}>{busy && <Loader2 className="animate-spin" />}{id ? "Save" : "Create coupon"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewCouponButton() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <Button onClick={() => { setKey((k) => k + 1); setOpen(true); }}><Plus /> New coupon</Button>
      {open && <CouponDialog key={key} open={open} onOpenChange={setOpen} initial={EMPTY()} used={false} />}
    </>
  );
}

export function EditCouponButton({ id, initial, used }: { id: string; initial: CouponValues; used: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><Pencil /> Edit</Button>
      {open && <CouponDialog open={open} onOpenChange={setOpen} id={id} initial={initial} used={used} />}
    </>
  );
}

export function DeleteCouponButton({ id }: { id: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  return (
    <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={!!pending} onClick={async () => {
      if (!window.confirm("Delete this coupon? It hasn't been used yet.")) return;
      const res = await run("delete", `/api/admin/coupons/${id}`, { method: "DELETE", success: "Coupon deleted", refresh: false });
      if (res) { router.push("/admin/coupons"); router.refresh(); }
    }}>{pending === "delete" ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete</Button>
  );
}
