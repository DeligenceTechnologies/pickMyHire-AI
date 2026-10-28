import { cn } from "@/lib/utils";
import type { CouponStatus } from "@/lib/services/coupons";

const LABEL: Record<CouponStatus, string> = { active: "Active", off: "Off", expired: "Expired", used_up: "All used" };

export function CouponStatusBadge({ status }: { status: CouponStatus }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
      status === "active" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
      {LABEL[status]}
    </span>
  );
}
