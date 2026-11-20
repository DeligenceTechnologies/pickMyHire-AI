import Link from "next/link";
import { ArrowUpRight, History, ShoppingCart } from "lucide-react";
import { EmptyState } from "@/components/common/states";
import { PurchaseBadge, purchaseKind, purchaseMoves, type PurchaseKind } from "@/components/billing/purchase-moves";
import { formatDate } from "@/lib/format";
import { purchaseRef } from "@/lib/purchase-ref";
import { money } from "@/lib/pricing";
import type { PurchaseRow } from "@/lib/services/billing";
import { cn } from "@/lib/utils";

export type HistoryFilter = "all" | Exclude<PurchaseKind, "open">;
export const HISTORY_FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "refunded", label: "Refunded" },
  { key: "expired", label: "Expired" },
  { key: "incomplete", label: "Not completed" },
];

type Balance = { quota: number | null; used: number; inProgress: number; remaining: number | null };

/** Purchase history: the balance explained, then every purchase in a simple table. */
export function PurchaseHistory({ balance, rows, filter, validMonths, basePath = "/settings/billing/history" }: {
  balance: Balance; rows: PurchaseRow[]; filter: HistoryFilter; validMonths: number; basePath?: string;
}) {
  const kinds = rows.map((p) => purchaseKind(p));
  const matches = (k: PurchaseKind, f: HistoryFilter) => f === "all" || k === f || (f === "incomplete" && k === "open");
  const shown = rows.filter((_, i) => matches(kinds[i], filter));

  const t = rows.reduce((a, p) => {
    const m = purchaseMoves(p);
    if (!m.bought) return a;
    return { bought: a.bought + m.bought, takenBack: a.takenBack + m.takenBack, expired: a.expired + m.expired, kept: a.kept + m.kept, spent: a.spent + p.total_cents - p.refunded_cents, refunded: a.refunded + p.refunded_cents };
  }, { bought: 0, takenBack: 0, expired: 0, kept: 0, spent: 0, refunded: 0 });

  return (
    <div className="space-y-6">
      <BalanceCard balance={balance} t={t} />

      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div>
            <h2 className="font-semibold">Purchases</h2>
            <p className="text-xs text-muted-foreground">{t.spent ? `${money(t.spent)} spent${t.refunded ? ` · ${money(t.refunded)} refunded` : ""}` : "Payments, refunds, receipts and invoices."}</p>
          </div>
          <nav aria-label="Filter purchases" className="flex flex-wrap rounded-lg bg-muted p-0.5 text-xs font-medium">
            {HISTORY_FILTERS.map((f) => {
              const n = kinds.filter((k) => matches(k, f.key)).length;
              const on = f.key === filter;
              if (!n && !on && f.key !== "all") return null;
              return (
                <Link key={f.key} href={f.key === "all" ? basePath : `${basePath}?show=${f.key}`} scroll={false} aria-current={on ? "page" : undefined}
                  className={cn("rounded-md px-2.5 py-1 transition-colors", on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {f.label} <span className="tabular opacity-60">{n}</span>
                </Link>
              );
            })}
          </nav>
        </header>

        {shown.length ? (
          <>
            {/* Wide screens: table (scrolls inside its box if it ever gets too tight). */}
            <div className="hidden overflow-x-auto xl:block">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-3 pl-5 font-medium">Date</th>
                  <th scope="col" className="px-3 py-2 font-medium">Purchase</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Interviews</th>
                  <th scope="col" className="px-3 py-2 font-medium">Valid until</th>
                  <th scope="col" className="py-2 pr-5 pl-3 text-right font-medium"><span className="sr-only">Receipt and invoice</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((p) => (
                  <tr key={p.id} className="align-top hover:bg-muted/30">
                    <td className="py-3 pr-3 pl-5 whitespace-nowrap text-muted-foreground">{formatDate(p.paid_at ?? p.created_at)}</td>
                    <td className="px-3 py-3"><PurchaseCell p={p} /></td>
                    <td className="px-3 py-3"><PurchaseBadge p={p} /></td>
                    <td className="px-3 py-3 text-right"><InterviewsCell p={p} /></td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{validUntil(p)}</td>
                    <td className="py-3 pr-5 pl-3 text-right"><ReceiptLink p={p} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {/* Phones and narrower screens: one card per purchase. */}
            <ul className="divide-y border-t xl:hidden">
              {shown.map((p) => (
                <li key={p.id} className="space-y-2 px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <PurchaseCell p={p} />
                    <PurchaseBadge p={p} />
                  </div>
                  <div className="flex items-end justify-between gap-3 text-xs text-muted-foreground">
                    <span>{formatDate(p.paid_at ?? p.created_at)}{validUntil(p) !== "—" ? ` · valid until ${validUntil(p)}` : ""}</span>
                    <InterviewsCell p={p} />
                  </div>
                  <ReceiptLink p={p} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            icon={rows.length ? History : ShoppingCart}
            title={rows.length ? "Nothing here" : "No purchases yet"}
            description={rows.length ? "No purchases match this filter." : "Your payments, refunds, receipts and invoices will show here."}
            action={rows.length ? undefined : <Link href="/settings/billing" className="text-sm font-medium text-primary hover:underline">Buy interviews</Link>}
            className="border-0 border-t py-10"
          />
        )}
        <p className="border-t bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">
          Not completed: the checkout was cancelled or not finished, nothing was charged. A refund takes back the interviews no longer paid for. Unused interviews expire {validMonths} months after purchase.
        </p>
      </section>
    </div>
  );
}

function BalanceCard({ balance, t }: { balance: Balance; t: { bought: number; takenBack: number; expired: number } }) {
  const unlimited = balance.quota === null;
  const total = balance.quota ?? 0;
  const free = unlimited ? 0 : Math.max(0, total - (t.bought - t.takenBack - t.expired));
  const usedPct = !unlimited && total > 0 ? Math.min(100, Math.round((balance.used / total) * 100)) : 0;
  const ledger: [string, string, string?][] = [
    ...(free > 0 ? [["Free trial & included", `${free}`] as [string, string]] : []),
    ["Bought", `+${t.bought}`],
    ...(t.takenBack ? [["Refunded", `−${t.takenBack}`, "text-rose-700 dark:text-rose-300"] as [string, string, string]] : []),
    ...(t.expired ? [["Expired unused", `−${t.expired}`, "text-amber-800 dark:text-amber-300"] as [string, string, string]] : []),
  ];
  return (
    <section aria-label="Your interviews" className="grid gap-6 rounded-xl border bg-card p-5 md:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex flex-col justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Available now</p>
          <p className={cn("text-4xl font-semibold tracking-tight tabular", !unlimited && balance.remaining === 0 && "text-destructive")}>
            {unlimited ? "Unlimited" : balance.remaining}
            {!unlimited && <span className="ml-1.5 text-base font-normal text-muted-foreground">of {total}</span>}
          </p>
        </div>
        {!unlimited && (
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${balance.used} of ${total} used`}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${usedPct}%` }} />
            </div>
            <p className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
              <span><b className="font-semibold text-foreground tabular">{balance.used}</b> used</span>
              <span><b className="font-semibold text-foreground tabular">{balance.inProgress}</b> waiting or running</span>
            </p>
          </div>
        )}
        <Link href="/settings/billing" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline">Buy more interviews<ArrowUpRight className="size-3.5" aria-hidden /></Link>
      </div>
      {!unlimited && (
        <dl className="space-y-1.5 border-t pt-4 text-sm tabular md:border-t-0 md:border-l md:pt-0 md:pl-6">
          {ledger.map(([k, v, tone]) => (
            <div key={k} className="flex justify-between gap-4"><dt className="text-muted-foreground">{k}</dt><dd className={cn("font-medium", tone)}>{v}</dd></div>
          ))}
          <div className="flex justify-between gap-4 border-t pt-1.5"><dt className="text-muted-foreground">Total</dt><dd className="font-medium">{total}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Used</dt><dd className="font-medium">−{balance.used}</dd></div>
          <div className="flex justify-between gap-4 border-t pt-1.5 font-semibold"><dt>Available</dt><dd className="text-primary">{balance.remaining}</dd></div>
        </dl>
      )}
    </section>
  );
}

function PurchaseCell({ p }: { p: PurchaseRow }) {
  return (
    <div className="min-w-0">
      <p className="font-medium">{p.quantity} interviews · {money(p.total_cents)}</p>
      <p className="text-xs text-muted-foreground">
        {money(p.unit_cents)} each{p.bought_by ? ` · ${p.bought_by}` : ""}
        {p.refunded_cents ? <span className="text-rose-700 dark:text-rose-300"> · {money(p.refunded_cents)} refunded</span> : null}
      </p>
      {/* What to quote when contacting us about this payment. */}
      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
        <span title="Purchase reference">{purchaseRef(p.id)}</span>{p.invoice_number ? <> · <span title="Invoice number">Invoice {p.invoice_number}</span></> : null}{p.payment_method ? <span className="font-sans"> · {p.payment_method}</span> : null}
      </p>
    </div>
  );
}

function InterviewsCell({ p }: { p: PurchaseRow }) {
  const m = purchaseMoves(p);
  if (!m.bought) return <span className="text-muted-foreground">—</span>;
  const changed = m.takenBack > 0 || m.expired > 0;
  return (
    <div className="tabular">
      <p className="font-semibold">{changed ? `${m.kept} of ${m.bought}` : `+${m.bought}`}</p>
      {changed && (
        <p className="text-xs text-muted-foreground">
          {m.takenBack > 0 && <span className="text-rose-700 dark:text-rose-300">−{m.takenBack} refunded</span>}
          {m.takenBack > 0 && m.expired > 0 && " · "}
          {m.expired > 0 && <span className="text-amber-800 dark:text-amber-300">−{m.expired} expired</span>}
        </p>
      )}
    </div>
  );
}

function validUntil(p: PurchaseRow) {
  return purchaseMoves(p).bought && p.expires_at && p.status !== "refunded" ? formatDate(p.expires_at) : "—";
}

function ReceiptLink({ p }: { p: PurchaseRow }) {
  const links = [
    // Through our server: it checks access and gets a fresh link from Stripe (Stripe's own links expire).
    p.receipt_url && { href: `/api/billing/purchases/${p.id}/receipt`, label: "Receipt", hint: "Stripe's receipt for this payment" },
    p.invoice_url && { href: `/api/billing/purchases/${p.id}/invoice`, label: "Invoice", hint: "The paid invoice, with your company details" },
    p.invoice_pdf && { href: `/api/billing/purchases/${p.id}/pdf`, label: "PDF", hint: "Download the invoice as a PDF" },
  ].filter((l): l is { href: string; label: string; hint: string } => !!l);
  if (!links.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {links.map((l) => (
        <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" aria-label={`${l.hint} (opens in a new tab)`}
          className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-primary hover:underline">
          {l.label}<ArrowUpRight className="size-3" aria-hidden />
        </a>
      ))}
    </span>
  );
}
