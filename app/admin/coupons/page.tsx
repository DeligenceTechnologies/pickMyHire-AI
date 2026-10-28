import Link from "next/link";
import { Ticket } from "lucide-react";
import { NewCouponButton } from "@/components/admin/coupon-form";
import { CouponStatusBadge } from "@/components/admin/coupon-badge";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { describeReward, formatExpiry } from "@/lib/coupons";
import { formatDate } from "@/lib/format";
import { couponStatus, listCoupons } from "@/lib/services/coupons";

export const metadata = { title: "Coupons" };

export default async function CouponsPage() {
  const coupons = await listCoupons();
  return (
    <>
      <PageHeader title="Coupons" description="Promo codes for campaigns. A company applies one to get free interviews or extra trial days; each company can use a code once." actions={<NewCouponButton />} />
      {coupons.length === 0 ? <EmptyState icon={Ticket} title="No coupons yet" description="Create a code for your next campaign and share it with companies." /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2.5 font-medium">Code</th><th className="px-4 py-2.5 font-medium">Gives</th><th className="px-4 py-2.5 font-medium">Companies used</th><th className="px-4 py-2.5 font-medium">Valid until</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 text-right font-medium">Created</th></tr>
            </thead>
            <tbody className="divide-y">
              {coupons.map((c) => (
                <tr key={c.id} className="group relative hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link href={`/admin/coupons/${c.id}`} className="font-mono font-medium after:absolute after:inset-0 group-hover:text-primary">{c.code}</Link>
                    {c.note && <p className="max-w-xs truncate text-xs text-muted-foreground">{c.note}</p>}
                  </td>
                  <td className="px-4 py-3">{describeReward(c.interviews, c.trial_days)}</td>
                  <td className="px-4 py-3 tabular">{c.uses}{c.max_uses != null ? ` / ${c.max_uses}` : ""}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.expires_at ? formatExpiry(c.expires_at) : "No end date"}</td>
                  <td className="px-4 py-3"><CouponStatusBadge status={couponStatus(c)} /></td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
