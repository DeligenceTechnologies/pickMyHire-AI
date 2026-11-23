"use client";

import { ArrowUpRight, Copy, Download, ExternalLink, FileText, LifeBuoy, Mail, Receipt } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { CopyButton } from "@/components/common/copy-button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { purchaseMoves } from "@/components/billing/purchase-moves";
import { formatDate } from "@/lib/format";
import { LEGAL } from "@/lib/legal";
import { localPaidNote, money } from "@/lib/pricing";
import { purchaseRef } from "@/lib/purchase-ref";
import type { PurchaseRow } from "@/lib/services/billing";
import { cn } from "@/lib/utils";

// One order's details, shared by the "Payment successful" dialog and the Purchase history panel, so both
// always show the same facts and the same document links.

export type Order = PurchaseRow & { buyer_email?: string | null };

/** The order's documents. They open through our server, which checks access and gets a fresh Stripe link. */
export const CUSTOMER_DOCS = "/api/billing/purchases";
/** Platform admin: any company's documents. */
export const ADMIN_DOCS = "/api/admin/purchases";

export function orderDocuments(p: Pick<Order, "id" | "invoice_url" | "invoice_pdf" | "receipt_url">, base = CUSTOMER_DOCS) {
  return [
    p.invoice_url && { key: "invoice", label: "View invoice", icon: FileText, href: `${base}/${p.id}/invoice` },
    p.invoice_pdf && { key: "pdf", label: "Download invoice (PDF)", icon: Download, href: `${base}/${p.id}/pdf` },
    p.receipt_url && { key: "receipt", label: "View receipt", icon: Receipt, href: `${base}/${p.id}/receipt` },
  ].filter((d): d is { key: string; label: string; icon: typeof FileText; href: string } => !!d);
}

/** The facts, grouped, as [label, value, tone?]. Empty groups are left out. */
export function orderFacts(p: Order) {
  const m = purchaseMoves(p);
  const paid = !!m.bought;
  const tone = { refund: "text-rose-700 dark:text-rose-300", expired: "text-amber-800 dark:text-amber-300" };
  const groups: { title: string; rows: [string, string, string?][] }[] = [
    {
      title: "Order",
      rows: [
        ["Order ID", purchaseRef(p.id)],
        ["Date", formatDate(p.paid_at ?? p.created_at, true)],
        ["Interviews", `${p.quantity} × ${money(p.unit_cents)} each`],
        [paid ? "Total paid" : "Total", `${money(p.total_cents)} USD`],
        ...(localPaidNote(p) ? [["Paid in your currency", localPaidNote(p)!]] as [string, string][] : []),
        ...(p.refunded_cents ? [["Refunded", `−${money(p.refunded_cents)}`, tone.refund], ["Net paid", money(p.total_cents - p.refunded_cents)]] as [string, string, string?][] : []),
      ],
    },
    {
      title: "Interviews",
      rows: paid ? [
        ["Added", `+${m.bought}`],
        ...(m.takenBack ? [["Taken back (refund)", `−${m.takenBack}`, tone.refund]] as [string, string, string?][] : []),
        ...(m.expired ? [["Expired unused", `−${m.expired}`, tone.expired]] as [string, string, string?][] : []),
        ...(m.takenBack || m.expired ? [["Still counting", String(m.kept)]] as [string, string][] : []),
        ...(p.expires_at && p.status !== "refunded" ? [[p.expired_at ? "Expired on" : "Valid until", formatDate(p.expired_at ?? p.expires_at)]] as [string, string][] : []),
      ] : [],
    },
    {
      title: "Payment",
      rows: [
        ...(p.payment_method ? [["Paid with", p.payment_method]] as [string, string][] : []),
        ...(p.invoice_number ? [["Invoice number", p.invoice_number]] as [string, string][] : []),
        ...(p.bought_by ? [[paid ? "Bought by" : "Started by", p.bought_by]] as [string, string][] : []),
        ...(paid && p.buyer_email ? [["Receipt sent to", p.buyer_email]] as [string, string][] : []),
      ],
    },
  ];
  return groups.filter((g) => g.rows.length);
}

