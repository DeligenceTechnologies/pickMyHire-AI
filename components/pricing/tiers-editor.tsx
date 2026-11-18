"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PriceTier } from "@/lib/pricing";

/** Edit volume prices: "From 50 interviews · $2.49 each". The first row is the smallest purchase. */
export function TiersEditor({ tiers, onChange, idPrefix }: { tiers: PriceTier[]; onChange: (t: PriceTier[]) => void; idPrefix: string }) {
  const set = (i: number, patch: Partial<PriceTier>) => onChange(tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground">
        <span>From (interviews)</span><span>Price per interview (USD)</span><span className="w-8" />
      </div>
      {tiers.map((t, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Input id={`${idPrefix}-min-${i}`} aria-label={`Tier ${i + 1}: from how many interviews`} type="number" min={1} value={t.min}
            onChange={(e) => set(i, { min: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} className="tabular" />
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <DollarInput id={`${idPrefix}-price-${i}`} label={`Tier ${i + 1}: price per interview in dollars`} cents={t.cents} onChange={(cents) => set(i, { cents })} />
          </div>
          <Button type="button" variant="ghost" size="icon-sm" disabled={tiers.length <= 1} onClick={() => onChange(tiers.filter((_, j) => j !== i))} aria-label={`Remove tier ${i + 1}`}><Trash2 /></Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" disabled={tiers.length >= 8}
        onClick={() => { const last = tiers[tiers.length - 1]; onChange([...tiers, { min: last.min * 2, cents: Math.max(1, last.cents - 20) }]); }}>
        <Plus /> Add volume price
      </Button>
      <p className="text-xs text-muted-foreground">The first row is the smallest purchase. Buying more lowers the price of every interview in that purchase.</p>
    </div>
  );
}

/** Keeps what's typed ("2.4") while typing; shows "2.40" once you leave the box. */
function DollarInput({ id, label, cents, onChange }: { id: string; label: string; cents: number; onChange: (cents: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Input id={id} aria-label={label} type="text" inputMode="decimal" value={text ?? (cents / 100).toFixed(2)}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n) && n > 0) onChange(Math.round(n * 100));
      }}
      onBlur={() => setText(null)}
      className="pl-6 tabular" />
  );
}
