import Link from "next/link";
import { ArrowUpRight, CreditCard } from "lucide-react";
import { FilterTabs } from "@/components/admin/filter-tabs";
import { PurchaseBadge } from "@/components/billing/purchase-moves";
import { PageHeader } from "@/components/common/page-header";
import { SearchBar } from "@/components/common/search-bar";
import { EmptyState } from "@/components/common/states";
import { formatDate } from "@/lib/format";
import { money } from "@/lib/pricing";
import { listAdminPayments, type AdminPaymentFilter } from "@/lib/services/billing";
import { paymentsTestMode } from "@/lib/stripe";

export const metadata = { title: "Payments" };

const TABS: { value: AdminPaymentFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "paid", label: "Paid" }, { value: "refunded", label: "Refunded" }, { value: "deleted", label: "Deleted companies" },
];

export default async function PaymentsPage(props: PageProps<"/admin/payments">) {
  const sp = await props.searchParams;
  const filter = TABS.find((t) => t.value === sp.filter)?.value ?? "all";
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, hasMore, totals } = await listAdminPayments({ q, filter, page });
  const stripe = `https://dashboard.stripe.com/${paymentsTestMode() ? "test/" : ""}payments/`;
  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    if (filter !== "all") p.set("filter", filter);
    if (q) p.set("q", q);
    if (n > 1) p.set("page", String(n));
    return p.size ? `/admin/payments?${p}` : "/admin/payments";
  };
  return (
    <>
      <PageHeader title="Payments" description="Every online payment by every company, including companies that were deleted. Refund in Stripe: unused interviews are taken back automatically." />

      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ["Payments", String(totals.count)],
          ["Paid", money(totals.paid)],
          ["Refunded", money(totals.refunded)],
          ["Net", money(totals.net)],
        ] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{k}{q || filter !== "all" ? " (this filter)" : ""}</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular">{v}</dd>
          </div>
        ))}
      </dl>

      <FilterTabs base="/admin/payments" param="filter" current={filter} tabs={TABS} />
      <div className="mb-4"><SearchBar placeholder="Search reference (PMH-…), invoice number, company or buyer…" /></div>

      {rows.length === 0 ? <EmptyState icon={CreditCard} title={q || filter !== "all" ? "No payments match" : "No payments yet"} /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-4 py-2.5 font-medium">Reference</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                <th className="px-4 py-2.5 font-medium">Bought by</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium"><span className="sr-only">Stripe</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => (
                <tr key={p.id} className="align-top hover:bg-muted/30">
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(p.paid_at ?? p.created_at, true)}</td>
                  <td className="px-4 py-3">
                    {p.organization_id
                      ? <Link href={`/admin/companies/${p.organization_id}`} className="font-medium hover:text-primary">{p.company}</Link>
                      : <span className="font-medium">{p.company}</span>}
                    {!p.organization_id && <p className="text-xs font-medium text-rose-700 dark:text-rose-300">Company deleted</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-mono text-[13px] font-medium whitespace-nowrap">{p.reference}</p>
                    {p.invoice_number && <p className="font-mono text-xs whitespace-nowrap text-muted-foreground">Invoice {p.invoice_number}</p>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <p className="font-medium tabular">{money(p.total_cents)}</p>
                    <p className="text-xs text-muted-foreground">{p.quantity} × {money(p.unit_cents)}</p>
                    {p.refunded_cents > 0 && <p className="text-xs text-rose-700 dark:text-rose-300">−{money(p.refunded_cents)} refunded</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p>{p.bought_by ?? "—"}</p>
                    {p.buyer_email && <p className="text-xs text-muted-foreground">{p.buyer_email}</p>}
                    {p.payment_method && <p className="text-xs text-muted-foreground">{p.payment_method}</p>}
                  </td>
                  <td className="px-4 py-3"><PurchaseBadge p={p} /></td>
                  <td className="px-4 py-3 text-right">
                    {p.stripe_payment_intent && (
                      <a href={`${stripe}${p.stripe_payment_intent}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-primary hover:underline">
                        Open in Stripe<ArrowUpRight className="size-3" aria-hidden /><span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex justify-between text-sm">
        {page > 1 ? <Link href={pageHref(page - 1)} className="text-primary hover:underline">Newer</Link> : <span />}
        {hasMore && <Link href={pageHref(page + 1)} className="text-primary hover:underline">Older</Link>}
      </div>
    </>
  );
}
