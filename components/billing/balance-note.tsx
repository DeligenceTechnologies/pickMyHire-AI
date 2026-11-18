"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { api } from "@/lib/client/api";
import { LOW_BALANCE } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export type Balance = { remaining: number | null; onHold: number; minutesPerInterview: number; canBuy: boolean };

/** The company's interview balance, loaded when an invite window opens. */
export function useBalance(open: boolean) {
  const [balance, setBalance] = useState<Balance | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api<Balance>("/api/billing/balance").then((b) => live && setBalance(b)).catch(() => {});
    return () => { live = false; };
  }, [open]);
  return balance;
}

/**
 * Under an invite: how many interviews are left and what this invite will use when the candidates start.
 * Inviting is never blocked; with too few left, it says the candidates will have to wait.
 */
export function BalanceNote({ balance, count = 1, minutes, name }: { balance: Balance | null; count?: number; minutes?: number | null; name?: string }) {
  if (!balance || balance.remaining === null) return null;
  const each = minutes && minutes > balance.minutesPerInterview ? Math.ceil(minutes / balance.minutesPerInterview) : 1;
  const needed = count * each;
  const left = balance.remaining;
  const short = needed > left;
  const low = !short && left - needed <= LOW_BALANCE;
  const buy = balance.canBuy
    ? <Link href="/settings/billing" className="font-semibold underline underline-offset-2">Buy interviews</Link>
    : <span className="font-medium">Ask your account owner or an admin to add interviews.</span>;
  const waiting = count - Math.floor(left / each); // candidates who'd have to wait
  const who = count === 1 ? `${name ?? "The candidate"} can still be invited, but won't be able to start` : `You can still invite them, but ${waiting === count ? "they" : `${waiting} of them`} won't be able to start`;
  return (
    <div role={short ? "alert" : "status"} className={cn("flex gap-2 rounded-lg border px-3 py-2 text-sm",
      short ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        : low ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          : "bg-muted/40 text-muted-foreground")}>
      {short || low ? <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <p>
        You have <b className="tabular">{left}</b> {left === 1 ? "interview" : "interviews"} left.{" "}
        {count === 1 ? `This uses ${each === 1 ? "1" : `${each} (the template is over ${balance.minutesPerInterview} minutes)`} when the candidate starts.` : `Inviting ${count} candidates uses ${needed} when they start${each > 1 ? ` (${each} each: the template is over ${balance.minutesPerInterview} minutes)` : ""}.`}
        {short && <> {who} until you add more. {buy}</>}
        {!short && low && <> You&apos;re running low. {buy}</>}
      </p>
    </div>
  );
}
