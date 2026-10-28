import Link from "next/link";
import { notFound } from "next/navigation";
import { Ticket } from "lucide-react";
import { DeleteCouponButton, EditCouponButton } from "@/components/admin/coupon-form";
import { CouponStatusBadge } from "@/components/admin/coupon-badge";
import { CopyButton } from "@/components/common/copy-button";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { describeReward, formatExpiry } from "@/lib/coupons";
import { formatDate } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { couponStatus, getCoupon } from "@/lib/services/coupons";

export const metadata = { title: "Coupon" };

export default async function CouponPage(props: PageProps<"/admin/coupons/[id]">) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();
  const data = await getCoupon(id);
  if (!data) notFound();
  const { coupon: c, redemptions } = data;
  const used = c.uses > 0;
  const initial = {
    code: c.code, interviews: String(c.interviews), trialDays: String(c.trial_days), maxUses: c.max_uses == null ? "" : String(c.max_uses),
    expiresAt: c.expires_at ? c.expires_at.toISOString().slice(0, 10) : "", active: c.active, note: c.note ?? "",
  };
  const totals = redemptions.reduce((a, r) => ({ interviews: a.interviews + r.interviews_added, days: a.days + r.trial_days_added }), { interviews: 0, days: 0 });
  return (
    <>
      <PageHeader
        back={{ href: "/admin/coupons", label: "Coupons" }}
        title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono">{c.code}</span><CopyButton value={c.code} /><CouponStatusBadge status={couponStatus(c)} /></span>}
        meta={<><span>Created {formatDate(c.created_at)}</span>{c.note && <span>{c.note}</span>}</>}
        actions={<div className="flex flex-wrap gap-2"><EditCouponButton id={c.id} initial={initial} used={used} />{!used && <DeleteCouponButton id={c.id} />}</div>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Gives", describeReward(c.interviews, c.trial_days)],
          ["Used by", `${c.uses}${c.max_uses != null ? ` of ${c.max_uses}` : ""} compan${c.uses === 1 && c.max_uses == null ? "y" : "ies"}`],
          ["Valid until", c.expires_at ? formatExpiry(c.expires_at) : "No end date"],
          ["Given so far", describeReward(totals.interviews, totals.days) || "Nothing yet"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 font-semibold">{v}</p></div>
        ))}
      </div>
      <section className="rounded-xl border bg-card">
        <div className="border-b px-5 py-4">
          <h2 className="font-semibold">Companies that used this code</h2>
          <p className="text-xs text-muted-foreground">Newest first. What each company received depends on its plan when it applied the code.</p>
        </div>
        {redemptions.length === 0 ? <div className="p-5"><EmptyState icon={Ticket} title="Not used yet" description="Share the code with companies; they apply it from Settings → Usage or their dashboard." /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr><th className="px-4 py-2.5 font-medium">Company</th><th className="px-4 py-2.5 font-medium">Applied by</th><th className="px-4 py-2.5 font-medium">Received</th><th className="px-4 py-2.5 text-right font-medium">When</th></tr>
              </thead>
              <tbody className="divide-y">
                {redemptions.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3">{r.organization_id ? <Link href={`/admin/companies/${r.organization_id}`} className="font-medium hover:text-primary">{r.company_name}</Link> : <span className="text-muted-foreground">{r.company_name} (deleted)</span>}</td>
                    <td className="px-4 py-3">{r.user_email ? <><p>{r.user_name}</p><p className="text-xs text-muted-foreground">{r.user_email}</p></> : <span className="text-muted-foreground">Deleted user</span>}</td>
                    <td className="px-4 py-3">{describeReward(r.interviews_added, r.trial_days_added)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{formatDate(r.created_at, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
