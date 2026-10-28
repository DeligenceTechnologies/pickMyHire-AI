"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { payHint, payPlaceholderHint, readPay, type Currency, type PayUnit } from "@/lib/application-form";
import { cn } from "@/lib/utils";

/** Keep only what can be part of an amount (digits, separators, a decimal point). */
const clean = (s: string) => s.replace(/[^\d.,]/g, "");

/** The hint under a pay box: what the amount means, or why it can't be read. */
export function PayHint({ text, unit, currency, id }: { text: string; unit: PayUnit; currency: Currency; id?: string }) {
  if (!text.trim()) return <p id={id} className="text-xs text-muted-foreground">{payPlaceholderHint(unit, currency)}</p>;
  const r = readPay(text, unit, currency);
  return r.ok
    ? <p id={id} className={cn("text-xs", r.converted ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{payHint(r, unit, currency)}</p>
    : <p id={id} className="text-xs text-amber-700 dark:text-amber-400">{r.error}</p>;
}

/**
 * A pay box that keeps exactly what's typed (so "4." can become "4.5") and
 * reports the amount it means, in the job's pay unit.
 */
export function PayInput({ id, value, onValue, unit, currency, invalid, describedBy }: {
  id: string; value: number | null; onValue: (n: number | null) => void; unit: PayUnit; currency: Currency; invalid?: boolean; describedBy?: string;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  return (
    <>
      <Input id={id} inputMode="decimal" value={text} aria-invalid={invalid} aria-describedby={describedBy ?? `${id}-hint`}
        onChange={(e) => {
          const t = clean(e.target.value);
          setText(t);
          const r = readPay(t, unit, currency);
          // An unreadable amount is passed on as typed, so saving fails with a clear message instead of dropping it.
          onValue(t.trim() === "" ? null : r.ok ? r.value : Number(t.replace(/,/g, "")) || null);
        }} />
      <PayHint id={describedBy ?? `${id}-hint`} text={text} unit={unit} currency={currency} />
    </>
  );
}
