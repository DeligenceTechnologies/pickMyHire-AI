"use client";

import { ChevronRight, MoreVertical } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { OrderDocumentButtons, OrderFactList, OrderHelp, OrderMenuItems, type Order } from "@/components/billing/order-details";
import { PurchaseBadge, purchaseMoves } from "@/components/billing/purchase-moves";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDate } from "@/lib/format";
import { localPaidNote, money } from "@/lib/pricing";
import { purchaseRef } from "@/lib/purchase-ref";
import { cn } from "@/lib/utils";
import { LocalTime } from "@/components/common/local-time";

/**
 * Purchase history as a list of orders: order ID, date, interviews, amount, status, and a ⋮ menu with the
 * documents. Clicking an order opens its details on the right. The open order is in the address
 * (?order=PMH-…), so Back closes it and a link to one order can be shared.
 */
export function OrderList({ rows, company }: { rows: Order[]; company: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openRef = params.get("order")?.toUpperCase() ?? null;
  const open = openRef ? rows.find((p) => purchaseRef(p.id) === openRef) ?? null : null;
  const href = (ref: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (ref) q.set("order", ref); else q.delete("order");
    return q.size ? `${pathname}?${q}` : pathname;
  };
  const show = (p: Order) => router.push(href(purchaseRef(p.id)), { scroll: false });
  const hide = () => router.replace(href(null), { scroll: false });

  return (
    <>
      <ul className="divide-y border-t" aria-label="Orders">
        {rows.map((p) => {
          const m = purchaseMoves(p);
          const ref = purchaseRef(p.id);
          return (
            <li key={p.id} className={cn("group relative flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40", open?.id === p.id && "bg-muted/50")}>
              {/* The whole row opens the details; the ⋮ menu sits above that click area. */}
              <button type="button" onClick={() => show(p)} aria-label={`Order ${ref}, ${formatDate(p.paid_at ?? p.created_at)}: view details`}
                className="absolute inset-0 rounded-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" />
              <div className="pointer-events-none grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto]">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[13px] font-semibold group-hover:text-primary">{ref}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(p.paid_at ?? p.created_at)}</p>
                </div>
                <div className="hidden min-w-0 text-sm sm:block">
                  <p className="font-medium tabular">{m.bought ? (m.takenBack || m.expired ? `${m.kept} of ${m.bought}` : `+${m.bought}`) : p.quantity} interviews</p>
                  <p className="text-xs text-muted-foreground">{money(p.unit_cents)} each</p>
                </div>
                <div className="text-right text-sm sm:text-left">
                  <p className="font-semibold tabular">{money(p.total_cents)}</p>
                  {p.refunded_cents > 0
                    ? <p className="text-xs text-rose-700 dark:text-rose-300">−{money(p.refunded_cents)} refunded</p>
                    : localPaidNote(p) ? <p className="text-xs text-muted-foreground" title="What you paid in your own currency">{localPaidNote(p)}</p>
                    : <p className="text-xs text-muted-foreground sm:hidden">{p.quantity} interviews</p>}
                </div>
                <div className="col-span-2 sm:col-span-1"><PurchaseBadge p={p} /></div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="relative z-10 size-8 shrink-0 text-muted-foreground" aria-label={`Actions for order ${ref}`} />}>
                  <MoreVertical />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <OrderMenuItems p={p} onDetails={() => show(p)} />
                </DropdownMenuContent>
              </DropdownMenu>
              <ChevronRight className="pointer-events-none hidden size-4 shrink-0 text-muted-foreground/60 sm:block" aria-hidden />
            </li>
          );
        })}
      </ul>

      <Sheet open={!!open} onOpenChange={(o) => { if (!o) hide(); }}>
        <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          {open && (
            <>
              <SheetHeader className="border-b px-5 pt-5 pb-4">
                <SheetDescription>Order</SheetDescription>
                <SheetTitle className="font-mono text-lg">{purchaseRef(open.id)}</SheetTitle>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-2xl font-semibold tracking-tight tabular">{money(open.total_cents)}</span>
                  <PurchaseBadge p={open} />
                </div>
                <p className="text-xs text-muted-foreground">{open.quantity} interviews · <LocalTime date={open.paid_at ?? open.created_at} /></p>
              </SheetHeader>
              <div className="space-y-5 px-5 py-5">
                {purchaseMoves(open).bought
                  ? <OrderDocumentButtons p={open} company={company} />
                  : <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">This checkout wasn&apos;t completed, so nothing was charged and there&apos;s no receipt or invoice.</p>}
                <OrderFactList p={open} />
                <OrderHelp p={open} company={company} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