/** Plain text of the order, for "Copy details" and the support email. */
export function orderText(p: Order, company: string) {
  return [`PickMyHire.ai order — ${company}`, ...orderFacts(p).flatMap((g) => g.rows.map(([k, v]) => `${k}: ${v}`))].join("\n");
}

/** The grouped facts as definition lists. */
export function OrderFactList({ p, className }: { p: Order; className?: string }) {
  return (
    <div className={cn("space-y-5", className)}>
      {orderFacts(p).map((g) => (
        <section key={g.title}>
          <h3 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{g.title}</h3>
          <dl className="divide-y rounded-xl border text-sm">
            {g.rows.map(([k, v, tone]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 px-3.5 py-2">
                <dt className="shrink-0 text-muted-foreground">{k}</dt>
                <dd className={cn("min-w-0 truncate text-right font-medium", (k === "Order ID" || k === "Invoice number") && "font-mono text-[13px]", tone)} title={v}>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** The order's documents as a list of full-width rows (invoice, PDF, receipt), plus Copy details. */
export function OrderDocumentButtons({ p, company, docBase }: { p: Order; company: string; docBase?: string }) {
  const docs = orderDocuments(p, docBase);
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Documents</h3>
        <CopyButton value={orderText(p, company)} label="Copy details" />
      </div>
      {docs.length > 0 ? (
        <ul className="divide-y rounded-xl border text-sm">
          {docs.map((d) => (
            <li key={d.key}>
              <a href={d.href} target="_blank" rel="noopener noreferrer"
                className="group flex items-center gap-3 px-3.5 py-2.5 font-medium outline-none hover:bg-muted/50 focus-visible:bg-muted/50 first:rounded-t-xl last:rounded-b-xl">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><d.icon className="size-4" aria-hidden /></span>
                <span className="flex-1">{d.label}</span>
                <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-foreground" aria-hidden />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      ) : <p className="rounded-xl border px-3.5 py-2.5 text-sm text-muted-foreground">No documents for this order.</p>}
    </section>
  );
}

/** "Questions about this order?" with the support email (order details filled in) and the help page. */
export function OrderHelp({ p, company, className }: { p: Order; company: string; className?: string }) {
  const ref = purchaseRef(p.id);
  const subject = encodeURIComponent(`Question about order ${ref}`);
  const body = encodeURIComponent(`Hi,\n\nI have a question about this order:\n\n${orderText(p, company)}\n\n`);
  return (
    <div className={cn("flex gap-3 rounded-xl bg-muted/50 px-4 py-3 text-sm", className)}>
      <LifeBuoy className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="text-muted-foreground">
        Questions about this order? Email{" "}
        <a href={`mailto:${LEGAL.supportEmail}?subject=${subject}&body=${body}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
          <Mail className="size-3.5" aria-hidden />{LEGAL.supportEmail}
        </a>{" "}
        or <Link href="/help" className="font-medium text-primary hover:underline">contact support</Link>, and quote order ID{" "}
        <span className="font-mono font-medium whitespace-nowrap text-foreground">{ref}</span>.
      </p>
    </div>
  );
}

/** The ⋮ menu items for an order: details, its documents, and copying the order ID. */
export function OrderMenuItems({ p, onDetails, docBase }: { p: Order; onDetails: () => void; docBase?: string }) {
  const docs = orderDocuments(p, docBase);
  return (
    <>
      <DropdownMenuItem onClick={onDetails}><ExternalLink /> View details</DropdownMenuItem>
      {docs.length > 0 && <DropdownMenuSeparator />}
      {docs.map((d) => (
        <DropdownMenuItem key={d.key} onClick={() => window.open(d.href, "_blank", "noopener,noreferrer")}><d.icon /> {d.label}</DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(purchaseRef(p.id)).then(() => toast.success(`Copied ${purchaseRef(p.id)}`), () => toast.error("Couldn't copy. Select the order ID instead.")); }}><Copy /> Copy order ID</DropdownMenuItem>
    </>
  );
}
