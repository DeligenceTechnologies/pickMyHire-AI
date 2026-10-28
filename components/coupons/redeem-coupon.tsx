"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client/api";

function RedeemForm({ id, onDone }: { id: string; onDone?: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await api<{ message: string }>("/api/coupons/redeem", { body: { code } });
      toast.success(res.message);
      setCode("");
      onDone?.();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-1.5">
      <Label htmlFor={id}>Promo code</Label>
      <div className="flex gap-2">
        <Input id={id} value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }} placeholder="e.g. LAUNCH50"
          autoComplete="off" spellCheck={false} maxLength={40} className="font-mono uppercase placeholder:normal-case" aria-invalid={!!error} />
        <Button type="submit" disabled={busy || !code.trim()}>{busy && <Loader2 className="animate-spin" />} Apply</Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

/** Inline box, for Settings → Usage. */
export function RedeemCouponBox() {
  return <RedeemForm id="promo-code" />;
}

/** A small button that opens the box, for the dashboard. */
export function RedeemCouponButton({ variant = "ghost" }: { variant?: "ghost" | "outline" | "link" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} className={variant === "link" ? "h-auto p-0 font-medium" : undefined}>
        {variant !== "link" && <Ticket />} Have a promo code?
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redeem a promo code</DialogTitle>
            <DialogDescription>Add free interviews or extra trial days to your company. Each code can be used once per company.</DialogDescription>
          </DialogHeader>
          <RedeemForm id="promo-code-dialog" onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
