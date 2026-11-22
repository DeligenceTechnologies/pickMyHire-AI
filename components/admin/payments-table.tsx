"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Building2, MoreVertical } from "lucide-react";
import { ADMIN_DOCS, OrderDocumentButtons, OrderFactList, OrderMenuItems } from "@/components/billing/order-details";
import { PurchaseBadge } from "@/components/billing/purchase-moves";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDate } from "@/lib/format";
import { money } from "@/lib/pricing";
import type { AdminPayment } from "@/lib/services/billing";

/**
 * Admin → Payments: every payment, click one for its details (documents, order, interviews, payment,
 * company and Stripe). The open payment is in the address (?order=PMH-…). Searching for one order ID
 * opens it straight away.
 */
export function PaymentsTable({ rows, stripePayments, autoOpen }: { rows: AdminPayment[]; stripePayments: string; autoOpen: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openRef = params.get("order")?.toUpperCase() ?? null;
  const open = openRef ? rows.find((p) => p.reference === openRef) ?? null : null;
  const href = (ref: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (ref) q.set("order", ref); else q.delete("order");
    return q.size ? `${pathname}?${q}` : pathname;
  };
  const show = (p: AdminPayment) => router.push(href(p.reference), { scroll: false });
  const hide = () => router.replace(href(null), { scroll: false });

  // A search that finds exactly one order (by its ID) opens it, once per search.
  const opened = useRef<string | null>(null);
  const q = params.get("q") ?? "";
  useEffect(() => {
    if (autoOpen && rows.length === 1 && !openRef && opened.current !== q) {
      opened.current = q;
      router.replace(href(rows[0].reference), { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, rows, q]);

  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Order ID</th>
              <th className="px-4 py-2.5 font-medium">Company</th>
              <th className="px-4 py-2.5 text-right font-medium">Amount</th>
              <th className="px-4 py-2.5 font-medium">Bought by</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="w-12 px-2 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((p) => (
              <tr key={p.id} onClick={() => show(p)} className={`group cursor-pointer align-top hover:bg-muted/40 ${open?.id === p.id ? "bg-muted/50" : ""}`}>
                <td className="px-4 py-3">
                  <button type="button" onClick={(e) => { e.stopPropagation(); show(p); }} aria-label={`Payment ${p.reference}: view details`}
                    className="rounded font-mono text-[13px] font-semibold whitespace-nowrap outline-none group-hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                    {p.reference}
                  </button>
                  <p className="text-xs whitespace-nowrap text-muted-foreground">{formatDate(p.paid_at ?? p.created_at, true)}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium">{p.company}</p>
                  {!p.organization_id
                    ? <p className="text-xs font-medium text-rose-700 dark:text-rose-300">Company deleted</p>
                    : p.invoice_number && <p className="font-mono text-xs whitespace-nowrap text-muted-foreground">Invoice {p.invoice_number}</p>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <p className="font-semibold tabular">{money(p.total_cents)}</p>
                  {p.refunded_cents > 0
                    ? <p className="text-xs text-rose-700 dark:text-rose-300">−{money(p.refunded_cents)} refunded</p>
                    : <p className="text-xs text-muted-foreground">{p.quantity} × {money(p.unit_cents)}</p>}
                </td>
                <td className="px-4 py-3">
                  <p>{p.bought_by ?? "—"}</p>
                  {p.buyer_email && <p className="text-xs text-muted-foreground">{p.buyer_email}</p>}
                </td>
                <td className="px-4 py-3"><PurchaseBadge p={p} /></td>
                <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={`Actions for ${p.reference}`} />}>
                      <MoreVertical />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-56">
                      <OrderMenuItems p={p} onDetails={() => show(p)} docBase={ADMIN_DOCS} />
                      {(p.stripe_payment_intent || p.organization_id) && <DropdownMenuSeparator />}
                      {p.stripe_payment_intent && (
                        <DropdownMenuItem onClick={() => window.open(`${stripePayments}${p.stripe_payment_intent}`, "_blank", "noopener,noreferrer")}><ArrowUpRight /> Open in Stripe</DropdownMenuItem>
                      )}
                      {p.organization_id && <DropdownMenuItem onClick={() => router.push(`/admin/companies/${p.organization_id}`)}><Building2 /> Open company</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={!!open} onOpenChange={(o) => { if (!o) hide(); }}>
        <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          {open && (
            <>
              <SheetHeader className="border-b px-5 pt-5 pb-4">
                <SheetDescription>Payment</SheetDescription>
                <SheetTitle className="font-mono text-lg">{open.reference}</SheetTitle>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-2xl font-semibold tracking-tight tabular">{money(open.total_cents)}</span>
                  <PurchaseBadge p={open} />
                </div>
                <p className="text-xs text-muted-foreground">{open.quantity} interviews · {formatDate(open.paid_at ?? open.created_at, true)}</p>
              </SheetHeader>
              <div className="space-y-5 px-5 py-5">
                <section>
                  <h3 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Company</h3>
                  <div className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{open.company}</span>
                      {!open.organization_id && <span className="text-xs font-medium text-rose-700 dark:text-rose-300">Company deleted, record kept</span>}
                    </span>
                    {open.organization_id && <Link href={`/admin/companies/${open.organization_id}`} className="shrink-0 text-xs font-medium text-primary hover:underline">Open company</Link>}
                  </div>
                </section>
                <OrderDocumentButtons p={open} company={open.company} docBase={ADMIN_DOCS} />
                <OrderFactList p={open} />
                {open.stripe_payment_intent && (
                  <a href={`${stripePayments}${open.stripe_payment_intent}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm font-medium hover:bg-muted/50">
                    Open this payment in Stripe (refunds are made there)<ArrowUpRight className="size-4 text-muted-foreground" aria-hidden />
                  </a>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
