import { BillingTabs, purchaseMoves } from "@/components/billing/purchase-moves";
import { HISTORY_FILTERS, PurchaseHistory } from "@/components/billing/purchase-history";
import { requireAuth } from "@/lib/auth/session";
import { listPurchases, VALID_MONTHS } from "@/lib/services/billing";
import { getQuotaStatus } from "@/lib/services/quota";

export const metadata = { title: "Purchase history" };

export default async function PurchaseHistoryPage(props: PageProps<"/settings/billing/history">) {
  const auth = await requireAuth("billing:manage");
  const { show } = await props.searchParams;
  const filter = HISTORY_FILTERS.find((f) => f.key === show)?.key ?? "all";
  const [quota, rows] = await Promise.all([getQuotaStatus(auth.orgId), listPurchases(auth.orgId, { all: true })]);
  return (
    <>
      <BillingTabs active="history" count={rows.filter((p) => purchaseMoves(p).bought).length || undefined} />
      <PurchaseHistory balance={quota} rows={rows} filter={filter} validMonths={VALID_MONTHS} company={auth.orgName} />
    </>
  );
}
