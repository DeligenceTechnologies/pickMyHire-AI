import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";
import { LOW_BALANCE } from "@/lib/pricing";
import type { QuotaStatus } from "@/lib/services/quota";
import { cn } from "@/lib/utils";

/**
 * Shown across the app (paying companies; trials have their own banner) when interviews are running
 * low or have run out, and when candidates are waiting because of it.
 */
export function BalanceBanner({ quota, canBuy }: { quota: QuotaStatus; canBuy: boolean }) {
  if (quota.plan === "trial" || quota.remaining === null) return null;
  const left = quota.remaining;
  if (left > LOW_BALANCE && !quota.onHold) return null;
  const empty = left === 0;
  const waiting = quota.onHold > 0
    ? left > 0
      ? ` ${quota.onHold} ${quota.onHold === 1 ? "candidate" : "candidates"} couldn't start earlier: their link works now, so let them know.`
      : ` ${quota.onHold} ${quota.onHold === 1 ? "candidate is" : "candidates are"} waiting to start.`
    : "";
  return (
    <div role="status" className={cn("flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm",
      empty ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200")}>
      {quota.onHold ? <Clock className="size-4 shrink-0" aria-hidden /> : <AlertTriangle className="size-4 shrink-0" aria-hidden />}
      <span>
        {empty ? <><strong>No interviews left.</strong> Candidates you invite can&apos;t start until you add more.</> : left <= LOW_BALANCE ? <><strong>{left} {left === 1 ? "interview" : "interviews"} left.</strong></> : null}
        {waiting}
      </span>
      {left > LOW_BALANCE ? null : canBuy
        ? <Link href="/settings/billing" className="shrink-0 font-semibold underline underline-offset-2">Buy interviews</Link>
        : <span className="shrink-0">Ask your account owner or an admin to add more.</span>}
    </div>
  );
}
