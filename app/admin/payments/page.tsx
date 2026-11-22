import Link from "next/link";
import { CreditCard } from "lucide-react";
import { PaymentsTable } from "@/components/admin/payments-table";
import { FilterTabs } from "@/components/admin/filter-tabs";
import { PageHeader } from "@/components/common/page-header";
import { SearchBar } from "@/components/common/search-bar";
import { EmptyState } from "@/components/common/states";
import { money } from "@/lib/pricing";
import { listAdminPayments, orderIdSearch, type AdminPaymentFilter } from "@/lib/services/billing";
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
      <PageHeader title="Payments" description="Every online payment by every company, including deleted companies. Click a payment for its details. Refund in Stripe: unused interviews are taken back automatically." />

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
      <div className="mb-4"><SearchBar placeholder="Search order ID (PMH-…), invoice number, company or buyer…" /></div>

      {rows.length === 0
        ? <EmptyState icon={CreditCard} title={q || filter !== "all" ? "No payments match" : "No payments yet"} description={q ? "Try the order ID (PMH-…), the invoice number, the company or the buyer's email." : undefined} />
        : <PaymentsTable rows={rows} stripePayments={stripe} autoOpen={!!(q && orderIdSearch(q))} />}
      <div className="mt-4 flex justify-between text-sm">
        {page > 1 ? <Link href={pageHref(page - 1)} className="text-primary hover:underline">Newer</Link> : <span />}
        {hasMore && <Link href={pageHref(page + 1)} className="text-primary hover:underline">Older</Link>}
      </div>
    </>
  );
}
