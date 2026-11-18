"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/client/api";
import { money, quote, type Pricing } from "@/lib/pricing";

/**
 * Confirm a purchase: what you get, the total, and agreeing to the terms. Then on to Stripe's secure
 * payment page. The server recalculates the price; this only shows it.
 */
export function BuyDialog({ pricing, qty, validMonths, testMode, onClose }: {
  pricing: Pricing; qty: number | null; validMonths: number; testMode: boolean; onClose: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = qty ? quote(qty, pricing) : null;

  const pay = async () => {
    if (!q) return;
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("/api/billing/checkout", { body: { quantity: q.qty, accept_terms: true } });
      window.location.assign(url);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!q} onOpenChange={(o) => { if (!o && !busy) { setAgreed(false); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Buy {q?.qty} interviews</DialogTitle>
          <DialogDescription>One-time payment. No subscription, nothing renews.</DialogDescription>
        </DialogHeader>
        {q && (
          <div className="space-y-4">
            <dl className="divide-y rounded-lg border text-sm">
              <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted-foreground">Interviews</dt><dd className="font-medium tabular">{q.qty}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted-foreground">Price per interview</dt><dd className="font-medium tabular">{money(q.unitCents)}</dd></div>
              {q.savingsCents > 0 && <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted-foreground">You save</dt><dd className="font-medium text-emerald-700 tabular dark:text-emerald-400">{money(q.savingsCents)} ({q.savingPct}%)</dd></div>}
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="font-semibold">Total</dt><dd className="text-lg font-bold tabular">{money(q.totalCents)} <span className="text-xs font-normal text-muted-foreground">USD</span></dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">Interviews are added as soon as the payment goes through, and are valid for {validMonths} months. Taxes may apply depending on where you are.</p>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <Checkbox checked={agreed} onCheckedChange={(c) => setAgreed(c === true)} className="mt-0.5" disabled={busy} />
              <span>I agree to the <Link href="/terms" target="_blank" className="font-medium text-primary hover:underline">Terms of Service</Link> and <Link href="/refunds" target="_blank" className="font-medium text-primary hover:underline">Refund policy</Link>.</span>
            </label>
            {testMode && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <b>Test mode:</b> nothing is charged. Pay with card 4242 4242 4242 4242, any future date and any CVC.
              </p>
            )}
          </div>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={pay} disabled={!agreed || busy} className="h-11 w-full">
            {busy ? <Loader2 className="animate-spin" /> : <Lock />} {busy ? "Opening secure payment…" : `Pay ${q ? money(q.totalCents) : ""} securely`}
          </Button>
          <p className="text-center text-xs text-muted-foreground">You&apos;ll pay on Stripe&apos;s secure page. We never see your card details.</p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
