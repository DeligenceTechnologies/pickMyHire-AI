"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { OrderDocumentButtons, OrderHelp } from "@/components/billing/order-details";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { localPaidNote, money } from "@/lib/pricing";
import type { PurchaseDetails } from "@/lib/services/billing";

/**
 * Shown once when the buyer comes back from Stripe after paying: what they bought, where the receipt and
 * invoice are, and the details to quote if they need to contact us. Closing it drops `?purchase=` from the
 * address, so a refresh doesn't show it again (the history page keeps the same details).
 */
export function PaymentSuccessDialog({ p, company, balance, waiting }: {
  p: PurchaseDetails; company: string; balance: number | null; waiting: number;
}) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  // The header (trial banner, balance) was drawn while the payment was still being added: redraw it once.
  useEffect(() => { router.refresh(); }, [router]);
  const close = () => {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("purchase");
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  const rows: [string, string][] = [
    ["Order ID", p.reference],
    ...(p.invoice_number ? [["Invoice number", p.invoice_number] as [string, string]] : []),
    ["Amount paid", `${money(p.total_cents)} USD`],
    ...(localPaidNote(p) ? [["Paid in your currency", localPaidNote(p)!] as [string, string]] : []),
    ["Interviews", `${p.quantity} × ${money(p.unit_cents)} each`],
    ["Paid on", formatDate(p.paid_at ?? p.created_at, true)],
    ...(p.payment_method ? [["Paid with", p.payment_method] as [string, string]] : []),
    ["Valid until", formatDate(p.expires_at)],
    ...(p.buyer_email ? [["Receipt sent to", p.buyer_email] as [string, string]] : []),
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="items-center text-center sm:items-center sm:text-center">
          <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300">
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          <DialogTitle className="text-xl">Payment successful</DialogTitle>
          <DialogDescription>
            Thank you! <b className="font-medium text-foreground">{p.quantity} interviews</b> were added to {company}
            {balance !== null ? <>. You now have <b className="font-medium text-foreground">{balance}</b> available.</> : "."}
          </DialogDescription>
        </DialogHeader>

        {waiting > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {waiting} {waiting === 1 ? "candidate is" : "candidates are"} waiting: they can start now with the same link.
          </p>
        )}

        <dl className="divide-y rounded-xl border text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 px-4 py-2">
              <dt className="shrink-0 text-muted-foreground">{k}</dt>
              <dd className={k === "Order ID" || k === "Invoice number" ? "min-w-0 truncate font-mono text-[13px] font-medium" : "min-w-0 truncate text-right font-medium"}>{v}</dd>
            </div>
          ))}
        </dl>

        <OrderDocumentButtons p={p} company={company} />
        <OrderHelp p={p} company={company} />

        <DialogFooter>
          <Link href="/settings/billing/history" onClick={() => setOpen(false)} className={buttonVariants({ variant: "outline" })}>Purchase history</Link>
          <Button onClick={close}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
