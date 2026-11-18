import Link from "next/link";
import type { PurchaseRow } from "@/lib/services/billing";
import { cn } from "@/lib/utils";

type Moves = Pick<PurchaseRow, "quantity" | "interviews_added" | "interviews_expired" | "refunded_cents" | "status">;

const DONE = new Set(["paid", "refunded", "partially_refunded"]);
/** A checkout session lives 60 minutes; an older unpaid one was cancelled or abandoned. */
const OPEN_MS = 65 * 60_000;

/**
 * What a purchase did to the interview balance. `interviews_added` is what still counts now
 * (a refund or the 12-month expiry lowers it), so: bought = kept + taken back + expired.
 */
export function purchaseMoves(p: Moves) {
  if (!DONE.has(p.status)) return { bought: 0, takenBack: 0, expired: 0, kept: 0 };
  const expired = p.interviews_expired;
  const kept = p.interviews_added;
  return { bought: p.quantity, takenBack: Math.max(0, p.quantity - kept - expired), expired, kept };
}

export type PurchaseKind = "paid" | "refunded" | "expired" | "incomplete" | "open";

/** One label per purchase, for the badge and the filters. */
export function purchaseKind(p: Pick<PurchaseRow, "status" | "expired_at" | "created_at">, now = Date.now()): PurchaseKind {
  if (p.status === "refunded" || p.status === "partially_refunded") return "refunded";
  if (p.status === "paid") return p.expired_at ? "expired" : "paid";
  if (p.status === "pending" && now - new Date(p.created_at).getTime() < OPEN_MS) return "open";
  return "incomplete";
}

const BADGE: Record<PurchaseKind, [string, string]> = {
  paid: ["Paid", "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"],
  refunded: ["Refunded", "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300"],
  expired: ["Expired", "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300"],
  incomplete: ["Not completed", "bg-muted text-muted-foreground"],
  open: ["Awaiting payment", "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"],
};

export function PurchaseBadge({ p }: { p: Pick<PurchaseRow, "status" | "expired_at" | "created_at"> }) {
  const kind = purchaseKind(p);
  const [label, tone] = BADGE[kind];
  return <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tone)}>{p.status === "partially_refunded" ? "Partly refunded" : label}</span>;
}

/** Compact chips: +10 added · −6 taken back (refund) · −2 expired unused · = 4 kept. */
export function PurchaseMoves({ p }: { p: Moves }) {
  const m = purchaseMoves(p);
  if (!m.bought) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1.5 text-xs tabular">
      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">+{m.bought} added</span>
      {m.takenBack > 0 && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700 dark:bg-rose-950 dark:text-rose-300">−{m.takenBack} taken back (refund)</span>}
      {m.expired > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300">−{m.expired} expired unused</span>}
      {(m.takenBack > 0 || m.expired > 0) && <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">= {m.kept} kept</span>}
    </span>
  );
}

/** "Buy interviews | Purchase history" switch at the top of the billing pages. */
export function BillingTabs({ active, count }: { active: "buy" | "history"; count?: number }) {
  const tabs = [
    { key: "buy", href: "/settings/billing", label: "Buy interviews" },
    { key: "history", href: "/settings/billing/history", label: "Purchase history", count },
  ] as const;
  return (
    <nav aria-label="Billing" className="flex gap-1 border-b">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", active === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t.label}
          {"count" in t && t.count ? <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs tabular text-muted-foreground">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
